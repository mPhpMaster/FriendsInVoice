/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { SettingsStore } from "@api/Settings";
import { UserStore } from "@webpack/common";

import { settings } from ".";
import { clearGuardRuntime } from "./personalGuardsRuntime";
import { flushVoiceLog, switchVoiceLog } from "./voiceLog";

// Vencord keeps one settings file for every Discord on the computer, so two Discords logged into different accounts
// would share My list, Hidden, alerts and Personal Guards. These are saved per account in Discord's own storage instead,
// and the settings file only holds whichever account is open right now.
const ACCOUNT_KEYS = [
    "watchlist", "notifyOnline", "blacklist", "notifyVoice", "hidden",
    "personalGuards", "knownGuardGrants", "pendingGuardInvites", "declinedGuardInvites", "guardBlocks", "guardReplay", "guardPeerKeys",
] as const;
type AccountKey = typeof ACCOUNT_KEYS[number];
type AccountData = { [K in AccountKey]: typeof settings.store[K] };

const SETTINGS_PATH = "plugins.FriendsInVoice";
const storeKey = (id: string) => `FriendsInVoice_account_${id}`;

let accountId: string | null = null;
let loading: string | null = null;
let loadTask: Promise<void> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function isAccountDataLoaded(id: string): boolean {
    return accountId === id && loading === null && UserStore.getCurrentUser()?.id === id;
}

// settings reads are proxies; IndexedDB and IPC need plain data
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? []));

function snapshot() {
    const data = {} as Record<AccountKey, unknown>;
    for (const key of ACCOUNT_KEYS) data[key] = plain(settings.store[key]);
    return data as AccountData;
}

function apply(data: Partial<AccountData>) {
    for (const key of ACCOUNT_KEYS) (settings.store as any)[key] = Array.isArray(data[key]) ? plain(data[key]) : [];
}

function writeNow() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (accountId) void DataStore.set(storeKey(accountId), snapshot()).catch(() => { });
}

function onSettingChange(_: unknown, path: string) {
    const key = path.split(".")[2] as AccountKey;
    if (!accountId || !ACCOUNT_KEYS.includes(key)) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 500);
}

/** loads the logged-in account's lists; call on start and whenever Discord connects (it may be another account) */
export function loadAccount(): Promise<void> {
    const id = UserStore.getCurrentUser()?.id;
    if (!id || id === accountId) return Promise.resolve();
    if (id === loading) return loadTask ?? Promise.resolve();
    loading = id;
    loadTask = loadAccountData(id);
    return loadTask;
}

async function loadAccountData(id: string) {
    if (accountId) writeNow();
    accountId = null;

    // the very first account to load after this update keeps what was saved before; others start empty.
    // Without that, what's in the settings file was written by whichever account was open last.
    const inherits = !settings.store.accountDataOwner;
    if (!inherits) apply({});
    clearGuardRuntime();
    switchVoiceLog(id);

    const saved = await DataStore.get<AccountData>(storeKey(id)).catch(() => undefined);
    if (loading !== id) return;
    loading = null;
    if (saved) apply(saved);
    else if (inherits) settings.store.accountDataOwner = id;
    else apply({});
    accountId = id;
    if (!saved) writeNow();
}

export function startAccountData() {
    SettingsStore.addPrefixChangeListener(SETTINGS_PATH, onSettingChange);
    void loadAccount();
}

export function stopAccountData() {
    SettingsStore.removePrefixChangeListener(SETTINGS_PATH, onSettingChange);
    if (saveTimer !== undefined) writeNow();
    accountId = loading = null;
}

/** LOGOUT: save the account that's leaving; the next one loads on CONNECTION_OPEN */
export function leaveAccount() {
    if (saveTimer !== undefined) writeNow();
    flushVoiceLog();
    accountId = loading = null;
}
