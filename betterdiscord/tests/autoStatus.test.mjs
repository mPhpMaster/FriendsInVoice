import assert from "node:assert/strict";
import { test } from "node:test";

import { AutoStatus } from "../src/autoStatus.js";
import { normalizeData } from "../src/data.js";

const me = "111111111111111111";
const friend = "222222222222222222";

function setup(value = {}, myChannel = null) {
    const set = [];
    const bridge = {
        currentId: () => me,
        myVoiceChannel: () => myChannel,
        setStatus: async status => { set.push(status); }
    };
    const data = { value: normalizeData({ autoStatus: true, ...value }) };
    const api = { Logger: { error() {} } };
    return { auto: new AutoStatus(api, bridge, data), set };
}

test("defaults: off, online in calls, invisible otherwise; bad statuses are ignored", () => {
    const data = normalizeData({});
    assert.equal(data.autoStatus, false);
    assert.equal(data.statusInCall, "online");
    assert.equal(data.statusOutsideCall, "invisible");
    assert.equal(normalizeData({ statusInCall: "offline" }).statusInCall, "online");
    assert.equal(normalizeData({ statusInCall: "dnd" }).statusInCall, "dnd");
});

test("does nothing while switched off", () => {
    const { auto, set } = setup({ autoStatus: false }, "123");
    auto.apply();
    auto.onUpdates([{ userId: me, channelId: "123" }]);
    assert.deepEqual(set, []);
});

test("on start uses this client's voice channel", () => {
    assert.deepEqual((s => (s.auto.apply(), s.set))(setup({}, "123")), ["online"]);
    assert.deepEqual((s => (s.auto.apply(), s.set))(setup({}, null)), ["invisible"]);
});

test("switches when you join or leave, ignores other people", () => {
    const { auto, set } = setup({ statusInCall: "dnd", statusOutsideCall: "online" });
    auto.onUpdates([{ userId: friend, channelId: "123" }]);
    auto.onUpdates([{ userId: me, channelId: "123" }]);
    auto.onUpdates([{ userId: me, channelId: null }]);
    assert.deepEqual(set, ["dnd", "online"]);
});
