import assert from "node:assert/strict";
import { test } from "node:test";

import { DiscordBridge } from "../src/discord.js";

const me = "111111111111111111";
const friend = "222222222222222222";
const here = "333333333333333333";
const elsewhere = "444444444444444444";

// Discord's real export shapes: the dispatcher and ComponentDispatch sit under minified names ("h", "_"),
// so BdApi's default lookup (exports object or its default) misses them; searchExports checks every export.
function webpackLike(modules) {
    const find = (filter, options = {}) => {
        for (const exports of modules) {
            if (filter(exports)) return exports;
            if (options.searchExports) for (const value of Object.values(exports)) if (value && filter(value)) return value;
        }
        return undefined;
    };
    return {
        getModule: find,
        getByKeys: (...args) => {
            const options = typeof args.at(-1) === "object" ? args.pop() : {};
            return find(value => args.every(key => key in value), options);
        },
    };
}

function bridge({ myStates = { [here]: [me, friend] } } = {}) {
    const updates = [];
    const dispatcher = { subscribe() {}, unsubscribe() {}, dispatch() {} };
    const modules = [
        { A: { DISPATCH: 1 }, h: dispatcher },
        { _: { dispatchToLastSubscribed() {} }, H: {} },
        { jP: { getSetting: () => "online", updateSetting: value => updates.push(value), useSetting() {} } },
        { other: { getSetting: () => true, updateSetting: () => { throw new Error("wrong setting"); } } },
    ];
    const stores = {
        UserStore: { getCurrentUser: () => ({ id: me }), getUser: id => ({ id }) },
        ChannelStore: { getChannel: () => undefined },
        RelationshipStore: { getFriendIDs: () => [friend] },
        PermissionStore: { can: () => true },
        SelectedChannelStore: { getVoiceChannelId: () => here, getChannelId: () => null },
        VoiceStateStore: {
            // this account is also in voice on another device; Discord may return that session for "me"
            getVoiceStateForUser: id => ({ userId: id, channelId: id === me ? elsewhere : here }),
            getVoiceStatesForChannel: id => Object.fromEntries((myStates[id] ?? []).map(user => [user, { userId: user, channelId: id }])),
            getAllVoiceStates: () => ({}),
        },
    };
    const api = { Webpack: { getStore: name => stores[name], ...webpackLike(modules) } };
    return { bridge: new DiscordBridge(api), dispatcher, updates };
}

test("finds Discord's dispatcher and composer under their minified export names", () => {
    const { bridge: b, dispatcher } = bridge();
    assert.equal(b.dispatcher, dispatcher);
    assert.equal(typeof b.componentDispatch.dispatchToLastSubscribed, "function");
});

test("Go invisible updates Discord's status setting, not another setting", async () => {
    const { bridge: b, updates } = bridge();
    await b.setInvisible();
    assert.deepEqual(updates, ["invisible"]);
});

test("shared voice uses this client's channel even when this account is in voice elsewhere", () => {
    assert.equal(bridge().bridge.sharesVoice(friend), true);
    assert.equal(bridge({ myStates: { [here]: [me] } }).bridge.sharesVoice(friend), false);
});
