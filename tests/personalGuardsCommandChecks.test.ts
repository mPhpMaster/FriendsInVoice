import assert from "node:assert/strict";
import { test } from "node:test";

import { applyGuardAccountSource } from "../friendsInVoice/personalGuardsAccount";
import { guardCommandRejection, GUARD_COMMAND_COOLDOWN, reserveGuardCommand } from "../friendsInVoice/personalGuardsCommandChecks";
import type { GuardCommandContext } from "../friendsInVoice/personalGuardsCommandTypes";
import { openGuardPayload, publicKeyString, sealGuardPayload } from "../friendsInVoice/personalGuardsCrypto";
import { GUARD_ACTIONS, makeCommand, newGuardNonce } from "../friendsInVoice/personalGuardsProtocol";
import type { GuardAction, GuardsStore } from "../friendsInVoice/personalGuardsTypes";

const ownerId = "123456789012345678", guardianId = "234567890123456789", outsiderId = "345678901234567890";
const pair = () => crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
function store(nonce: string): GuardsStore {
    return { personalGuards: [{ userId: guardianId, actions: [...GUARD_ACTIONS], inviteNonce: nonce }],
        knownGuardGrants: [], pendingGuardInvites: [], declinedGuardInvites: [], guardPeerKeys: [], guardReplay: [], guardBlocks: [] };
}

test("restored acceptance supports all three encrypted actions from different guardian devices", async () => {
    const owner = await pair(), nonce = newGuardNonce(), receiver = store(nonce);
    const ownerKey = await publicKeyString(owner);
    const applied: GuardAction[] = [];
    for (const device of ["computer one", "computer two", "browser"]) {
        const guardian = await pair(); // independent installation, no old guardian private key
        const restored = store(newGuardNonce());
        applyGuardAccountSource(restored, { decision: "accept", invite: { userId: ownerId, nonce, publicKey: ownerKey,
            actions: [...GUARD_ACTIONS], messageId: "567890123456789012", channelId: "456789012345678901" } });
        for (const action of restored.knownGuardGrants[0].actions) {
            const command = makeCommand(ownerId, action, restored.knownGuardGrants[0].inviteNonce);
            const wire = await sealGuardPayload(command, guardian, restored.guardPeerKeys[0].publicKey, guardianId, ownerId);
            const decoded = await openGuardPayload(wire, owner, guardianId, ownerId);
            assert.equal(decoded?.kind, "command", device);
            if (decoded?.kind !== "command") throw new Error("Command was not decrypted");
            const now = Date.now() + applied.length * GUARD_COMMAND_COOLDOWN;
            const context = { ownerId, senderId: guardianId, senderKey: wire.fromKey, sharesVoice: true, now };
            assert.equal(guardCommandRejection(receiver, decoded, context), null, `${device}: ${action}`);
            reserveGuardCommand(receiver, decoded, guardianId, now);
            applied.push(decoded.action);
        }
    }
    assert.equal(applied.length, 9);
});

test("a different account cannot gain authority even with the public owner key and a copied valid invitation nonce", async () => {
    const owner = await pair(), attacker = await pair(), nonce = newGuardNonce(), receiver = store(nonce);
    const wire = await sealGuardPayload(makeCommand(ownerId, "mute", nonce), attacker, await publicKeyString(owner), outsiderId, ownerId);
    const decoded = await openGuardPayload(wire, owner, outsiderId, ownerId);
    assert.equal(decoded?.kind, "command");
    if (decoded?.kind !== "command") throw new Error("Test payload did not decrypt");
    assert.match(guardCommandRejection(receiver, decoded, { ownerId, senderId: outsiderId, senderKey: wire.fromKey, sharesVoice: true, now: Date.now() })!, /not allowed/);
    assert.deepEqual(receiver.guardReplay, []);
});

test("revoked grants, old invitations, wrong actions, wrong accounts, blocks and voice constraints are rejected", () => {
    const nonce = newGuardNonce(), receiver = store(nonce), command = makeCommand(ownerId, "mute", nonce);
    const context: GuardCommandContext = { ownerId, senderId: guardianId, senderKey: "new-device-key", sharesVoice: true, now: Date.now() };
    assert.equal(guardCommandRejection(receiver, command, context), null);
    assert.ok(guardCommandRejection(receiver, { ...command, inviteNonce: newGuardNonce() }, context));
    assert.ok(guardCommandRejection(receiver, { ...command, ownerId: outsiderId }, context));
    assert.ok(guardCommandRejection(receiver, command, { ...context, sharesVoice: false }));
    receiver.personalGuards[0].actions = ["deafen"];
    assert.ok(guardCommandRejection(receiver, command, context));
    receiver.personalGuards = [];
    assert.ok(guardCommandRejection(receiver, command, context));
    receiver.personalGuards = [{ userId: guardianId, actions: ["mute"], inviteNonce: nonce }];
    receiver.guardBlocks = [{ userId: guardianId, until: context.now + 60000 }];
    assert.ok(guardCommandRejection(receiver, command, context));
});

test("duplicate and rapid commands are reserved before execution, including after simulated restart", () => {
    const nonce = newGuardNonce(), receiver = store(nonce), command = makeCommand(ownerId, "mute", nonce);
    const context = { ownerId, senderId: guardianId, senderKey: "device-key", sharesVoice: true, now: Date.now() };
    assert.equal(guardCommandRejection(receiver, command, context), null);
    reserveGuardCommand(receiver, command, guardianId, context.now);
    const restarted = JSON.parse(JSON.stringify(receiver)) as GuardsStore;
    assert.match(guardCommandRejection(restarted, command, context)!, /Duplicate/);
    const fresh = makeCommand(ownerId, "deafen", nonce);
    assert.match(guardCommandRejection(restarted, fresh, context)!, /three seconds/);
    assert.equal(guardCommandRejection(restarted, fresh, { ...context, now: context.now + GUARD_COMMAND_COOLDOWN }), null);
    assert.ok(guardCommandRejection(receiver, command, { ...context, now: context.now + 6 * 60_000 }));
});

test("modifying an encrypted action is rejected before authorization", async () => {
    const owner = await pair(), guardian = await pair();
    const wire = await sealGuardPayload(makeCommand(ownerId, "mute", newGuardNonce()), guardian, await publicKeyString(owner), guardianId, ownerId);
    const changed = { ...wire, ciphertext: (wire.ciphertext[0] === "A" ? "B" : "A") + wire.ciphertext.slice(1) };
    assert.equal(await openGuardPayload(changed, owner, guardianId, ownerId), null);
    assert.equal(await openGuardPayload(wire, owner, outsiderId, ownerId), null);
});
