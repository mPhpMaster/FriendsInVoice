/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import { ChannelActionCreators, ChannelStore, DraftStore, DraftType, GuildMemberStore, GuildStore, MediaEngineStore, SelectedChannelStore, SelectedGuildStore, showToast, UserStore, VoiceStateStore } from "@webpack/common";

import { setPageOpen } from ".";
import { isAccountDataLoaded } from "./accountData";
import { codeMessage, type CodeOffer, GuardServerError, normalizeCode, type ServerEvent } from "./guardServer";
import { guardCommandRejection, reserveGuardCommand } from "./personalGuardsCommandChecks";
import { getGuardKeys, openGuardPayload, sealGuardPayload, validatePublicKey } from "./personalGuardsCrypto";
import { createGuardDraftPreparer } from "./personalGuardsDraft";
import { GUARD_ACTIONS, GUARD_LABELS, GUARD_VERBS, makeCommand, newGuardNonce } from "./personalGuardsProtocol";
import { guardClient, refreshGuardPairs, setGuardCommandHandler, updateGuardListening } from "./personalGuardsServer";
import { writeGuardSetting } from "./personalGuardsSettings";
import type { GuardAction, GuardEvent, GuardsStore } from "./personalGuardsTypes";

export type { GuardEvent, GuardsStore } from "./personalGuardsTypes";

const voiceActions = findByPropsLazy("toggleSelfMute", "toggleSelfDeaf") as {
    toggleSelfMute?(): void;
    toggleSelfDeaf?(): void;
};
const voiceChannelActions = findByPropsLazy("selectVoiceChannel", "selectChannel") as {
    selectVoiceChannel(id: string | null): void;
};
const seen = new Set<string>();
const eventListeners = new Set<(event: GuardEvent) => void>();

export function subscribeGuardEvents(listener: (event: GuardEvent) => void): () => void {
    eventListeners.add(listener);
    return () => { eventListeners.delete(listener); };
}

export function clearGuardRuntime() {
    seen.clear();
    eventListeners.clear();
}

export function guardDisplayName(userId: string): string {
    const ownChannel = myVoiceChannel();
    const voiceGuild = ownChannel && ChannelStore.getChannel(ownChannel)?.guild_id;
    const guildId = voiceGuild ?? SelectedGuildStore.getGuildId();
    const user = UserStore.getUser(userId);
    const currentNick = guildId && GuildMemberStore.getNick(guildId, userId);
    if (currentNick) return currentNick;
    for (const sharedGuildId of Object.keys(GuildStore.getGuilds())) {
        const nick = GuildMemberStore.getNick(sharedGuildId, userId);
        if (nick) return nick;
    }
    return (user as typeof user & { globalName?: string; } | undefined)?.globalName ?? user?.username ?? userId;
}

function sendError(message: string) {
    showNotification({ title: "Personal Guards", body: message });
}

function failure(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export function getGrant(store: GuardsStore, userId: string): GuardAction[] {
    return store.personalGuards.find(grant => grant.userId === userId)?.actions ?? [];
}

/** Changes what a guardian may do. An accepted pairing is updated on the server too. */
export function setGrant(store: GuardsStore, userId: string, actions: GuardAction[]) {
    const current = store.personalGuards.find(grant => grant.userId === userId);
    const next = GUARD_ACTIONS.filter(action => actions.includes(action));
    writeGuardSetting(store, "personalGuards", [
        ...store.personalGuards.filter(grant => grant.userId !== userId),
        { ...current, userId, actions: next },
    ]);
    if (current?.pairId && next.length)
        void guardClient.updatePair(current.pairId, next).catch(error => sendError(failure(error, "Allowed actions could not be saved on the server.")));
}

export function revokeGuard(store: GuardsStore, userId: string) {
    const current = store.personalGuards.find(grant => grant.userId === userId);
    writeGuardSetting(store, "personalGuards", store.personalGuards.filter(grant => grant.userId !== userId));
    if (current?.pairId) void guardClient.deletePair(current.pairId).catch(() => { }).finally(() => void refreshGuardPairs(true));
    if (current?.code) void guardClient.cancelCode(current.code).catch(() => { });
    updateGuardListening();
}

/** Makes a one-time code (10 minutes) for this guardian. Nothing is sent to Discord. */
export async function createGuardCode(store: GuardsStore, guardianId: string): Promise<{ code: string; expiresAt: number; } | null> {
    const actions = getGrant(store, guardianId);
    if (!actions.length) { sendError("Choose at least one action before inviting this guardian."); return null; }
    try {
        const result = await guardClient.createCode(guardianId, actions, newGuardNonce());
        const current = store.personalGuards.find(grant => grant.userId === guardianId);
        writeGuardSetting(store, "personalGuards", [
            ...store.personalGuards.filter(grant => grant.userId !== guardianId),
            { ...current, userId: guardianId, actions, code: result.code, codeExpiresAt: result.expiresAt },
        ]);
        updateGuardListening();
        return result;
    } catch (error) {
        sendError(`Invite code could not be made: ${failure(error, "unexpected error")}`);
        return null;
    }
}

const prepareDraft = createGuardDraftPreparer({
    open: async userId => { await ChannelActionCreators.openPrivateChannel({ recipientIds: [userId] }); },
    currentDm: userId => {
        const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
        return channel?.isDM() && channel.recipients?.includes(userId) ? channel.id : null;
    },
    getDraft: channelId => DraftStore.getDraft(channelId, DraftType.ChannelMessage) ?? "",
    insert: insertTextIntoChatInputBox,
    reveal: () => setPageOpen(false),
    wait: () => new Promise(resolve => setTimeout(resolve, 100))
});

/** Puts the code in the guardian's DM box. You press Enter yourself; it's an ordinary message. */
export async function draftGuardCode(guardianId: string, code: string) {
    const result = await prepareDraft(guardianId, codeMessage(code));
    if (result === "ready") { showToast({ text: "Code ready in their DM: press Enter to send it.", variant: "success" }); return; }
    sendError(result === "occupied" ? "That DM already has an unsent draft. Send or clear it, then try again." : "Could not open their DM. Copy the code instead.");
}

export async function lookupGuardCode(raw: string): Promise<CodeOffer & { code: string; } | null> {
    const code = normalizeCode(raw);
    if (!code) { sendError("A guard code has 8 letters and numbers, like ABCD-2345."); return null; }
    try { return { code, ...await guardClient.showCode(code) }; }
    catch (error) { sendError(failure(error, "This code can't be used.")); return null; }
}

export async function decideGuardCode(code: string, accept: boolean): Promise<boolean> {
    try {
        if (accept) {
            const pair = await guardClient.acceptCode(code);
            if (!await validatePublicKey(pair.peerKey)) throw new Error("The owner's secure key is invalid.");
        } else await guardClient.refuseCode(code);
        await refreshGuardPairs(true);
        if (accept) showToast({ text: "You're their Personal Guard now. In the same voice channel, right-click them to use it.", variant: "success" });
        return true;
    } catch (error) {
        sendError(failure(error, accept ? "The invitation could not be accepted." : "The invitation could not be refused."));
        return false;
    }
}

export async function removeGuardAccountAccess(store: GuardsStore, ownerId: string) {
    const grant = store.knownGuardGrants.find(item => item.userId === ownerId);
    writeGuardSetting(store, "knownGuardGrants", store.knownGuardGrants.filter(item => item.userId !== ownerId));
    if (!grant?.pairId) return;
    try { await guardClient.deletePair(grant.pairId); }
    catch (error) { sendError(failure(error, "Access could not be removed on the server.")); }
    await refreshGuardPairs(true);
}

function peerKey(store: GuardsStore, userId: string): string | undefined {
    return store.guardPeerKeys.find(peer => peer.userId === userId)?.publicKey;
}

export function hasGuardKey(store: GuardsStore, userId: string): boolean {
    return !!peerKey(store, userId);
}

/** One click, one request to the Friends in Voice server. Discord sees nothing until the owner's own client applies it. */
export async function sendGuardCommand(store: GuardsStore, ownerId: string, action: GuardAction) {
    const guardianId = UserStore.getCurrentUser()?.id;
    const grant = store.knownGuardGrants.find(item => item.userId === ownerId);
    if (!guardianId || !grant?.pairId || !grant.actions.includes(action)) { sendError("No saved access for this action. Ask the owner for a new invite code."); return; }
    const key = peerKey(store, ownerId);
    if (!key) { sendError("The owner's secure key is missing. Ask them for a new invite code."); return; }
    if (!sharesVoice(ownerId)) { sendError("Join the same voice channel first."); return; }
    try {
        const wire = await sealGuardPayload(makeCommand(ownerId, action, grant.inviteNonce), await getGuardKeys(), key, guardianId, ownerId);
        const { delivered } = await guardClient.sendCommand(grant.pairId, wire);
        showToast(delivered
            ? { text: `Sent: ${GUARD_VERBS[action].toLowerCase()} ${guardDisplayName(ownerId)}.`, variant: "success" }
            : { text: `${guardDisplayName(ownerId)}'s Friends in Voice isn't connected right now (they need v1.19 or newer).`, variant: "critical" });
    } catch (error) {
        if (error instanceof GuardServerError && error.status === 404) void refreshGuardPairs(true);
        sendError(`Command not sent: ${failure(error, "unexpected error")}`);
    }
}

// The voice channel this Discord client is connected to. getVoiceStateForUser can return a voice session
// from another device, and a user can have several sessions at once.
function myVoiceChannel(): string | null {
    return SelectedChannelStore.getVoiceChannelId() ?? null;
}

export function sharesVoice(userId: string): boolean {
    const channel = myVoiceChannel();
    return !!channel && !!VoiceStateStore.getVoiceStatesForChannel(channel)?.[userId];
}

async function applyAction(action: GuardAction): Promise<(() => void) | null> {
    if (action === "disconnect") {
        const oldChannel = myVoiceChannel();
        if (!oldChannel) return null;
        voiceChannelActions.selectVoiceChannel(null);
        await new Promise(resolve => setTimeout(resolve, 250));
        if (myVoiceChannel() === oldChannel) return null;
        return () => voiceChannelActions.selectVoiceChannel(oldChannel);
    }
    if (action === "mute") {
        const previous = MediaEngineStore.isSelfMute();
        if (!voiceActions.toggleSelfMute) return null;
        if (!previous) voiceActions.toggleSelfMute();
        await new Promise(resolve => setTimeout(resolve, 250));
        if (!MediaEngineStore.isSelfMute()) return null;
        return () => { if (!previous && MediaEngineStore.isSelfMute()) voiceActions.toggleSelfMute?.(); };
    }
    const previous = MediaEngineStore.isSelfDeaf();
    if (!voiceActions.toggleSelfDeaf) return null;
    if (!previous) voiceActions.toggleSelfDeaf();
    await new Promise(resolve => setTimeout(resolve, 250));
    if (!MediaEngineStore.isSelfDeaf()) return null;
    return () => { if (!previous && MediaEngineStore.isSelfDeaf()) voiceActions.toggleSelfDeaf?.(); };
}

/** A command a guardian sent through the server. Same checks as before: paired guard, allowed action,
 * same voice channel, fresh and not seen before, sealed with the guardian's pinned key. */
export async function handleServerCommand(store: GuardsStore, event: ServerEvent) {
    const me = UserStore.getCurrentUser()?.id;
    const key = `${event.pairId}:${event.seq}:${event.at}`;
    if (!me || !event.wire || !event.from || seen.has(key) || !isAccountDataLoaded(me)) return;
    seen.add(key);
    if (seen.size > 1000) seen.clear();
    const senderId = event.from;
    const grant = store.personalGuards.find(item => item.pairId === event.pairId);
    if (!grant || grant.userId !== senderId || event.wire.to !== me) return;
    const pinned = peerKey(store, senderId);
    if (!pinned || pinned !== event.wire.fromKey) { sendError(`Guard command from ${guardDisplayName(senderId)} rejected: secure key does not match.`); return; }
    let payload;
    try { payload = await openGuardPayload(event.wire, await getGuardKeys(), senderId, me); } catch { payload = null; }
    if (!payload || payload.kind !== "command") { sendError(`Could not verify a guard command from ${guardDisplayName(senderId)}.`); return; }
    const rejection = guardCommandRejection(store, payload, {
        ownerId: me, senderId, senderKey: event.wire.fromKey, pinnedKey: pinned, sharesVoice: sharesVoice(senderId), now: Date.now()
    });
    if (rejection) { sendError(`Guard command rejected: ${rejection}`); return; }
    try { reserveGuardCommand(store, payload, senderId, Date.now()); }
    catch { sendError("The command receipt could not be saved. No voice action was applied."); return; }
    let undo: (() => void) | null;
    try { undo = await applyAction(payload.action); } catch { sendError("Discord could not apply the requested voice action."); return; }
    if (!undo) { sendError("Discord voice controls are unavailable for this action."); return; }
    const guardEvent = { id: key, guardianId: senderId, action: payload.action, undo };
    for (const listener of eventListeners) listener(guardEvent);
    if (!eventListeners.size) showNotification({ title: `Personal Guard: ${guardDisplayName(senderId)}`, body: `${GUARD_LABELS[payload.action]} applied. Click to undo.`, permanent: true, onClick: undo });
}

export function installGuardCommandHandler(store: GuardsStore) {
    setGuardCommandHandler(event => handleServerCommand(store, event));
}
