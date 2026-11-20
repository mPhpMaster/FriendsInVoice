/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { SettingsStore } from "@api/Settings";
import type { PluginNative } from "@utils/types";
import { showToast, UserStore } from "@webpack/common";

import { isAccountDataLoaded, loadAccount } from "./accountData";
import { allNames, mergeNames, subscribeNames } from "./nameCache";
import { settings } from "./pluginSettings";
import { deriveSyncKeys, SYNC_LISTS, type SyncData, SyncError, type SyncKeys, type SyncListKey, syncOnce } from "./syncCore";
import { getLog, type LogEntry, replaceLogFromSync, subscribeLog, whenLogLoaded } from "./voiceLog";

// Sync talks only to the Friends in Voice server, never Discord, and everything it sends is encrypted here first.
const Native = VencordNative.pluginHelpers.FriendsInVoice as PluginNative<typeof import("./native")>;
const SETTINGS_PATH = "plugins.FriendsInVoice";
const PUSH_DELAY = 60_000;
const PULL_EVERY = 15 * 60_000;
const metaKey = (id: string) => `FriendsInVoice_syncMeta_${id}`;

let keys: { account: string; passphrase: string; keys: SyncKeys; } | undefined;
let changedAt: Partial<Record<SyncListKey, number>> = {};
let metaAccount: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pullTimer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;
let applying = false;
let lastError = "";
const unsubscribers: (() => void)[] = [];

const enabled = () => settings.store.syncPassphrase.trim().length >= 8;

async function keysFor(account: string) {
    const passphrase = settings.store.syncPassphrase.trim();
    if (keys?.account !== account || keys.passphrase !== passphrase)
        keys = { account, passphrase, keys: await deriveSyncKeys(passphrase, account) };
    return keys.keys;
}

async function loadMeta(account: string) {
    if (metaAccount === account) return;
    changedAt = await DataStore.get(metaKey(account)).catch(() => undefined) ?? {};
    metaAccount = account;
}

function localData(): SyncData {
    const lists: SyncData["lists"] = {};
    for (const key of SYNC_LISTS) lists[key] = { ids: [...settings.store[key]], changedAt: changedAt[key] ?? 0 };
    const log = getLog().map(({ key: _, ...entry }) => entry);
    return { lists, log, names: allNames() };
}

function applyData(account: string, data: SyncData) {
    applying = true;
    try {
        for (const key of SYNC_LISTS) {
            const remote = data.lists[key];
            if (!remote || remote.changedAt <= (changedAt[key] ?? 0)) continue;
            settings.store[key] = [...remote.ids];
            changedAt[key] = remote.changedAt;
        }
        replaceLogFromSync(data.log as unknown as LogEntry[]);
        mergeNames(data.names);
    } finally { applying = false; }
    void DataStore.set(metaKey(account), { ...changedAt }).catch(() => { });
}

/** One round: read the server copy, merge, write back if needed. Quiet unless it fails. */
export function syncNow(manual = false): Promise<void> {
    running ??= (async () => {
        const account = UserStore.getCurrentUser()?.id;
        if (!enabled() || !account) { if (manual) showToast({ text: "Set a sync passphrase (8+ characters) first.", variant: "critical" }); return; }
        await loadAccount();
        await whenLogLoaded();
        if (!isAccountDataLoaded(account)) return;
        await loadMeta(account);
        try {
            const merged = await syncOnce({
                transport: request => Native.guardRequest(request.method, request.url, request.token,
                    request.body === undefined ? undefined : JSON.parse(JSON.stringify(request.body)), request.timeoutMs),
                server: settings.store.guardServer,
                keys: await keysFor(account),
                local: localData(),
            });
            if (UserStore.getCurrentUser()?.id === account) applyData(account, merged);
            lastError = "";
            if (manual) showToast({ text: "Synced.", variant: "success" });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // a failure is shown once, not on every retry
            if (manual || (message !== lastError && !(error instanceof SyncError && error.status === 0))) showToast({ text: `Sync: ${message}`, variant: "critical" });
            lastError = message;
        }
    })().finally(() => { running = undefined; });
    return running;
}

function schedulePush() {
    if (applying || !enabled()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void syncNow(), PUSH_DELAY);
}

function onSettingChange(_: unknown, path: string) {
    const key = path.split(".")[2];
    if (key === "syncPassphrase") { keys = undefined; return; }
    if (!(SYNC_LISTS as readonly string[]).includes(key) || applying) return;
    const account = UserStore.getCurrentUser()?.id;
    if (!account || !isAccountDataLoaded(account)) return;
    changedAt[key as SyncListKey] = Date.now();
    void DataStore.set(metaKey(account), { ...changedAt }).catch(() => { });
    schedulePush();
}

export function startSync() {
    stopSync();
    SettingsStore.addPrefixChangeListener(SETTINGS_PATH, onSettingChange);
    unsubscribers.push(subscribeLog(schedulePush), subscribeNames(schedulePush));
    pullTimer = setInterval(() => void syncNow(), PULL_EVERY);
    setTimeout(() => void syncNow(), 5000);
}

/** a different account opened: its own copy */
export function onSyncAccountChange() {
    metaAccount = null;
    setTimeout(() => void syncNow(), 5000);
}

export function stopSync() {
    SettingsStore.removePrefixChangeListener(SETTINGS_PATH, onSettingChange);
    unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
    clearTimeout(pushTimer);
    clearInterval(pullTimer);
}
