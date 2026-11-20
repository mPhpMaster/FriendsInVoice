/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import type { PluginNative } from "@utils/types";
import { SelectedChannelStore, UserStore } from "@webpack/common";

import { isAccountDataLoaded, loadAccount } from "./accountData";
import { applyServerPairs, type GuardCredential, GuardPoller, GuardServerClient, ownerNeedsEvents, type ServerEvent } from "./guardServer";
import { getGuardKeys, publicKeyString } from "./personalGuardsCrypto";
import { settings } from "./pluginSettings";

const Native = VencordNative.pluginHelpers.FriendsInVoice as PluginNative<typeof import("./native")>;
const credentialKey = (id: string) => `FriendsInVoice_guardServer_${id}`;

let running = false;
let commandHandler: ((event: ServerEvent) => Promise<void>) | undefined;
let refreshing: Promise<boolean> | undefined;
const changeListeners = new Set<() => void>();

function currentAccount(): string | undefined {
    const id = UserStore.getCurrentUser()?.id;
    return running && id && isAccountDataLoaded(id) ? id : undefined;
}

export const guardClient = new GuardServerClient({
    // settings values are proxies, which IPC can't clone ("An object could not be cloned"): send plain data
    transport: request => Native.guardRequest(request.method, request.url, request.token,
        request.body === undefined ? undefined : JSON.parse(JSON.stringify(request.body)), request.timeoutMs),
    credentials: {
        get: id => DataStore.get<GuardCredential>(credentialKey(id)),
        set: (id, credential) => credential ? DataStore.set(credentialKey(id), credential) : DataStore.del(credentialKey(id)),
    },
    server: () => settings.store.guardServer,
    account: currentAccount,
    publicKey: async () => publicKeyString(await getGuardKeys()),
    // only what Discord already has loaded for you; nothing is asked from Discord
    profile: () => {
        const me = UserStore.getCurrentUser();
        return me ? { name: (me as any).globalName ?? me.username, username: me.username } : undefined;
    },
});

/** sends your name and username to the server if they changed (only on a device that already uses the server) */
export function syncGuardProfile() {
    void guardClient.syncProfile().catch(() => { });
}

const poller = new GuardPoller({
    client: guardClient,
    shouldRun: () => !!currentAccount() && ownerNeedsEvents(settings.store, !!SelectedChannelStore.getVoiceChannelId()),
    onEvents: async events => {
        let pairsChanged = false;
        for (const event of events) {
            if (event.type === "command") await commandHandler?.(event);
            else pairsChanged = true;
            if (event.type === "refused" && event.guardianId)
                showNotification({ title: "Personal Guards", body: `${UserStore.getUser(event.guardianId)?.username ?? "Your guardian"} refused your invitation.` });
        }
        if (pairsChanged) await refreshGuardPairs();
    },
});

export function setGuardCommandHandler(handler: (event: ServerEvent) => Promise<void>) {
    commandHandler = handler;
}

export function onGuardPairsChange(listener: () => void): () => void {
    changeListeners.add(listener);
    return () => { changeListeners.delete(listener); };
}

function hasGuardData() {
    const { store } = settings;
    return store.personalGuards.length > 0 || store.knownGuardGrants.length > 0 || store.pendingGuardInvites.length > 0;
}

/** Reads this account's pairs from the server. Runs at start (only if you use Personal Guards), when the
 * Personal Guards tab opens, after your own changes, and when the server says something changed. */
export function refreshGuardPairs(manual = false): Promise<boolean> {
    if (!currentAccount() || (!manual && !hasGuardData())) { poller.update(); return Promise.resolve(false); }
    refreshing ??= (async () => {
        try {
            const account = currentAccount();
            const state = await guardClient.listPairs();
            if (!account || currentAccount() !== account || state.me !== account) return false;
            applyServerPairs(settings.store, state);
            changeListeners.forEach(listener => listener());
            return true;
        } catch (error) {
            if (manual) showNotification({ title: "Personal Guards", body: error instanceof Error ? error.message : String(error) });
            return false;
        } finally {
            refreshing = undefined;
            poller.update();
        }
    })();
    return refreshing;
}

/** Voice changes only decide whether the owner side listens for commands; nothing is sent to Discord. */
export function updateGuardListening() {
    poller.update();
}

export async function startGuardServer() {
    running = true;
    poller.reset();
    await loadAccount();
    await refreshGuardPairs();
    syncGuardProfile();
}

export function stopGuardServer() {
    running = false;
    poller.reset();
}
