/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import { ChannelActionCreators, ChannelStore, DraftStore, DraftType, GuildMemberStore, GuildStore, MediaEngineStore, SelectedChannelStore, SelectedGuildStore, UserStore, VoiceStateStore } from "@webpack/common";

import { openGuardsPage, setPageOpen } from ".";
import { getGuardKeys, openGuardPayload, publicKeyString, sealGuardPayload, validatePublicKey } from "./personalGuardsCrypto";
import { createGuardDraftPreparer } from "./personalGuardsDraft";
import { GUARD_ACTIONS, GUARD_LABELS, makeCommand, makeGrantNotice, newGuardNonce, parseGuardMessage, serializeWire } from "./personalGuardsProtocol";
import { saveGuardInvitation, writeGuardSetting } from "./personalGuardsSettings";
import type { GuardAction, GuardEvent, GuardsStore, IncomingMessage } from "./personalGuardsTypes";

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

export function getGrant(store: GuardsStore, userId: string): GuardAction[] {
    return store.personalGuards.find(grant => grant.userId === userId)?.actions ?? [];
}

export function setGrant(store: GuardsStore, userId: string, actions: GuardAction[]) {
    const inviteNonce = store.personalGuards.find(grant => grant.userId === userId)?.inviteNonce;
    writeGuardSetting(store, "personalGuards", [
        ...store.personalGuards.filter(grant => grant.userId !== userId).map(grant => ({ ...grant, actions: [...grant.actions] })),
        { userId, actions: GUARD_ACTIONS.filter(action => actions.includes(action)), ...(inviteNonce ? { inviteNonce } : {}) },
    ]);
}

export function revokeGuard(store: GuardsStore, userId: string) {
    writeGuardSetting(store, "personalGuards", store.personalGuards.filter(grant => grant.userId !== userId)
        .map(grant => ({ ...grant, actions: [...grant.actions] })));
}

export async function sendGuardInvite(store: GuardsStore, guardianId: string) {
    const actions = getGrant(store, guardianId);
    if (!actions.length) { sendError("Choose at least one action before inviting this guardian."); return; }
    let stage = "creating an invitation";
    try {
        const nonce = newGuardNonce();
        stage = "loading your secure key";
        const publicKey = await publicKeyString(await getGuardKeys());
        stage = "opening the guardian's DM";
        const text = serializeWire({ type: "invite", version: 3, publicKey, actions, nonce });
        if (!await openDraft(guardianId, text)) return;
        stage = "saving the invitation";
        saveGuardInvitation(store, guardianId, nonce);
        showNotification({ title: "Personal Guards", body: "Invitation ready. Press Discord's Send button. The guardian can then accept it without sending a reply." });
    } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 120) : "Unexpected error";
        sendError(`Invitation failed while ${stage}: ${detail}`);
    }
}

export function acceptGuardInvite(store: GuardsStore, ownerId: string) {
    const invite = store.pendingGuardInvites.find(item => item.userId === ownerId);
    if (!invite) return;
    writeGuardSetting(store, "guardPeerKeys", [...store.guardPeerKeys.filter(item => item.userId !== ownerId), { userId: ownerId, publicKey: invite.publicKey }]);
    writeGuardSetting(store, "knownGuardGrants", [...store.knownGuardGrants.filter(item => item.userId !== ownerId),
        { userId: ownerId, actions: [...invite.actions], inviteNonce: invite.nonce }]);
    writeGuardSetting(store, "pendingGuardInvites", store.pendingGuardInvites.filter(item => item.userId !== ownerId));
    showNotification({ title: "Personal Guards", body: "Invitation accepted. Join the owner's voice channel to use your allowed actions." });
}

function peerKey(store: GuardsStore, userId: string): string | undefined {
    return store.guardPeerKeys.find(peer => peer.userId === userId)?.publicKey;
}

export function hasGuardKey(store: GuardsStore, userId: string): boolean {
    return !!peerKey(store, userId);
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

async function openDraft(userId: string, text: string): Promise<boolean> {
    const result = await prepareDraft(userId, text);
    if (result === "ready") return true;
    const messages = {
        occupied: "This DM already has an unsent draft. Send or clear it first, then choose one guard action again. Nothing was added.",
        busy: "A guard message is already being prepared. Wait for it before choosing another action.",
        unavailable: "Could not confirm the guard message in the intended DM. Check its draft before trying again."
    };
    sendError(messages[result]);
    return false;
}

function sendError(message: string) {
    showNotification({ title: "Personal Guards", body: message });
}

export async function sendGuardKey(userId: string) {
    try {
        const publicKey = await publicKeyString(await getGuardKeys());
        if (await openDraft(userId, serializeWire({ type: "key", version: 2, publicKey })))
            showNotification({ title: "Personal Guards", body: "Secure key DM is ready. Press Discord's Send button. The owner can then choose what you may do." });
    } catch { sendError("Secure key storage is unavailable. No message was prepared."); }
}

export async function sendGuardGrant(store: GuardsStore, guardianId: string) {
    const ownerId = UserStore.getCurrentUser()?.id;
    const key = peerKey(store, guardianId);
    if (!ownerId || !key) { sendError("Ask this person to share their public key from the Personal Guards menu first."); return; }
    try {
        const wire = await sealGuardPayload(makeGrantNotice(ownerId, getGrant(store, guardianId)), await getGuardKeys(), key, ownerId, guardianId);
        if (await openDraft(guardianId, serializeWire(wire)))
            showNotification({ title: "Personal Guards", body: "Encrypted access DM is ready. Press Discord's Send button to finish setup." });
    } catch { sendError("Could not prepare the encrypted grant. Nothing was sent."); }
}

export async function sendGuardCommand(store: GuardsStore, ownerId: string, action: GuardAction) {
    const guardianId = UserStore.getCurrentUser()?.id;
    const grant = store.knownGuardGrants.find(item => item.userId === ownerId);
    if (!grant?.actions.includes(action)) { sendError("No saved access for this action. Ask the owner to invite you again."); return; }
    const key = peerKey(store, ownerId);
    if (!guardianId || !key) { sendError("No public key for this owner. Ask them to send an updated grant."); return; }
    try {
        const wire = await sealGuardPayload(makeCommand(ownerId, action, grant.inviteNonce), await getGuardKeys(), key, guardianId, ownerId);
        await openDraft(ownerId, serializeWire(wire));
    } catch { sendError("Could not prepare the encrypted command. Nothing was sent."); }
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

export async function handleGuardMessage(store: GuardsStore, message: IncomingMessage) {
    if (!message?.id || seen.has(message.id) || message.author?.bot) return;
    const wire = parseGuardMessage(message.content);
    if (!ChannelStore.getChannel(message.channel_id)?.isDM()) return;
    if (!wire) {
        if (message.author.id !== UserStore.getCurrentUser()?.id && message.content.startsWith("[FriendsInVoice Guard v2]"))
            sendError("Invalid guard message. Send one fresh invitation or command by itself, without other text or a previous draft.");
        return;
    }
    seen.add(message.id);
    if (seen.size > 1000) seen.clear();
    const me = UserStore.getCurrentUser()?.id;
    const senderId = message.author?.id;
    if (!me || !senderId || senderId === me) return;
    if (wire.type === "invite") {
        if (!await validatePublicKey(wire.publicKey)) return;
        writeGuardSetting(store, "pendingGuardInvites", [...store.pendingGuardInvites.filter(item => item.userId !== senderId),
            { userId: senderId, publicKey: wire.publicKey, actions: [...wire.actions], nonce: wire.nonce }]);
        showNotification({ title: "Personal Guards", body: `${guardDisplayName(senderId)} invited you to be their guardian. Click to accept or decline.`, onClick: openGuardsPage });
        return;
    }
    if (wire.type === "key") {
        if (!await validatePublicKey(wire.publicKey)) return;
        writeGuardSetting(store, "guardPeerKeys", [...store.guardPeerKeys.filter(peer => peer.userId !== senderId)
            .map(peer => ({ userId: peer.userId, publicKey: peer.publicKey })), { userId: senderId, publicKey: wire.publicKey }]);
        showNotification({
            title: "Personal Guards",
            body: `Secure key received from ${guardDisplayName(senderId)}. Click to choose allowed actions and prepare their access DM.`,
            onClick: openGuardsPage
        });
        return;
    }
    if (wire.to !== me) return;
    const pinned = peerKey(store, senderId);
    let payload;
    try { payload = await openGuardPayload(wire, await getGuardKeys(), senderId, me); } catch { return; }
    if (!payload) {
        if (getGrant(store, senderId).length) sendError(`Could not verify a guard message from ${guardDisplayName(senderId)}. Ask them to use your newest invitation.`);
        return;
    }
    if (payload.kind === "grant") {
        if (payload.ownerId !== senderId || Math.abs(Date.now() - payload.createdAt) > 7 * 24 * 60 * 60_000) return;
        writeGuardSetting(store, "guardPeerKeys", [...store.guardPeerKeys.filter(peer => peer.userId !== senderId)
            .map(peer => ({ userId: peer.userId, publicKey: peer.publicKey })), { userId: senderId, publicKey: wire.fromKey }]);
        writeGuardSetting(store, "knownGuardGrants", [
            ...store.knownGuardGrants.filter(grant => grant.userId !== senderId)
                .map(grant => ({ userId: grant.userId, actions: [...grant.actions] })),
            ...(payload.actions.length ? [{ userId: senderId, actions: [...payload.actions] }] : []),
        ]);
        showNotification({ title: "Personal Guards", body: `${guardDisplayName(senderId)} updated your guard access. Click to see your available actions.`, onClick: openGuardsPage });
        return;
    }
    if (payload.ownerId !== me) { sendError("Guard command rejected: wrong account."); return; }
    if (Math.abs(Date.now() - payload.createdAt) > 5 * 60_000) { sendError("Guard command expired. Check both devices' clocks and send a new one."); return; }
    const grant = store.personalGuards.find(item => item.userId === senderId);
    if (!grant?.actions.includes(payload.action)) { sendError("Guard command rejected: this action is not allowed for the sender."); return; }
    if (grant.inviteNonce ? payload.inviteNonce !== grant.inviteNonce : !pinned || pinned !== wire.fromKey) {
        sendError("Guard command rejected: invitation or secure key does not match. Send a new invitation."); return;
    }
    if (!sharesVoice(senderId)) { sendError("Guard command rejected: both people must be in the same voice channel."); return; }
    if (store.guardBlocks.some(block => block.userId === senderId && block.until > Date.now())) { sendError("Guard commands from this person are temporarily blocked."); return; }
    if (store.guardReplay.some(entry => entry.nonce === payload.nonce)) { sendError("Guard command rejected: duplicate message."); return; }
    let undo: (() => void) | null;
    try { undo = await applyAction(payload.action); } catch { sendError("Discord could not apply the requested voice action."); return; }
    if (!undo) { sendError("Discord voice controls are unavailable for this action."); return; }
    writeGuardSetting(store, "guardReplay", [...store.guardReplay.filter(entry => Date.now() - entry.createdAt < 5 * 60_000)
        .map(entry => ({ nonce: entry.nonce, createdAt: entry.createdAt })), { nonce: payload.nonce, createdAt: Date.now() }]);
    const event = { id: message.id, guardianId: senderId, action: payload.action, undo };
    for (const listener of eventListeners) listener(event);
    if (!eventListeners.size) showNotification({ title: `Personal Guard: ${guardDisplayName(senderId)}`, body: `${GUARD_LABELS[payload.action]} applied. Click to undo.`, permanent: true, onClick: undo });
}
