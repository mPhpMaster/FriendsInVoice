import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const pluginFile = new URL("../FriendsInVoice.plugin.js", import.meta.url);
const currentId = "111111111111111111";
const guardianId = "222222222222222222";

function mockApi() {
    const calls = { subscriptions: [], unsubscriptions: [], menu: null, unpatched: false, saved: [] };
    const stores = {
        UserStore: { getCurrentUser: () => ({ id: currentId }), getUser: id => ({ id, username: `user-${id}` }) },
        ChannelStore: { getChannel: () => null },
        VoiceStateStore: { getVoiceStateForUser: () => null, getAllVoiceStates: () => ({}) },
        RelationshipStore: { getFriendIDs: () => [], getNickname: () => null },
        PermissionStore: { can: () => true },
        PresenceStore: { getStatus: () => "offline" },
        SelectedChannelStore: { getChannelId: () => null },
        MessageStore: { getLastMessage: () => null }
    };
    const dispatcher = {
        subscribe: (event, handler) => calls.subscriptions.push([event, handler]),
        unsubscribe: (event, handler) => calls.unsubscriptions.push([event, handler]),
        dispatch() {}
    };
    const api = {
        Data: { load: () => null, save: (key, value) => calls.saved.push([key, value]) },
        Webpack: {
            getStore: name => stores[name],
            getByKeys: (...keys) => keys.includes("subscribe") ? dispatcher : {}
        },
        ContextMenu: {
            patch: (_id, callback) => { calls.menu = callback; return () => { calls.unpatched = true; }; },
            buildMenuChildren: groups => groups[0].items
        },
        DOM: { addStyle() {}, removeStyle() {} },
        Net: { fetch: async () => ({ ok: true, json: async () => ({ tag_name: "v1.10.0", assets: [] }) }) },
        UI: { showToast() {}, showNotice() {} },
        Logger: { error() {} }
    };
    return { api, calls };
}

test("bundle has BetterDiscord metadata, starts, patches menu, and fully stops", async () => {
    const text = await readFile(pluginFile, "utf8");
    assert.match(text, /^\/\*\*[\s\S]*@name FriendsInVoice[\s\S]*@version 1\.10\.0/);
    const directory = await mkdtemp(join(tmpdir(), "friendsinvoice-bd-test-"));
    const target = join(directory, "FriendsInVoice.plugin.js");
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const original = { document: globalThis.document, window: globalThis.window, BdApi: globalThis.BdApi };
    try {
        await copyFile(pluginFile, target);
        globalThis.document = dom.window.document;
        globalThis.window = dom.window;
        const { api, calls } = mockApi();
        globalThis.BdApi = class { constructor() { return api; } };
        const Plugin = require(target);
        assert.equal(typeof Plugin, "function");
        const plugin = new Plugin({ version: "1.10.0" });
        plugin.start();
        assert.ok(document.querySelector(".fivbd-launch"));
        assert.ok(calls.subscriptions.some(([event]) => event === "MESSAGE_CREATE"));
        const tree = { props: { children: [] } };
        calls.menu(tree, { user: { id: guardianId } });
        const guards = tree.props.children.find(item => item.id === "fivbd-guards");
        assert.ok(guards);
        guards.items.find(item => item.id === "fivbd-add-guardian").action();
        assert.deepEqual(plugin.data.value.personalGuards[0], { userId: guardianId, actions: [] });
        assert.ok(document.querySelector(".fivbd-shade"));
        plugin.stop();
        assert.equal(document.querySelector(".fivbd-launch"), null);
        assert.equal(document.querySelector(".fivbd-shade"), null);
        assert.equal(calls.unpatched, true);
        assert.equal(calls.subscriptions.length, calls.unsubscriptions.length);
    } finally {
        dom.window.close();
        globalThis.document = original.document;
        globalThis.window = original.window;
        globalThis.BdApi = original.BdApi;
        await rm(directory, { recursive: true, force: true });
    }
});
