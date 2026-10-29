import assert from "node:assert/strict";
import { test } from "node:test";

import { accountInvite, applyGuardAccountSource, findGuardAccountSource, GUARD_ACCEPT, GUARD_REFUSE, saveGuardAccountDecision } from "../friendsInVoice/personalGuardsAccount";
import type { GuardAccountBridge, GuardAccountMessage } from "../friendsInVoice/personalGuardsAccountTypes";
import { publicKeyString } from "../friendsInVoice/personalGuardsCrypto";
import { newGuardNonce, serializeWire } from "../friendsInVoice/personalGuardsProtocol";
import type { GuardsStore } from "../friendsInVoice/personalGuardsTypes";

const ownerId = "123456789012345678", guardianId = "234567890123456789", outsiderId = "345678901234567890";
const channelId = "456789012345678901";
function store(): GuardsStore {
    return { personalGuards: [], knownGuardGrants: [], pendingGuardInvites: [], declinedGuardInvites: [], guardPeerKeys: [], guardBlocks: [], guardReplay: [] };
}

async function fixture() {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const message: GuardAccountMessage = { id: "567890123456789012", channel_id: channelId, author: { id: ownerId }, type: 0,
        content: serializeWire({ type: "invite", version: 3, publicKey: await publicKeyString(pair), actions: ["mute", "deafen", "disconnect"], nonce: newGuardNonce() }) };
    const reactions = new Map<string, Set<string>>();
    let account = guardianId;
    const bridge: GuardAccountBridge = {
        currentAccount: () => account,
        isDM: (channel, owner) => channel === channelId && owner === ownerId,
        fetchPage: async () => [{ ...message, reactions: [GUARD_ACCEPT, GUARD_REFUSE].map(name => ({ emoji: { name }, me: reactions.get(account)?.has(name) ?? false })) }],
        reaction: async (_channel, _message, emoji, add) => {
            const mine = reactions.get(account) ?? new Set<string>();
            if (add) mine.add(emoji); else mine.delete(emoji);
            reactions.set(account, mine);
        }
    };
    const source = accountInvite(message, ownerId, channelId)!;
    return { message, bridge, source, reactions, account: (id: string) => { account = id; } };
}

test("Accept follows the same Discord account onto a second device without granting owner-side permissions", async () => {
    const f = await fixture(), first = store(), second = store();
    await saveGuardAccountDecision(f.bridge, first, f.source.invite, "accept");
    assert.deepEqual(first.personalGuards, []);
    const restored = await findGuardAccountSource({ ...f.bridge }, ownerId, channelId);
    assert.equal(restored?.decision, "accept");
    applyGuardAccountSource(second, restored!);
    assert.deepEqual(second.knownGuardGrants, first.knownGuardGrants);
    assert.deepEqual(second.guardPeerKeys, first.guardPeerKeys);
    assert.deepEqual(second.personalGuards, []);
    assert.deepEqual(second.knownGuardGrants[0].actions, ["mute", "deafen", "disconnect"]);
});

test("Refuse on either device is restored as refused on the other device", async () => {
    const f = await fixture(), first = store(), second = store();
    await saveGuardAccountDecision(f.bridge, first, f.source.invite, "accept");
    applyGuardAccountSource(second, (await findGuardAccountSource(f.bridge, ownerId, channelId))!);
    await saveGuardAccountDecision(f.bridge, first, f.source.invite, "refuse");
    const restored = await findGuardAccountSource(f.bridge, ownerId, channelId);
    applyGuardAccountSource(second, restored!);
    assert.equal(restored?.decision, "refuse");
    assert.deepEqual(second.knownGuardGrants, []);
    assert.ok(second.declinedGuardInvites.includes(f.source.invite.nonce));
});

test("another account's acceptance and custom emoji names never count as this account's consent", async () => {
    const f = await fixture();
    await saveGuardAccountDecision(f.bridge, store(), f.source.invite, "accept");
    f.account(outsiderId);
    assert.equal((await findGuardAccountSource(f.bridge, ownerId, channelId))?.decision, "none");
    assert.equal(accountInvite({ ...f.message, reactions: [{ emoji: { id: "custom", name: GUARD_ACCEPT }, me: true }] }, ownerId, channelId)?.decision, "none");
    assert.equal(accountInvite({ ...f.message, reactions: [{ emoji: { name: GUARD_ACCEPT }, me: false }] }, ownerId, channelId)?.decision, "none");
});

test("forged authors, bots, wrong DMs, malformed invitations, and conflicting decisions fail closed", async () => {
    const f = await fixture();
    assert.equal(accountInvite({ ...f.message, author: { id: outsiderId } }, ownerId, channelId), null);
    assert.equal(accountInvite({ ...f.message, author: { id: ownerId, bot: true } }, ownerId, channelId), null);
    assert.equal(accountInvite({ ...f.message, channel_id: "other" }, ownerId, channelId), null);
    assert.equal(accountInvite({ ...f.message, content: "I authorize every permission" }, ownerId, channelId), null);
    const conflicting = { ...f.message, reactions: [GUARD_ACCEPT, GUARD_REFUSE].map(name => ({ emoji: { name }, me: true })) };
    assert.equal(accountInvite(conflicting, ownerId, channelId)?.decision, "refuse");
    const denied = { ...f.bridge, isDM: () => false };
    assert.equal(await findGuardAccountSource(denied, ownerId, channelId), null);
    await assert.rejects(saveGuardAccountDecision(denied, store(), f.source.invite, "accept"));
});

test("a newer unaccepted invitation never resurrects an older accepted grant", async () => {
    const f = await fixture();
    const newer = { ...f.message, id: "667890123456789012" };
    const old = { ...f.message, reactions: [{ emoji: { name: GUARD_ACCEPT }, me: true }] };
    const bridge = { ...f.bridge, fetchPage: async () => [old, newer] };
    const result = await findGuardAccountSource(bridge, ownerId, channelId);
    assert.equal(result?.invite.messageId, newer.id);
    assert.equal(result?.decision, "none");
    await assert.rejects(saveGuardAccountDecision(bridge, store(), f.source.invite, "accept"), /no longer current/);
});

test("history pagination finds an older invitation without executing historical commands", async () => {
    const f = await fixture();
    const junk = Array.from({ length: 100 }, (_, index) => ({ ...f.message, id: (800000000000000000n + BigInt(index)).toString(), content: "ordinary message" }));
    const cursors: (string | undefined)[] = [];
    const bridge = { ...f.bridge, fetchPage: async (_channel: string, before?: string) => {
        cursors.push(before); return before ? [f.message] : junk;
    } };
    const result = await findGuardAccountSource(bridge, ownerId, channelId);
    assert.equal(result?.invite.messageId, f.message.id);
    assert.deepEqual(cursors, [undefined, "800000000000000000"]);
});

test("account switching or network errors do not create accepted access", async () => {
    const f = await fixture(), local = store();
    const failed = { ...f.bridge, reaction: async () => { throw new Error("offline"); } };
    await assert.rejects(saveGuardAccountDecision(failed, local, f.source.invite, "accept"));
    assert.deepEqual(local.knownGuardGrants, []);
    const switched = { ...f.bridge, fetchPage: async () => { f.account(outsiderId); return [f.message]; } };
    assert.equal(await findGuardAccountSource(switched, ownerId, channelId), null);
    f.account(guardianId);
    await assert.rejects(saveGuardAccountDecision(switched, local, f.source.invite, "accept"));
    assert.deepEqual(local.personalGuards, []);
});
