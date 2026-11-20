/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import type { User } from "@vencord/discord-types";
import { UserStore, UserUtils } from "@webpack/common";

/** What we keep about someone so their name and avatar show without asking Discord again. */
export interface SavedName {
    id: string;
    username: string;
    globalName?: string | null;
    avatar?: string | null;
    savedAt: number;
}

const KEY = "FriendsInVoice_names";
const MAX = 5000;
const names = new Map<string, SavedName>();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export async function loadNames() {
    const saved = await DataStore.get<SavedName[]>(KEY).catch(() => undefined);
    for (const item of Array.isArray(saved) ? saved : []) if (item?.id && item.username && !names.has(item.id)) names.set(item.id, item);
    loaded = true;
    listeners.forEach(listener => listener());
}

export function subscribeNames(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export const namesLoaded = () => loaded;
export const allNames = (): SavedName[] => [...names.values()];

function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void DataStore.set(KEY, [...names.values()].slice(-MAX)).catch(() => { }), 1000);
}

/** Merges names from elsewhere (another device); newer entries win. */
export function mergeNames(items: SavedName[]) {
    let changed = false;
    for (const item of items) {
        if (!item?.id || !item.username) continue;
        const current = names.get(item.id);
        if (current && current.savedAt >= item.savedAt) continue;
        names.set(item.id, item);
        changed = true;
    }
    if (changed) { save(); listeners.forEach(listener => listener()); }
}

/** Remembers someone Discord already loaded. No request. */
export function rememberUser(user: User | undefined | null) {
    if (!user) return;
    const current = names.get(user.id);
    const globalName = (user as any).globalName ?? null;
    if (current && current.username === user.username && current.globalName === globalName && current.avatar === user.avatar) return;
    names.set(user.id, { id: user.id, username: user.username, globalName, avatar: user.avatar ?? null, savedAt: Date.now() });
    save();
}

export const savedName = (id: string) => names.get(id);

/** A stand-in for a user Discord hasn't loaded, made from the saved name. */
export function savedUser(id: string): User | undefined {
    const item = names.get(id);
    if (!item) return undefined;
    return {
        id,
        username: item.username,
        globalName: item.globalName,
        avatar: item.avatar,
        getAvatarURL: (_?: unknown, size = 64) => item.avatar
            ? `https://cdn.discordapp.com/avatars/${id}/${item.avatar}.png?size=${size}`
            : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`,
    } as unknown as User;
}

/** Right-click → Refresh name: the only time a saved name is asked from Discord again. One request. */
export async function refreshName(id: string): Promise<boolean> {
    try {
        const user = await UserUtils.getUser(id) ?? UserStore.getUser(id);
        if (!user) return false;
        names.delete(id);
        rememberUser(user);
        listeners.forEach(listener => listener());
        return true;
    } catch { return false; }
}

export function flushNames() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    void DataStore.set(KEY, [...names.values()].slice(-MAX)).catch(() => { });
}
