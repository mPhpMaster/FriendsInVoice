import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function modules() {
    const result = await build({ stdin: { contents: `export { SyncService } from "./src/sync.js"; export { NameCache } from "./src/names.js";`,
        resolveDir: fileURLToPath(new URL("..", import.meta.url)) }, bundle: true, platform: "node", format: "esm", write: false,
        external: ["fake-indexeddb"] });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const me = "111111111111111111", friend = "222222222222222222";
const memory = () => { const map = new Map(); return { get: async key => map.get(key), put: async (key, value) => { map.set(key, value); } }; };
const noTimers = { set: () => null, clear() {}, every: () => null, stopEvery() {} };

function server() {
    const blobs = new Map(), urls = [];
    const transport = async ({ method, url, body }) => {
        urls.push(url);
        const id = url.split("/").pop(), blob = blobs.get(id);
        if (method === "GET") return blob ? { status: 200, body: { version: blob.version, data: blob.data } } : { status: 404, body: null };
        const hash = createHash("sha256").update(body.proof).digest("hex");
        if (blob && blob.hash !== hash) return { status: 403, body: {} };
        if ((blob?.version ?? 0) !== body.baseVersion) return { status: 409, body: {} };
        blobs.set(id, { version: (blob?.version ?? 0) + 1, data: body.data, hash });
        return { status: 200, body: {} };
    };
    return { transport, urls };
}

function device(SyncService, NameCache, transport, value) {
    const data = { accountId: me, value: { syncPassphrase: "long enough pass", guardServer: "https://fiv.test", watchlist: [], notifyOnline: [], blacklist: [], notifyVoice: [], hidden: [], ...value }, save() {} };
    const voiceLog = { accountId: me, entries: [], nextKey: 0, save() {}, onChange: null };
    const bridge = { names: new NameCache(memory()) };
    const api = { UI: { showToast() {} } };
    return { data, voiceLog, bridge, sync: new SyncService(api, bridge, data, voiceLog, { transport, meta: memory(), timers: noTimers }) };
}

test("a second device gets the Log, lists and names, and only the sync server is contacted", async () => {
    const { SyncService, NameCache } = await modules();
    const { transport, urls } = server();
    const pc = device(SyncService, NameCache, transport, { watchlist: [friend] });
    pc.voiceLog.entries = [{ key: 0, time: 1, kind: "join", userId: friend, from: null, to: { id: "1" } }];
    pc.bridge.names.remember({ id: friend, username: "sam" });
    pc.sync.listChanged("watchlist");
    await pc.sync.run();
    const laptop = device(SyncService, NameCache, transport, {});
    await laptop.sync.run();
    assert.deepEqual(laptop.data.value.watchlist, [friend]);
    assert.equal(laptop.voiceLog.entries.length, 1);
    assert.equal(laptop.bridge.names.get(friend).username, "sam");
    assert.ok(urls.every(url => url.startsWith("https://fiv.test/v1/sync/")));
    clearTimeout(pc.bridge.names.timer); clearTimeout(laptop.bridge.names.timer);
});

test("without a passphrase nothing is sent", async () => {
    const { SyncService, NameCache } = await modules();
    const { transport, urls } = server();
    const pc = device(SyncService, NameCache, transport, { syncPassphrase: "" });
    await pc.sync.run();
    assert.equal(urls.length, 0);
});
