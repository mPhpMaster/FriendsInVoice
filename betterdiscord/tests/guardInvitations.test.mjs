import assert from "node:assert/strict";
import { build } from "esbuild";
import { indexedDB } from "fake-indexeddb";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DataStore, normalizeData } from "../src/data.js";

const ownerId = "111111111111111111", guardianId = "222222222222222222", outsiderId = "333333333333333333";
const channelId = "444444444444444444";
const messageId = "555555555555555555";

async function modules() {
    const result = await build({ stdin: { contents: `
        export { GuardService } from "./src/guards.js";
        export { makeCommand, parseGuardMessage, serializeWire } from "../friendsInVoice/personalGuardsProtocol.ts";
        export { sealGuardPayload } from "../friendsInVoice/personalGuardsCrypto.ts";
    `, resolveDir: fileURLToPath(new URL("..", import.meta.url)) }, bundle: true, platform: "node", format: "esm", write: false });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

async function data(id) {
    const entries = new Map();
    const value = new DataStore({ Data: { load: () => null, save() {} } }, {
        get: async key => entries.get(key), put: async (key, entry) => entries.set(key, structuredClone(entry))
    });
    await value.useAccount(id);
    return value;
}

test("BetterDiscord invitation accepts across devices and interoperates with Vencord encrypted actions", async () => {
    const previous = globalThis.indexedDB;
    globalThis.indexedDB = indexedDB;
    const services = [];
    try {
        const { GuardService, makeCommand, parseGuardMessage, serializeWire, sealGuardPayload } = await modules();
        const drafts = [], applied = [], notices = [], reactions = new Set();
        let messages = [];
        const api = { UI: { showToast() {}, showNotice: (text, options) => notices.push({ text, options }) } };
        const bridge = (me, peer) => ({ currentId: () => me, name: id => id, selectedChannel: () => channelId,
            channel: () => ({ id: channelId, isDM: () => true, recipients: [peer] }), isDm: value => value.isDM(),
            channelStore: { getDMFromUserId: () => channelId }, sharesVoice: () => true,
            prepareDm: async (id, text) => drafts.push({ id, text }),
            guardHistory: async () => messages.map(message => ({ ...message, reactions: [...reactions].map(name => ({ emoji: { name }, me: true })) })),
            guardReaction: async (_channel, _message, emoji, add) => add ? reactions.add(emoji) : reactions.delete(emoji),
            applyGuardAction: action => { applied.push(action); return () => {}; }
        });
        const ownerData = await data(ownerId), guardianData = await data(guardianId);
        ownerData.grant(guardianId, ["mute"]);
        const owner = new GuardService(api, bridge(ownerId, guardianId), ownerData, () => {});
        const guardian = new GuardService(api, bridge(guardianId, ownerId), guardianData, () => {});
        services.push(owner, guardian);
        await owner.invite(guardianId);
        const wire = parseGuardMessage(drafts[0].text);
        assert.equal(wire.type, "invite");
        messages = [{ id: messageId, channel_id: channelId, author: { id: ownerId }, content: drafts[0].text }];
        await guardian.onMessage(messages[0]);
        assert.deepEqual(guardianData.value.knownGuardGrants, []);
        assert.equal(guardianData.value.pendingGuardInvites.length, 1);
        assert.ok(notices.some(item => item.options?.buttons.some(button => button.label === "Accept")));
        await guardian.decide(guardianData.value.pendingGuardInvites[0], true);
        assert.deepEqual(guardian.knownFor(ownerId), ["mute"]);
        assert.deepEqual(guardianData.value.personalGuards, []);
        const deviceData = await data(guardianId);
        const device = new GuardService(api, bridge(guardianId, ownerId), deviceData, () => {});
        services.push(device);
        assert.equal(await device.account.sync(ownerId), true);
        assert.deepEqual(device.knownFor(ownerId), ["mute"]);
        await device.sendCommand(ownerId, "mute");
        const command = parseGuardMessage(drafts.at(-1).text);
        await owner.onMessage({ id: "600000000000000001", channel_id: channelId, author: { id: guardianId }, content: serializeWire(command) });
        await owner.onMessage({ id: "600000000000000002", channel_id: channelId, author: { id: guardianId }, content: serializeWire(command) });
        assert.deepEqual(applied, ["mute"]);
        const freshPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
        const forbidden = await sealGuardPayload(makeCommand(ownerId, "disconnect", wire.nonce), freshPair, wire.publicKey, guardianId, ownerId);
        await owner.onMessage({ id: "600000000000000003", channel_id: channelId, author: { id: guardianId }, content: serializeWire(forbidden) });
        assert.deepEqual(applied, ["mute"]);
        const outsiderData = await data(ownerId);
        outsiderData.grant(guardianId, ["mute"]);
        const isolated = new GuardService(api, bridge(ownerId, outsiderId), outsiderData, () => {});
        services.push(isolated);
        const forged = await sealGuardPayload(makeCommand(ownerId, "mute", wire.nonce), freshPair, wire.publicKey, outsiderId, ownerId);
        await isolated.onMessage({ id: "600000000000000004", channel_id: channelId, author: { id: outsiderId }, content: serializeWire(forged) });
        assert.deepEqual(applied, ["mute"]);
        await device.removeAccess(ownerId);
        assert.equal(await guardian.account.sync(ownerId), false);
        assert.deepEqual(guardian.knownFor(ownerId), []);
        assert.ok(reactions.has("❌"));
        assert.ok(!reactions.has("✅"));
        const normalized = normalizeData(ownerData.value);
        assert.equal(normalized.personalGuards[0].inviteNonce, wire.nonce);
        assert.equal(normalized.guardReplay[0].guardianId, guardianId);
        owner.revoke(guardianId);
        assert.deepEqual(owner.grantFor(guardianId), []);
    } finally {
        for (const service of services) service.stop();
        globalThis.indexedDB = previous;
    }
});
