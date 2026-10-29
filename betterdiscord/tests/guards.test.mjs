import assert from "node:assert/strict";
import { build } from "esbuild";
import { indexedDB } from "fake-indexeddb";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DataStore } from "../src/data.js";

const ownerId = "111111111111111111";
const guardianId = "222222222222222222";

async function guardModules() {
    const source = `
        export { GuardService } from "./src/guards.js";
        export { publicKeyString, openGuardPayload, sealGuardPayload } from "../friendsInVoice/personalGuardsCrypto.ts";
        export { makeCommand, parseGuardMessage, serializeWire } from "../friendsInVoice/personalGuardsProtocol.ts";
    `;
    const result = await build({ stdin: { contents: source, resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
        bundle: true, platform: "node", format: "esm", write: false });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("BetterDiscord guard adapter exchanges encrypted grants and enforces actions", async () => {
    const previous = globalThis.indexedDB;
    globalThis.indexedDB = indexedDB;
    try {
        const { GuardService, publicKeyString, openGuardPayload, sealGuardPayload, makeCommand, parseGuardMessage, serializeWire } = await guardModules();
        const drafts = [];
        const applied = [];
        const bridge = {
            currentId: () => ownerId, prepareDm: async (id, text) => drafts.push({ id, text }),
            channel: () => ({ isDM: () => true, recipients: [guardianId] }), isDm: channel => channel.isDM(),
            sharesVoice: () => true, applyGuardAction: action => { applied.push(action); return () => {}; },
            name: id => id
        };
        const api = { UI: { showToast() {}, showNotice() {} } };
        const data = new DataStore({ Data: { load: () => null, save() {} } });
        await data.useAccount(ownerId);
        data.grant(guardianId, ["mute"]);
        const service = new GuardService(api, bridge, data, () => {});
        const guardianPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
        const guardianKey = await publicKeyString(guardianPair);
        await service.onMessage({ id: "key-1", channel_id: "dm", content: serializeWire({ type: "key", version: 2, publicKey: guardianKey }), author: { id: guardianId } });
        assert.equal(service.keyFor(guardianId), guardianKey);
        await service.sendGrant(guardianId);
        assert.equal(drafts.length, 1);
        assert.equal(drafts[0].id, guardianId);
        assert.equal(drafts[0].text.includes('"mute"'), false);
        const grantWire = parseGuardMessage(drafts[0].text);
        const grant = await openGuardPayload(grantWire, guardianPair, ownerId, guardianId);
        assert.deepEqual(grant.actions, ["mute"]);
        const ownerKey = grantWire.fromKey;
        const allowed = await sealGuardPayload(makeCommand(ownerId, "mute"), guardianPair, ownerKey, guardianId, ownerId);
        const denied = await sealGuardPayload(makeCommand(ownerId, "disconnect"), guardianPair, ownerKey, guardianId, ownerId);
        await service.onMessage({ id: "command-1", channel_id: "dm", content: serializeWire(allowed), author: { id: guardianId } });
        await service.onMessage({ id: "command-2", channel_id: "dm", content: serializeWire(allowed), author: { id: guardianId } });
        await service.onMessage({ id: "command-3", channel_id: "dm", content: serializeWire(denied), author: { id: guardianId } });
        assert.deepEqual(applied, ["mute"]);
        service.stop();
    } finally { globalThis.indexedDB = previous; }
});
