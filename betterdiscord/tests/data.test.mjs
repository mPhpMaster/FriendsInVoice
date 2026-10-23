import assert from "node:assert/strict";
import { test } from "node:test";

import { DataStore, normalizeData } from "../src/data.js";
import { memoryStore } from "./memoryStore.mjs";

const owner = "111111111111111111";
const other = "222222222222222222";

test("stored data removes invalid IDs and unknown permissions", () => {
    const data = normalizeData({
        watchlist: [owner, owner, "not-an-id"],
        personalGuards: [{ userId: other, actions: ["mute", "unsafe"] }],
        guardPeerKeys: [{ userId: owner, publicKey: "bad" }]
    });
    assert.deepEqual(data.watchlist, [owner]);
    assert.deepEqual(data.personalGuards, [{ userId: other, actions: ["mute"] }]);
    assert.deepEqual(data.guardPeerKeys, []);
});

test("permissions start empty and each change is saved", () => {
    const writes = [];
    const store = new DataStore({ Data: { load: () => null, save: (_key, value) => writes.push(structuredClone(value)) } }, memoryStore());
    assert.equal(store.grant(other, []), true);
    assert.deepEqual(store.value.personalGuards[0].actions, []);
    assert.equal(store.grant(other, ["mute"]), true);
    assert.deepEqual(store.value.personalGuards[0].actions, ["mute"]);
    store.revoke(other);
    assert.equal(store.value.personalGuards.length, 0);
    assert.equal(writes.length, 3);
});

test("lists are kept per account, and the ones saved before go to the first account", async () => {
    const third = "333333333333333333";
    const file = { settings: { watchlist: [other], hidden: [third], notifyOnce: false } };
    const api = { Data: { load: key => structuredClone(file[key]), save: (key, value) => { file[key] = structuredClone(value); } } };
    const accounts = memoryStore();
    const first = new DataStore(api, accounts);
    await first.useAccount(owner);
    assert.deepEqual(first.value.watchlist, [other]);
    assert.equal(file.settings.watchlist, undefined);
    assert.equal(file.settings.accountOwner, owner);
    assert.equal(file.settings.notifyOnce, false);

    // another Discord on the same computer, logged into another account, shares the settings file
    const second = new DataStore(api, accounts);
    assert.deepEqual(second.value.watchlist, []);
    await second.useAccount(third);
    assert.deepEqual(second.value.watchlist, []);
    assert.equal(second.value.notifyOnce, false);
    second.toggleList("watchlist", owner);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(accounts.map.get(third).watchlist, [owner]);
    assert.deepEqual(accounts.map.get(owner).watchlist, [other]);

    // switching back in the same Discord
    await second.useAccount(owner);
    assert.deepEqual(second.value.watchlist, [other]);
    assert.deepEqual(second.value.hidden, [third]);
});
