import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import type { GuardRequest } from "../friendsInVoice/guardServer";
import { deriveSyncKeys, mergeSync, openSync, sealSync, type SyncData, syncOnce } from "../friendsInVoice/syncCore";

const me = "111111111111111111", friend = "222222222222222222", other = "333333333333333333";
const empty = (): SyncData => ({ lists: {}, log: [], names: [] });

/** the server side of the sync spec, in memory */
function fakeServer() {
    const blobs = new Map<string, { version: number; data: string; proofHash: string; }>();
    const seen: GuardRequest[] = [];
    const transport = async (request: GuardRequest) => {
        seen.push(request);
        const id = request.url.split("/").pop()!;
        const blob = blobs.get(id);
        if (request.method === "GET") return blob ? { status: 200, body: { version: blob.version, data: blob.data } } : { status: 404, body: null };
        const body = request.body as any;
        const proofHash = createHash("sha256").update(body.proof).digest("hex");
        if (blob && blob.proofHash !== proofHash) return { status: 403, body: { error: "bad proof" } };
        if ((blob?.version ?? 0) !== body.baseVersion) return { status: 409, body: { version: blob?.version } };
        blobs.set(id, { version: (blob?.version ?? 0) + 1, data: body.data, proofHash });
        return { status: 200, body: { version: (blob?.version ?? 0) + 1 } };
    };
    return { blobs, seen, transport };
}

test("the server only gets an unreadable blob, and the right passphrase opens it", async () => {
    const keys = await deriveSyncKeys("correct horse", me);
    const blob = await sealSync({ lists: { watchlist: { ids: [friend], changedAt: 1 } }, log: [], names: [{ id: friend, username: "sam", savedAt: 1 }] }, keys.key);
    assert.ok(!blob.includes("sam") && !blob.includes(friend));
    assert.equal((await openSync(blob, keys.key))?.names[0].username, "sam");
    assert.equal(await openSync(blob, (await deriveSyncKeys("wrong", me)).key), null);
    assert.notEqual(keys.blobId, (await deriveSyncKeys("correct horse", friend)).blobId, "each account has its own place");
});

test("merging keeps the newer list, every Log entry once, and the newest name", () => {
    const a: SyncData = { lists: { hidden: { ids: [friend], changedAt: 10 } }, log: [{ time: 5, kind: "join", userId: friend }], names: [{ id: friend, username: "old", savedAt: 1 }] };
    const b: SyncData = { lists: { hidden: { ids: [], changedAt: 20 } }, log: [{ time: 5, kind: "join", userId: friend }, { time: 9, kind: "leave", userId: friend }], names: [{ id: friend, username: "new", savedAt: 2 }] };
    const merged = mergeSync(a, b);
    assert.deepEqual(merged.lists.hidden, { ids: [], changedAt: 20 }, "a removal on the newer device wins");
    assert.deepEqual(merged.log.map(entry => entry.time), [9, 5]);
    assert.equal(merged.names[0].username, "new");
});

test("two devices end up with the same Log and lists", async () => {
    const server = fakeServer();
    const keys = await deriveSyncKeys("pass", me);
    const pc: SyncData = { ...empty(), lists: { watchlist: { ids: [friend], changedAt: 1 } }, log: [{ time: 1, kind: "join", userId: friend }] };
    await syncOnce({ transport: server.transport, server: "https://x", keys, local: pc });
    const laptop = await syncOnce({ transport: server.transport, server: "https://x", keys: await deriveSyncKeys("pass", me), local: { ...empty(), log: [{ time: 2, kind: "join", userId: other }] } });
    assert.deepEqual(laptop.lists.watchlist?.ids, [friend]);
    assert.equal(laptop.log.length, 2);
    const back = await syncOnce({ transport: server.transport, server: "https://x", keys, local: pc });
    assert.equal(back.log.length, 2);
    assert.ok(server.seen.every(request => request.url.startsWith("https://x/v1/sync/")), "only the sync server is contacted");
    assert.ok(server.seen.every(request => !JSON.stringify(request.body ?? "").includes(me)), "the Discord ID is never sent");
});

test("nothing is written when nothing changed, and a wrong passphrase can't overwrite", async () => {
    const server = fakeServer();
    const keys = await deriveSyncKeys("pass", me);
    await syncOnce({ transport: server.transport, server: "https://x", keys, local: { ...empty(), log: [{ time: 1, kind: "join", userId: friend }] } });
    const writes = () => server.seen.filter(request => request.method === "PUT").length;
    const before = writes();
    await syncOnce({ transport: server.transport, server: "https://x", keys, local: empty() });
    assert.equal(writes(), before);
    // the blob id comes from the passphrase, so a wrong one just finds nothing; a forged proof is refused
    const stolen = { ...keys, proof: (await deriveSyncKeys("other", me)).proof };
    await assert.rejects(syncOnce({ transport: server.transport, server: "https://x", keys: stolen, local: { ...empty(), log: [{ time: 3, kind: "join", userId: other }] } }));
});
