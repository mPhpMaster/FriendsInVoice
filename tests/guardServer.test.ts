import assert from "node:assert/strict";
import { test } from "node:test";

import { applyServerPairs, codeFromText, codeMessage, type GuardCredential, GuardPoller, type GuardRequest, GuardServerClient, normalizeCode, ownerNeedsEvents } from "../friendsInVoice/guardServer";
import type { GuardsStore } from "../friendsInVoice/personalGuardsTypes";

const me = "123456789012345678", guardian = "234567890123456789", owner = "345678901234567890", other = "456789012345678901";
const key = (letter: string) => `B${letter.repeat(86)}`;
const NONCE = "12345678-1234-4234-8234-123456789abc";
const empty = (): GuardsStore => ({ personalGuards: [], knownGuardGrants: [], pendingGuardInvites: [], declinedGuardInvites: [], guardPeerKeys: [], guardReplay: [], guardBlocks: [] });

test("codes are read from DM text and normalized", () => {
    assert.equal(codeFromText(codeMessage("ABCD2345")), "ABCD2345");
    assert.equal(codeFromText("hey"), null);
    assert.equal(normalizeCode("abcd-2345"), "ABCD2345");
    assert.equal(normalizeCode("ABCD-0000"), null, "0 and 1 are never used in codes");
});

test("server pairs replace the local guard lists", () => {
    const store = empty();
    store.personalGuards = [{ userId: guardian, actions: ["mute"] }, { userId: other, actions: ["deafen"] }];
    store.knownGuardGrants = [{ userId: other, actions: ["mute"], inviteNonce: NONCE }];
    store.pendingGuardInvites = [{ userId: other, actions: ["mute"], publicKey: key("x"), nonce: NONCE }];
    applyServerPairs(store, {
        me, codes: [{ code: "ABCD2345", guardianId: other, actions: ["deafen"], nonce: NONCE, expiresAt: Date.now() + 60_000 }],
        pairs: [
            { id: "p1", role: "owner", peerId: guardian, peerKey: key("g"), actions: ["mute", "disconnect"], nonce: NONCE, createdAt: 1 },
            { id: "p2", role: "guardian", peerId: owner, peerKey: key("o"), actions: ["deafen"], nonce: NONCE, createdAt: 1 },
        ]
    });
    assert.deepEqual(store.personalGuards.find(item => item.userId === guardian), { userId: guardian, actions: ["mute", "disconnect"], pairId: "p1", inviteNonce: NONCE });
    assert.equal(store.personalGuards.find(item => item.userId === other)?.code, "ABCD2345");
    assert.deepEqual(store.knownGuardGrants, [{ userId: owner, actions: ["deafen"], inviteNonce: NONCE, pairId: "p2" }], "old DM-based access is dropped");
    assert.deepEqual(store.guardPeerKeys.map(item => item.userId).sort(), [guardian, owner].sort());
    assert.deepEqual(store.pendingGuardInvites, []);
});

test("the owner listens only in voice with a guard, or while a code is open", () => {
    const store = empty();
    assert.equal(ownerNeedsEvents(store, true), false);
    store.personalGuards = [{ userId: guardian, actions: ["mute"], pairId: "p1" }];
    assert.equal(ownerNeedsEvents(store, false), false);
    assert.equal(ownerNeedsEvents(store, true), true);
    store.personalGuards = [{ userId: guardian, actions: ["mute"], code: "ABCD2345", codeExpiresAt: Date.now() + 1000 }];
    assert.equal(ownerNeedsEvents(store, false), true);
    store.personalGuards[0].codeExpiresAt = Date.now() - 1;
    assert.equal(ownerNeedsEvents(store, false), false);
});

function fakeServer() {
    const requests: GuardRequest[] = [];
    let tokens = 0, valid = "";
    const saved = new Map<string, GuardCredential>();
    const client = new GuardServerClient({
        transport: async request => {
            requests.push(request);
            if (request.url.endsWith("/v1/register")) { valid = `token${++tokens}`; return { status: 200, body: { token: valid } }; }
            if (request.token !== valid) return { status: 401, body: { error: "Unknown token." } };
            return { status: 200, body: { me, pairs: [], codes: [] } };
        },
        credentials: { get: async id => saved.get(id), set: async (id, value) => { if (value) saved.set(id, value); else saved.delete(id); } },
        server: () => "https://example.test/",
        account: () => me,
        publicKey: async () => key("k"),
    });
    return { client, requests, saved, expire: () => { valid = "gone"; } };
}

test("the client registers once, reuses its token and registers again when it stops working", async () => {
    const { client, requests, saved, expire } = fakeServer();
    await client.listPairs();
    await client.listPairs();
    assert.deepEqual(requests.map(item => item.url.replace("https://example.test", "")), ["/v1/register", "/v1/pairs", "/v1/pairs"]);
    assert.equal(saved.get(me)?.token, "token1");
    expire();
    await client.listPairs();
    assert.equal(saved.get(me)?.token, "token2");
    assert.ok(requests.every(item => !JSON.stringify(item).toLowerCase().includes("discord.com")), "nothing goes to Discord");
});

test("a non-https server address is refused", async () => {
    const client = new GuardServerClient({
        transport: async () => { throw new Error("must not be called"); },
        credentials: { get: async () => undefined, set: async () => { } },
        server: () => "http://evil.example", account: () => me, publicKey: async () => key("k"),
    });
    await assert.rejects(client.listPairs(), /https/);
});

test("the poller stops as soon as it isn't needed and backs off after errors", async () => {
    let run = true, calls = 0;
    const waits: number[] = [];
    const seen: number[] = [];
    const client = { events: async (after: number) => {
        calls++;
        if (calls === 2) throw new Error("offline");
        if (calls === 4) run = false;
        return { last: after + 1, events: [{ seq: after + 1, at: 0, type: "pairs" as const }] };
    } } as unknown as GuardServerClient;
    const poller = new GuardPoller({ client, shouldRun: () => run, onEvents: events => { seen.push(...events.map(event => event.seq)); },
        wait: async ms => { waits.push(ms); } });
    poller.update();
    for (let i = 0; i < 20 && run; i++) await new Promise(resolve => setTimeout(resolve, 5));
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 4);
    assert.deepEqual(waits, [2000]);
    assert.deepEqual(seen, [1, 2, 3]);
});
