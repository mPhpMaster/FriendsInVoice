import assert from "node:assert/strict";
import { build } from "esbuild";
import { indexedDB } from "fake-indexeddb";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fakeGuardServer } from "./fakeGuardServer.mjs";
import { DataStore } from "../src/data.js";
import { memoryStore } from "./memoryStore.mjs";

const ownerId = "111111111111111111", guardianId = "222222222222222222", outsiderId = "333333333333333333";

async function modules() {
    const result = await build({ stdin: { contents: `
        export { GuardService } from "./src/guards.js";
        export { codeFromText } from "../friendsInVoice/guardServer.ts";
    `, resolveDir: fileURLToPath(new URL("..", import.meta.url)) }, bundle: true, platform: "node", format: "esm", write: false });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

async function data(id, server) {
    const value = new DataStore({ Data: { load: () => null, save() {} } }, memoryStore());
    await value.useAccount(id);
    value.value.guardServer = server;
    return value;
}

test("pairing with a code and a guard command go only through the Friends in Voice server", async () => {
    const previous = globalThis.indexedDB;
    globalThis.indexedDB = indexedDB;
    const server = fakeGuardServer("http://127.0.0.1:1");
    const { base } = server;
    const services = [];
    try {
        const { GuardService, codeFromText } = await modules();
        const urls = [], drafts = [], applied = [], notices = [];
        const transport = async ({ method, url, token, body }) => {
            urls.push(url);
            return server.transport({ method, url, token, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
        };
        const api = { UI: { showToast() {}, showNotice: (text, options) => notices.push({ text, options }) } };
        const bridge = me => ({ currentId: () => me, name: id => id, myVoiceChannel: () => "voice", sharesVoice: () => true,
            prepareDm: async (id, text) => drafts.push({ id, text }),
            applyGuardAction: action => { applied.push(action); return () => {}; } });
        const make = async id => {
            const service = new GuardService(api, bridge(id), await data(id, base), () => {}, { transport, meta: memoryStore(), poll: false });
            services.push(service);
            return service;
        };
        const owner = await make(ownerId), guardian = await make(guardianId), outsider = await make(outsiderId);

        owner.setGrant(guardianId, ["mute", "deafen"]);
        const { code } = await owner.invite(guardianId);
        await owner.draftCode(guardianId, code);
        assert.equal(codeFromText(drafts[0].text), code, "the code the owner sends is one plain line");
        assert.equal(await outsider.lookup(code), null, "a code only works for the chosen guardian");

        const offer = await guardian.lookup(code.toLowerCase());
        assert.deepEqual([offer.ownerId, offer.actions], [ownerId, ["mute", "deafen"]]);
        assert.equal(await guardian.decide(offer.code, true), true);
        assert.deepEqual(guardian.knownFor(ownerId), ["mute", "deafen"]);
        await owner.refresh(true);
        assert.ok(owner.data.value.personalGuards[0].pairId);

        const before = (await owner.client.events(0, 0)).last;
        await guardian.sendCommand(ownerId, "mute");
        await guardian.sendCommand(ownerId, "disconnect");
        const { events } = await owner.client.events(before, 0);
        await owner.onEvents(events);
        assert.deepEqual(applied, [], "nothing runs before you click Allow");
        assert.equal(notices.length, 1);
        assert.match(notices[0].text, /wants to use/);
        const allow = notices[0].options.buttons.find(item => item.label === "Allow");
        allow.onClick();
        allow.onClick();
        assert.deepEqual(applied, ["mute"], "only the allowed action runs, once, after Allow");
        assert.equal(notices.length, 2);

        owner.revoke(guardianId);
        await new Promise(resolve => setTimeout(resolve, 50));
        await guardian.refresh(true);
        assert.deepEqual(guardian.knownFor(ownerId), []);
        assert.ok(urls.length > 0 && urls.every(url => url.startsWith(base)), "no request goes to Discord");
    } finally {
        for (const service of services) service.stop();
        globalThis.indexedDB = previous;
    }
});
