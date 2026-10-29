/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import { ChannelActionCreators, ChannelStore, DraftStore, DraftType, GuildMemberStore, GuildStore, MediaEngineStore, SelectedChannelStore, SelectedGuildStore, showToast, UserStore, VoiceStateStore } from "@webpack/common";

import { openGuardsPage, openPrivateChannel, setPageOpen } from ".";
import { isAccountDataLoaded } from "./accountData";
import { decideGuardAccountInvite, refuseGuardAccountOwner, syncGuardOwner } from "./personalGuardsAccountSync";
import { guardCommandRejection, reserveGuardCommand } from "./personalGuardsCommandChecks";
import { getGuardKeys, openGuardPayload, publicKeyString, sealGuardPayload, validatePublicKey } from "./personalGuardsCrypto";
import { createGuardDraftPreparer } from "./personalGuardsDraft";
import { GUARD_ACTIONS, GUARD_LABELS, GUARD_VERBS, inviteSummary, isGuardMessage, makeCommand, makeGrantNotice, newGuardNonce, parseGuardMessage, serializeWire } from "./personalGuardsProtocol";
import { saveGuardInvitation, writeGuardSetting } from "./personalGuardsSettings";
import type { GuardAction, GuardEvent, GuardInvite, GuardsStore, IncomingMessage } from "./personalGuardsTypes";

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
        const text = serializeWire({ type: "invite", version: 3, publicKey, actions, nonce }, inviteSummary(actions));
        if (!await openDraft(guardianId, text)) return;
        stage = "saving the invitation";
        saveGuardInvitation(store, guardianId, nonce);
        showToast({ text: "Invite ready: press Enter to send it. They accept it from that message.", variant: "success" });
    } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 120) : "Unexpected error";
        sendError(`Invitation failed while ${stage}: ${detail}`);
    }
}

/** Accept an invite, either a pending one or one read from the invite message itself (so it works after being offline) */
export async function acceptGuardInvite(store: GuardsStore, ownerId: string, invite = store.pendingGuardInvites.find(item => item.userId === ownerId), announce = true) {
    if (!invite || invite.userId !== ownerId || !await validatePublicKey(invite.publicKey)) {
        sendError("This invite can't be used. Ask them to prepare a new one.");
        return;
    }
    try { await decideGuardAccountInvite(invite, true); }
    catch { sendError("Acceptance could not be saved to your account. Open the newest invitation in your DM and try Accept again."); return; }
    if (announce) showToast({ text: `You're ${guardDisplayName(ownerId)}'s Personal Guard. In the same voice channel, right-click them to use it.`, variant: "success" });
}

export async function declineGuardInvite(store: GuardsStore, ownerId: string, nonce: string, invite = store.pendingGuardInvites.find(item => item.userId === ownerId && item.nonce === nonce)) {
    if (!invite) { sendError("Open the invitation in your DM to refuse it."); return; }
    try { await decideGuardAccountInvite(invite, false); }
    catch { sendError("Refusal could not be saved to your account. Try Refuse again when connected."); }
}

export async function removeGuardAccountAccess(ownerId: string) {
    try { await refuseGuardAccountOwner(ownerId); }
    catch { sendError("Access could not be removed from your account. Reconnect and try Remove access again."); }
}

export function inviteFromMessage(message: IncomingMessage): GuardInvite | null {
    const wire = parseGuardMessage(message.content ?? "");
    return wire?.type === "invite" ? { userId: message.author.id, actions: [...wire.actions], publicKey: wire.publicKey, nonce: wire.nonce,
        messageId: message.id, channelId: message.channel_id } : null;
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
    if (!await syncGuardOwner(ownerId, true) || UserStore.getCurrentUser()?.id !== guardianId) {
        sendError("Accept the newest invitation in your DM before using Personal Guard actions. Your account must be connected."); return;
    }
    const grant = store.knownGuardGrants.find(item => item.userId === ownerId);
    if (!grant?.actions.includes(action)) { sendError("No saved access for this action. Ask the owner to invite you again."); return; }
    const key = peerKey(store, ownerId);
    if (!guardianId || !key) { sendError("No public key for this owner. Ask them to send an updated grant."); return; }
    try {
        const wire = await sealGuardPayload(makeCommand(ownerId, action, grant.inviteNonce), await getGuardKeys(), key, guardianId, ownerId);
        // @silent: Discord sends it without a notification sound or push
        if (await openDraft(ownerId, `@silent ${serializeWire(wire, "Personal Guard action")}`))
            showToast({ text: `Press Enter to ${GUARD_VERBS[action].toLowerCase()} ${guardDisplayName(ownerId)}.`, variant: "success" });
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
        if (message.author.id !== UserStore.getCurrentUser()?.id && isGuardMessage(message.content))
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
        const current = store.knownGuardGrants.find(grant => grant.userId === senderId);
        if (current?.inviteNonce === wire.nonce) return;
        // A changed invitation needs the guardian's own decision again; receiving it never implies acceptance.
        if (current) writeGuardSetting(store, "knownGuardGrants", store.knownGuardGrants.filter(grant => grant.userId !== senderId));
        writeGuardSetting(store, "pendingGuardInvites", [...store.pendingGuardInvites.filter(item => item.userId !== senderId),
            { userId: senderId, publicKey: wire.publicKey, actions: [...wire.actions], nonce: wire.nonce, messageId: message.id, channelId: message.channel_id }]);
        showNotification({
            title: "Personal Guards",
            body: `${guardDisplayName(senderId)} invited you to be their Personal Guard. Click to accept or decline it in your DM.`,
            onClick: () => { setPageOpen(false); openPrivateChannel(senderId); }
        });
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
    if (!isAccountDataLoaded(me)) return;
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
    const rejection = guardCommandRejection(store, payload, {
        ownerId: me, senderId, senderKey: wire.fromKey, pinnedKey: pinned, sharesVoice: sharesVoice(senderId), now: Date.now()
    });
    if (rejection) { sendError(`Guard command rejected: ${rejection}`); return; }
    try { reserveGuardCommand(store, payload, senderId, Date.now()); }
    catch { sendError("The command receipt could not be saved. No voice action was applied."); return; }
    let undo: (() => void) | null;
    try { undo = await applyAction(payload.action); } catch { sendError("Discord could not apply the requested voice action."); return; }
    if (!undo) { sendError("Discord voice controls are unavailable for this action."); return; }
    const event = { id: message.id, guardianId: senderId, action: payload.action, undo };
    for (const listener of eventListeners) listener(event);
    if (!eventListeners.size) showNotification({ title: `Personal Guard: ${guardDisplayName(senderId)}`, body: `${GUARD_LABELS[payload.action]} applied. Click to undo.`, permanent: true, onClick: undo });
}
