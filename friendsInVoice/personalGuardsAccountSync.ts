/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, RestAPI, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import { isAccountDataLoaded, loadAccount } from "./accountData";
import { accountInvite, applyGuardAccountSource, findGuardAccountSource, GUARD_HISTORY_PAGES, GUARD_PASSIVE_PAGES, GUARD_STARTUP_DMS, saveGuardAccountDecision } from "./personalGuardsAccount";
import type { GuardAccountBridge, GuardAccountMessage } from "./personalGuardsAccountTypes";
import { removeGuardAccess } from "./personalGuardsSettings";
import type { GuardInvite } from "./personalGuardsTypes";
import { settings } from "./pluginSettings";

const pending = new Map<string, Promise<boolean>>();
const checked = new Map<string, number>();
let running = false;
let epoch = 0;

const bridge: GuardAccountBridge = {
    currentAccount: () => {
        const id = UserStore.getCurrentUser()?.id;
        return running && id && isAccountDataLoaded(id) ? id : undefined;
    },
    isDM: (channelId, ownerId) => {
        const channel = ChannelStore.getChannel(channelId);
        return !!channel?.isDM() && channel.recipients?.length === 1 && channel.recipients[0] === ownerId;
    },
    fetchPage: async (channelId, before) => {
        const response = await RestAPI.get({ url: `/channels/${channelId}/messages`, query: { limit: 100, ...(before ? { before } : {}) } });
        if (!Array.isArray(response.body)) throw new Error("Discord did not return the invitation history.");
        return response.body;
    },
    reaction: async (channelId, messageId, emoji, add) => {
        const request = { url: `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me` };
        if (add) await RestAPI.put(request);
        else await RestAPI.del(request);
    }
};

function applyCurrentSource(source: NonNullable<Awaited<ReturnType<typeof findGuardAccountSource>>>) {
    const current = settings.store.knownGuardGrants.find(grant => grant.userId === source.invite.userId);
    const waiting = settings.store.pendingGuardInvites.find(invite => invite.userId === source.invite.userId);
    const newer = [current?.inviteMessageId, waiting?.messageId].some(id => id && BigInt(id) > BigInt(source.invite.messageId!));
    if (!newer) applyGuardAccountSource(settings.store, source);
}

export function syncGuardOwner(ownerId: string, force = false, pages = GUARD_HISTORY_PAGES): Promise<boolean> {
    const account = bridge.currentAccount();
    const channelId = ChannelStore.getDMFromUserId(ownerId);
    if (!account || !channelId || ownerId === account || !bridge.isDM(channelId, ownerId)) return Promise.resolve(false);
    const key = `${account}:${channelId}`;
    if (pending.has(key)) {
        const active = pending.get(key)!;
        return pages > 1 ? active.then(found => found || syncGuardOwner(ownerId, true, pages)) : active;
    }
    if (!force && Date.now() - (checked.get(key) ?? 0) < 30_000)
        return Promise.resolve(settings.store.knownGuardGrants.some(grant => grant.userId === ownerId));
    const request = (async () => {
        try {
            const source = await findGuardAccountSource(bridge, ownerId, channelId, pages);
            if (!source || bridge.currentAccount() !== account) return false;
            applyCurrentSource(source);
            checked.set(key, Date.now());
            return source.decision === "accept";
        } catch { return false; }
        finally { pending.delete(key); }
    })();
    pending.set(key, request);
    return request;
}

export async function decideGuardAccountInvite(invite: GuardInvite, accept: boolean) {
    await loadAccount();
    await saveGuardAccountDecision(bridge, settings.store, invite, accept ? "accept" : "refuse");
}

export async function refuseGuardAccountOwner(ownerId: string) {
    await loadAccount();
    const account = bridge.currentAccount();
    const channelId = ChannelStore.getDMFromUserId(ownerId);
    if (!account || !channelId) throw new Error("Open the invitation DM first.");
    const source = await findGuardAccountSource(bridge, ownerId, channelId);
    if (bridge.currentAccount() !== account) throw new Error("Discord accounts changed.");
    if (source) await saveGuardAccountDecision(bridge, settings.store, source.invite, "refuse");
    else removeGuardAccess(settings.store, ownerId);
}

export async function hydrateGuardAccountMessage(message: GuardAccountMessage) {
    const account = bridge.currentAccount();
    if (!account || message.author?.id === account || !bridge.isDM(message.channel_id, message.author.id)) return;
    const source = accountInvite(message, message.author.id, message.channel_id);
    if (!source) return;
    // The message is a read-only hint. Verify its newest server state before restoring access.
    await syncGuardOwner(source.invite.userId, false, GUARD_PASSIVE_PAGES);
}

export function onGuardAccountReaction(channelId: string, userId: string) {
    if (userId !== bridge.currentAccount()) return;
    const channel = ChannelStore.getChannel(channelId);
    if (channel?.isDM() && channel.recipients?.[0]) void syncGuardOwner(channel.recipients[0], true, GUARD_PASSIVE_PAGES);
}

export function onGuardAccountChannel(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (channel?.isDM() && channel.recipients?.[0]) void syncGuardOwner(channel.recipients[0], false, GUARD_PASSIVE_PAGES);
}

export function syncVoiceGuardAccess() {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId) return;
    for (const userId of Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {}).slice(0, 20))
        void syncGuardOwner(userId, false, GUARD_PASSIVE_PAGES);
}

export async function startGuardAccountSync() {
    running = true;
    const generation = ++epoch;
    await loadAccount();
    const account = bridge.currentAccount();
    if (!account || generation !== epoch) return;
    // No background polling: after this one startup pass, lookups only follow what you do (open a DM,
    // receive a guard message, react, join voice, use a guard action).
    syncVoiceGuardAccess();
    const channels = ChannelStore.getSortedPrivateChannels().filter(channel => channel.isDM()).slice(0, GUARD_STARTUP_DMS);
    for (const channel of channels) {
        if (generation !== epoch || bridge.currentAccount() !== account) break;
        if (channel.recipients[0]) await syncGuardOwner(channel.recipients[0], false, GUARD_PASSIVE_PAGES);
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    onGuardAccountChannel(SelectedChannelStore.getChannelId());
}

export function stopGuardAccountSync() {
    running = false;
    epoch++;
    pending.clear();
    checked.clear();
}
