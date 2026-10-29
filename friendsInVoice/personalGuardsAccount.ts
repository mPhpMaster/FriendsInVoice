/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { GuardAccountBridge, GuardAccountDecision, GuardAccountMessage, GuardAccountSource } from "./personalGuardsAccountTypes";
import { validatePublicKey } from "./personalGuardsCrypto";
import { isUserId, parseGuardMessage } from "./personalGuardsProtocol";
import { writeGuardSetting } from "./personalGuardsSettings";
import type { GuardInvite, GuardsStore } from "./personalGuardsTypes";

export const GUARD_ACCEPT = "✅";
export const GUARD_REFUSE = "❌";

export function accountInvite(message: GuardAccountMessage, ownerId: string, channelId: string): GuardAccountSource | null {
    if (!isUserId(message.id) || message.channel_id !== channelId || message.author?.id !== ownerId || message.author.bot ||
        (message.type !== undefined && message.type !== 0 && message.type !== 19)) return null;
    const wire = parseGuardMessage(message.content ?? "");
    if (wire?.type !== "invite") return null;
    const mine = (emoji: string) => message.reactions?.some(reaction => !reaction.emoji.id && reaction.emoji.name === emoji && reaction.me === true);
    const decision = mine(GUARD_REFUSE) ? "refuse" : mine(GUARD_ACCEPT) ? "accept" : "none";
    return { invite: { userId: ownerId, publicKey: wire.publicKey, actions: [...wire.actions], nonce: wire.nonce, messageId: message.id, channelId }, decision };
}

export function applyGuardAccountSource(store: GuardsStore, source: GuardAccountSource): void {
    const { invite, decision } = source;
    const owners = store.knownGuardGrants.filter(grant => grant.userId !== invite.userId);
    writeGuardSetting(store, "knownGuardGrants", decision === "accept" ? [...owners, {
        userId: invite.userId, actions: [...invite.actions], inviteNonce: invite.nonce,
        inviteMessageId: invite.messageId, inviteChannelId: invite.channelId
    }] : owners);
    if (decision === "accept") writeGuardSetting(store, "guardPeerKeys", [
        ...store.guardPeerKeys.filter(item => item.userId !== invite.userId), { userId: invite.userId, publicKey: invite.publicKey }
    ]);
    writeGuardSetting(store, "pendingGuardInvites", [
        ...store.pendingGuardInvites.filter(item => item.userId !== invite.userId), ...(decision === "none" ? [invite] : [])
    ]);
    writeGuardSetting(store, "declinedGuardInvites", decision === "refuse"
        ? [...store.declinedGuardInvites.filter(item => item !== invite.nonce), invite.nonce].slice(-50)
        : store.declinedGuardInvites.filter(item => item !== invite.nonce));
}

export async function findGuardAccountSource(bridge: GuardAccountBridge, ownerId: string, channelId: string, pages = Number.POSITIVE_INFINITY): Promise<GuardAccountSource | null> {
    const account = bridge.currentAccount();
    if (!account || !isUserId(ownerId) || ownerId === account || !bridge.isDM(channelId, ownerId)) return null;
    let before: string | undefined;
    for (let page = 0; page < pages; page++) {
        const messages = await bridge.fetchPage(channelId, before);
        if (bridge.currentAccount() !== account) return null;
        const ordered = messages.filter(message => isUserId(message.id)).sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1);
        for (const message of ordered) {
            const source = accountInvite(message, ownerId, channelId);
            if (source && await validatePublicKey(source.invite.publicKey)) return bridge.currentAccount() === account ? source : null;
        }
        const last = ordered.at(-1)?.id;
        if (messages.length < 100 || !last || last === before) break;
        before = last;
    }
    return null;
}

export async function saveGuardAccountDecision(bridge: GuardAccountBridge, store: GuardsStore, invite: GuardInvite, decision: Exclude<GuardAccountDecision, "none">): Promise<void> {
    const account = bridge.currentAccount();
    if (!account || account === invite.userId || !invite.channelId || !invite.messageId || !bridge.isDM(invite.channelId, invite.userId))
        throw new Error("Open the invitation in your DM to accept or refuse it.");
    const source = await findGuardAccountSource(bridge, invite.userId, invite.channelId);
    if (!source || source.invite.messageId !== invite.messageId || source.invite.nonce !== invite.nonce || bridge.currentAccount() !== account)
        throw new Error("This invitation is no longer current. Open the newest invitation in your DM.");
    // Only the logged-in guardian's own reactions are changed. Another user's reaction never proves consent.
    await bridge.reaction(invite.channelId, invite.messageId, decision === "accept" ? GUARD_REFUSE : GUARD_ACCEPT, false);
    if (bridge.currentAccount() !== account) throw new Error("Discord accounts changed. Try again in the correct account.");
    await bridge.reaction(invite.channelId, invite.messageId, decision === "accept" ? GUARD_ACCEPT : GUARD_REFUSE, true);
    if (bridge.currentAccount() !== account) throw new Error("Discord accounts changed. Reload access for the current account.");
    applyGuardAccountSource(store, { invite: source.invite, decision });
}
