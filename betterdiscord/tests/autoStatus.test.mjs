import assert from "node:assert/strict";
import { test } from "node:test";

import { AutoStatus } from "../src/autoStatus.js";
import { normalizeData } from "../src/data.js";

const me = "111111111111111111";
const friend = "222222222222222222";

function setup(value = {}, myChannel = null) {
    const set = [], notices = [];
    const state = { channel: myChannel, status: undefined, time: 0, timers: [] };
    const bridge = {
        currentId: () => me,
        myVoiceChannel: () => state.channel,
        currentStatus: () => state.status,
        setStatus: async status => { set.push(status); state.status = status; }
    };
    const timers = {
        set: (run, delay) => { const timer = { run, at: state.time + delay }; state.timers.push(timer); return timer; },
        clear: timer => { state.timers = state.timers.filter(item => item !== timer); }
    };
    const advance = ms => {
        state.time += ms;
        for (const timer of state.timers.filter(item => item.at <= state.time)) { timers.clear(timer); timer.run(); }
    };
    const data = { value: normalizeData({ autoStatus: true, ...value }) };
    const api = { Logger: { error() {} }, UI: { showNotice: (text, options) => notices.push({ text, options }) } };
    const click = () => notices.at(-1).options.buttons[0].onClick();
    return { auto: new AutoStatus(api, bridge, data, timers), set, notices, state, advance, click };
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
    const { auto, set, notices, advance } = setup({ autoStatus: false }, "123");
    auto.apply();
    auto.onUpdates([{ userId: me, channelId: "123" }]);
    advance(20_000);
    assert.deepEqual([set, notices], [[], []]);
});

test("never changes the status by itself: it asks, and changes only after a click", () => {
    const { auto, set, notices, click } = setup({}, "123");
    auto.apply();
    assert.deepEqual(set, []);
    assert.equal(notices.length, 1);
    assert.match(notices[0].text, /Online/);
    click();
    assert.deepEqual(set, ["online"]);
});

test("asks 10 seconds after you join or leave, once per change, ignores other people", () => {
    const { auto, set, notices, state, advance, click } = setup({ statusInCall: "dnd", statusOutsideCall: "online" });
    auto.onUpdates([{ userId: friend, channelId: "123" }]);
    advance(20_000);
    assert.equal(notices.length, 0);
    state.channel = "123";
    auto.onUpdates([{ userId: me, channelId: "123" }]);
    advance(5_000);
    assert.equal(notices.length, 0, "waits for things to settle");
    advance(5_000);
    assert.equal(notices.length, 1);
    auto.apply();
    assert.equal(notices.length, 1, "the same suggestion isn't repeated");
    click();
    state.channel = null;
    auto.onUpdates([{ userId: me, channelId: null }]);
    advance(10_000);
    click();
    assert.deepEqual(set, ["dnd", "online"]);
});

test("channel hopping ends in one suggestion", () => {
    const { auto, notices, state, advance } = setup({ statusInCall: "dnd", statusOutsideCall: "online" });
    for (let i = 0; i < 10; i++) {
        state.channel = i % 2 ? null : "123";
        auto.onUpdates([{ userId: me, channelId: state.channel }]);
        advance(2_000);
    }
    advance(10_000);
    assert.equal(notices.length, 1);
    assert.match(notices[0].text, /Online/);
});
