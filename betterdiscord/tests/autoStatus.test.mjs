import assert from "node:assert/strict";
import { test } from "node:test";

import { AutoStatus } from "../src/autoStatus.js";
import { normalizeData } from "../src/data.js";

const me = "111111111111111111";
const friend = "222222222222222222";

function setup(value = {}, myChannel = null) {
    const set = [];
    const state = { channel: myChannel, status: undefined, time: 0, timers: [] };
    const bridge = {
        currentId: () => me,
        myVoiceChannel: () => state.channel,
        currentStatus: () => state.status,
        setStatus: async status => { set.push(status); state.status = status; }
    };
    const timers = {
        now: () => state.time,
        set: (run, delay) => { const timer = { run, at: state.time + delay }; state.timers.push(timer); return timer; },
        clear: timer => { state.timers = state.timers.filter(item => item !== timer); }
    };
    const advance = ms => {
        state.time += ms;
        for (const timer of state.timers.filter(item => item.at <= state.time)) { timers.clear(timer); timer.run(); }
    };
    const data = { value: normalizeData({ autoStatus: true, ...value }) };
    const api = { Logger: { error() {} } };
    return { auto: new AutoStatus(api, bridge, data, timers), set, state, advance };
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

test("switches when you join or leave, 10 seconds after the last change, ignores other people", () => {
    const { auto, set, state, advance } = setup({ statusInCall: "dnd", statusOutsideCall: "online" });
    auto.onUpdates([{ userId: friend, channelId: "123" }]);
    advance(20_000);
    assert.deepEqual(set, []);
    state.channel = "123";
    auto.onUpdates([{ userId: me, channelId: "123" }]);
    advance(5_000);
    assert.deepEqual(set, [], "waits for things to settle");
    advance(5_000);
    assert.deepEqual(set, ["dnd"]);
    state.channel = null;
    auto.onUpdates([{ userId: me, channelId: null }]);
    advance(10_000);
    assert.deepEqual(set, ["dnd", "online"]);
});

test("channel hopping ends in one status change", () => {
    const { auto, set, state, advance } = setup({ statusInCall: "dnd", statusOutsideCall: "online" });
    for (let i = 0; i < 10; i++) {
        state.channel = i % 2 ? null : "123";
        auto.onUpdates([{ userId: me, channelId: state.channel }]);
        advance(2_000);
    }
    advance(10_000);
    assert.deepEqual(set, ["online"]);
});

test("never more than 3 automatic changes a minute", () => {
    const { auto, set, state, advance } = setup({ statusInCall: "dnd", statusOutsideCall: "online" });
    for (let i = 0; i < 6; i++) {
        state.channel = i % 2 ? null : "123";
        auto.apply();
        advance(1_000);
    }
    assert.equal(set.length, 3);
    advance(60_000);
    assert.equal(set.length, 4, "catches up once the minute is over");
});
