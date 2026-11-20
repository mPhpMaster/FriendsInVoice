import assert from "node:assert/strict";
import { test } from "node:test";

import { NameCache } from "../src/names.js";

const store = () => { const map = new Map(); return { map, get: async key => map.get(key), put: async (key, value) => { map.set(key, value); } }; };
const id = "222222222222222222";

test("remembers names Discord loaded and keeps them after a restart", async () => {
    const backing = store();
    const names = new NameCache(backing);
    names.remember({ id, username: "sam", globalName: "Sam" });
    await names.flush();
    const again = new NameCache(backing);
    await again.load();
    assert.equal(again.get(id).globalName, "Sam");
});

test("names from another device only win when they are newer", () => {
    const names = new NameCache(store());
    names.remember({ id, username: "sam", globalName: "Sam" });
    const mine = names.get(id).savedAt;
    assert.equal(names.merge([{ id, username: "old", savedAt: mine - 1000 }]), false);
    assert.equal(names.merge([{ id, username: "new", savedAt: mine + 1000 }]), true);
    assert.equal(names.get(id).username, "new");
    clearTimeout(names.timer);
});
