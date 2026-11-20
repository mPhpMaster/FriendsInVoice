import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { checkPassword, createAdmin, hashPassword } from "../admin.mjs";
import { createApp, GuardStore } from "../server.mjs";

const OWNER = "123456789012345678", GUARD = "234567890123456789";
const key = letter => `B${letter.repeat(86)}`;
const NONCE = "12345678-1234-4234-8234-123456789abc";

let server, base, store;
before(async () => {
    store = new GuardStore(null);
    const admin = createAdmin({ store, passwordHash: hashPassword("correct horse") });
    server = createApp({ store, admin });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

const call = (method, path, { body, cookie, header = true } = {}) => fetch(base + path, {
    method, headers: { "content-type": "application/json", ...(header ? { "x-fiv-admin": "1" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
});

test("passwords are checked against the scrypt hash", () => {
    const stored = hashPassword("secret");
    assert.equal(checkPassword("secret", stored), true);
    assert.equal(checkPassword("Secret", stored), false);
    assert.equal(checkPassword("secret", ""), false);
});

test("the dashboard needs a login and never shows tokens", async () => {
    const page = await call("GET", "/admin");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal((await call("GET", "/admin/api/overview")).status, 401);
    assert.equal((await call("POST", "/admin/api/login", { body: { password: "x" }, header: false })).status, 403, "other sites can't post the form");
    assert.equal((await call("POST", "/admin/api/login", { body: { password: "wrong" } })).status, 401);
    const login = await call("POST", "/admin/api/login", { body: { password: "correct horse" } });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.match(login.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/);

    const owner = store.register(OWNER, key("o")), guard = store.register(GUARD, key("g"));
    const { code } = store.createCode(owner.account, { guardianId: GUARD, actions: ["mute"], nonce: NONCE });
    const pair = store.acceptCode(guard.account, code);
    store.authenticate(`Bearer ${owner.token}`);

    const response = await call("GET", "/admin/api/overview", { cookie });
    const text = await response.text();
    const data = JSON.parse(text);
    assert.equal(data.accounts.length, 2);
    assert.equal(data.pairs[0].ownerId, OWNER);
    assert.ok(data.accounts.find(account => account.discordId === OWNER).lastSeen);
    assert.ok(!text.includes(owner.token) && !text.includes("tokenHash") && !text.includes(store.accounts[owner.account].tokenHash));

    assert.equal((await call("DELETE", `/admin/api/pairs/${pair.id}`, { cookie })).status, 200);
    assert.equal(Object.keys(store.pairs).length, 0);
    assert.equal((await call("DELETE", `/admin/api/accounts/${guard.account}`, { cookie })).status, 200);
    assert.equal(Object.keys(store.accounts).length, 1);

    assert.equal((await call("POST", "/admin/api/logout", { cookie })).status, 200);
    assert.equal((await call("GET", "/admin/api/overview", { cookie })).status, 401);
});

test("without a password hash the dashboard is off", async () => {
    const off = createApp({ store: new GuardStore(null), admin: createAdmin({ store: new GuardStore(null) }) });
    await new Promise(resolve => off.listen(0, "127.0.0.1", resolve));
    const response = await fetch(`http://127.0.0.1:${off.address().port}/admin`);
    assert.equal(response.status, 503);
    off.close();
});
