import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createApp, GuardStore, normalizeCode } from "../server.mjs";

const OWNER = "123456789012345678";
const GUARD = "234567890123456789";
const OTHER = "345678901234567890";
const key = letter => `B${letter.repeat(86)}`;
const NONCE = "12345678-1234-4234-8234-123456789abc";

let server, base;
before(async () => {
    server = createApp({ store: new GuardStore(null) });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

async function call(method, path, token, body) {
    const response = await fetch(base + path, {
        method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
}

const register = async (discordId, publicKey) => (await call("POST", "/v1/register", null, { discordId, publicKey })).body.token;

function wire(to, fromKey) {
    return { type: "sealed", version: 2, to, fromKey, iv: "AAAAAAAAAAAAAAAA", ciphertext: "x".repeat(40) };
}

test("health answers without a token", async () => {
    const { status, body } = await call("GET", "/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
});

test("pairing with a code, then a command reaches only the owner", async () => {
    const owner = await register(OWNER, key("o"));
    const guard = await register(GUARD, key("g"));
    const other = await register(OTHER, key("x"));
    assert.equal((await call("GET", "/v1/pairs", "bad")).status, 401);

    const made = await call("POST", "/v1/codes", owner, { guardianId: GUARD, actions: ["deafen", "mute"], nonce: NONCE });
    assert.equal(made.status, 200);
    const code = made.body.code;
    assert.equal(normalizeCode(`${code.slice(0, 4)}-${code.slice(4).toLowerCase()}`), code);

    assert.equal((await call("GET", `/v1/codes/${code}`, other)).status, 403, "a code works only for the chosen guardian");
    assert.equal((await call("GET", `/v1/codes/${code}`, owner)).status, 400);
    const offer = await call("GET", `/v1/codes/${code}`, guard);
    assert.deepEqual([offer.body.ownerId, offer.body.actions], [OWNER, ["mute", "deafen"]]);

    const waiting = call("GET", "/v1/events?after=0&wait=5000", owner);
    const accepted = await call("POST", `/v1/codes/${code}/accept`, guard);
    assert.equal(accepted.body.peerId, OWNER);
    assert.equal(accepted.body.peerKey, key("o"));
    const woke = await waiting;
    assert.equal(woke.body.events[0].type, "pairs");
    assert.equal((await call("POST", `/v1/codes/${code}/accept`, guard)).status, 404, "codes work once");

    const list = (await call("GET", "/v1/pairs", owner)).body;
    assert.equal(list.pairs.length, 1);
    assert.equal(list.pairs[0].role, "owner");
    assert.equal(list.pairs[0].peerKey, key("g"));
    const pairId = list.pairs[0].id;

    assert.equal((await call("POST", `/v1/pairs/${pairId}/commands`, owner, { wire: wire(OWNER, key("o")) })).status, 403);
    assert.equal((await call("POST", `/v1/pairs/${pairId}/commands`, guard, { wire: wire(OWNER, key("x")) })).status, 400,
        "the command must come from the guardian's registered key");
    assert.equal((await call("POST", `/v1/pairs/${pairId}/commands`, other, { wire: wire(OWNER, key("x")) })).status, 404);
    const sent = await call("POST", `/v1/pairs/${pairId}/commands`, guard, { wire: wire(OWNER, key("g")) });
    assert.equal(sent.body.delivered, true, "the owner polled moments ago");

    const events = (await call("GET", `/v1/events?after=${woke.body.last}`, owner)).body;
    assert.equal(events.events.length, 1);
    assert.equal(events.events[0].type, "command");
    assert.equal(events.events[0].from, GUARD);

    assert.equal((await call("PATCH", `/v1/pairs/${pairId}`, guard, { actions: ["mute"] })).status, 403);
    assert.deepEqual((await call("PATCH", `/v1/pairs/${pairId}`, owner, { actions: ["disconnect"] })).body.actions, ["disconnect"]);
    assert.equal((await call("DELETE", `/v1/pairs/${pairId}`, guard)).status, 200);
    assert.equal((await call("GET", "/v1/pairs", owner)).body.pairs.length, 0);
});

test("refusing tells the owner and removes the code", async () => {
    const owner = await register(OWNER, key("p"));
    const guard = await register(GUARD, key("q"));
    const { code } = (await call("POST", "/v1/codes", owner, { guardianId: GUARD, actions: ["mute"], nonce: NONCE })).body;
    assert.equal((await call("GET", "/v1/pairs", owner)).body.codes.length, 1);
    await call("POST", `/v1/codes/${code}/refuse`, guard);
    const events = (await call("GET", "/v1/events?after=0", owner)).body.events;
    assert.deepEqual(events.map(event => [event.type, event.guardianId]), [["refused", GUARD]]);
    assert.equal((await call("GET", "/v1/pairs", owner)).body.codes.length, 0);
});

test("bad input is refused", async () => {
    assert.equal((await call("POST", "/v1/register", null, { discordId: "1", publicKey: key("a") })).status, 400);
    const owner = await register(OWNER, key("r"));
    assert.equal((await call("POST", "/v1/codes", owner, { guardianId: GUARD, actions: ["ban"], nonce: NONCE })).status, 400);
    assert.equal((await call("POST", "/v1/codes", owner, { guardianId: OWNER, actions: ["mute"], nonce: NONCE })).status, 400);
    assert.equal((await call("GET", "/v1/codes/AAAA-AAAA", owner)).status, 404);
});

test("expired codes and commands disappear, and data survives a restart", () => {
    let now = 1_000_000;
    const file = join(mkdtempSync(join(tmpdir(), "fiv-")), "guards.json");
    const store = new GuardStore(file, () => now);
    const owner = store.register(OWNER, key("s"));
    const guard = store.register(GUARD, key("t"));
    const { code } = store.createCode(owner.account, { guardianId: GUARD, actions: ["mute"], nonce: NONCE });
    now += 11 * 60_000;
    assert.throws(() => store.acceptCode(guard.account, code), /expired/);
    const fresh = store.createCode(owner.account, { guardianId: GUARD, actions: ["mute"], nonce: NONCE });
    const pair = store.acceptCode(guard.account, fresh.code);
    store.command(guard.account, pair.id, wire(OWNER, key("t")));
    assert.equal(store.pending(owner.account, 0).events.filter(event => event.type === "command").length, 1);
    now += 61_000;
    assert.equal(store.pending(owner.account, 0).events.filter(event => event.type === "command").length, 0);
    store.flush();
    assert.ok(!readFileSync(file, "utf8").includes(owner.token), "tokens are stored only as hashes");
    const reloaded = new GuardStore(file, () => now);
    assert.equal(reloaded.listPairs(owner.account).pairs.length, 1);
    assert.equal(reloaded.authenticate(`Bearer ${guard.token}`), guard.account);
});
