/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { ChannelStore, GuildStore, RelationshipStore, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import { settings } from ".";
import { isQuiet } from "./notifications";
import { describeChannel, displayName } from "./voiceContent";

export type LogKind = "join" | "leave" | "move" | "friend-request" | "friend-added" | "friend-removed" | "server-removed";

/** friends and servers, not voice */
export const ACCOUNT_KINDS: LogKind[] = ["friend-request", "friend-added", "friend-removed", "server-removed"];

/** what a room looked like when the entry was written, in case it's deleted or we lose access later */
export interface LogRoom {
    id: string;
    guildId: string | null;
    roomName: string;
    place: string;
    icon: string | null;
}

export interface LogEntry {
    key: number;
    time: number;
    kind: LogKind;
    userId: string;
    userName: string;
    isMe: boolean;
    isFriend: boolean;
    from: LogRoom | null;
    to: LogRoom | null;
    /** the person came into or left the room you were sitting in */
    myRoom: boolean;
}

export const MAX_ENTRIES = 5000;
// one log per account; the log from before that goes to the first account that opens in this Discord
const LEGACY_KEY = "FriendsInVoice_voiceLog";
const storeKey = (accountId: string) => `${LEGACY_KEY}_${accountId}`;

let entries: LogEntry[] = [];
let logKey: string | null = null;
let nextKey = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const lastChannel = new Map<string, string | null>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(fn => fn());

export function getLog() {
    return entries;
}

export function clearLog() {
    entries = [];
    emit();
    save();
}

// kept in IndexedDB (Vencord's DataStore) so the log survives restarts; written a moment after the last change
function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushVoiceLog, 2000);
}

/** the logged-in account changed: keep the old account's log and show the new one's */
export function switchVoiceLog(accountId: string) {
    flushVoiceLog();
    if (logKey) entries = [];
    logKey = storeKey(accountId);
    emit();
    void loadVoiceLog(logKey);
}

async function loadVoiceLog(key: string) {
    let saved = await DataStore.get<LogEntry[]>(key).catch(() => null);
    const legacy = saved === undefined;
    if (legacy) saved = await DataStore.get<LogEntry[]>(LEGACY_KEY).catch(() => null);
    if (key !== logKey) return;
    if (Array.isArray(saved) && saved.length) {
        // anything logged while it loaded comes first
        entries = [...entries, ...saved].slice(0, MAX_ENTRIES);
        nextKey = Math.max(nextKey, ...entries.map(e => e.key + 1));
        emit();
        save();
    }
    if (!legacy) return;
    await DataStore.set(key, entries).catch(() => { });
    void DataStore.del(LEGACY_KEY).catch(() => { });
}

export function flushVoiceLog() {
    if (saveTimer === undefined) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (logKey) void DataStore.set(logKey, entries).catch(() => { });
}

export function subscribeLog(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}

// Discord's relationship types: https://docs.discord.com/developers/resources/user#relationship-object-relationship-type
const FRIEND = 1, INCOMING = 3;
const lastRelationship = new Map<string, number>();
const guildCache = new Map<string, LogRoom>();

function guildSnapshot(id: string): LogRoom | null {
    const guild = GuildStore.getGuild(id);
    if (!guild) return guildCache.get(id) ?? null;
    const room = { id, guildId: id, roomName: "", place: guild.name, icon: guild.icon ? `https://cdn.discordapp.com/icons/${id}/${guild.icon}.png?size=64` : null };
    guildCache.set(id, room);
    return room;
}

export function seedVoiceLog() {
    lastRelationship.clear();
    for (const [id, type] of RelationshipStore.getMutableRelationships?.() ?? []) lastRelationship.set(id, type as number);
    for (const id of Object.keys(GuildStore.getGuilds() ?? {})) guildSnapshot(id);
    lastChannel.clear();
    for (const states of Object.values(VoiceStateStore.getAllVoiceStates() ?? {})) {
        for (const s of Object.values(states ?? {}) as any[]) {
            if (s?.channelId) lastChannel.set(s.userId, s.channelId);
        }
    }
}

function addEntry(entry: Omit<LogEntry, "key" | "time">) {
    entries = [{ key: nextKey++, time: Date.now(), ...entry }, ...entries].slice(0, MAX_ENTRIES);
    emit();
    save();
}

function personEntry(userId: string, kind: LogKind, user?: any) {
    user ??= UserStore.getUser(userId);
    if (settings.store.hidden.includes(userId)) return;
    addEntry({
        kind, userId, userName: user ? displayName(user, null) : "Unknown user", isMe: false,
        isFriend: RelationshipStore.isFriend(userId), from: null, to: null, myRoom: false,
    });
}

export function onRelationshipAdd(relationship: { id: string; type: number; user?: any; }) {
    const before = lastRelationship.get(relationship.id);
    lastRelationship.set(relationship.id, relationship.type);
    if (isQuiet() || before === relationship.type) return;
    if (relationship.type === INCOMING) personEntry(relationship.id, "friend-request", relationship.user);
    else if (relationship.type === FRIEND) personEntry(relationship.id, "friend-added", relationship.user);
}

// Discord doesn't say who ended a friendship, and being blocked looks the same as being unfriended
export function onRelationshipRemove(relationship: { id: string; type?: number; }) {
    const before = lastRelationship.get(relationship.id) ?? relationship.type;
    lastRelationship.delete(relationship.id);
    if (!isQuiet() && before === FRIEND) personEntry(relationship.id, "friend-removed");
}

export function onGuildUpdate(guildId: string) {
    guildSnapshot(guildId);
}

// GUILD_DELETE also fires during a Discord outage (unavailable: true); that isn't losing the server
export function onGuildDelete(guild: { id: string; unavailable?: boolean; }) {
    if (guild.unavailable || isQuiet()) return;
    const server = guildSnapshot(guild.id);
    const me = UserStore.getCurrentUser();
    if (!server || !me) return;
    addEntry({ kind: "server-removed", userId: me.id, userName: displayName(me, null), isMe: true, isFriend: false, from: server, to: null, myRoom: false });
}

function snapshot(channelId: string | null): LogRoom | null {
    if (!channelId) return null;
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return null;
    return { id: channel.id, guildId: channel.guild_id ?? null, ...describeChannel(channel) };
}

export function onVoiceLogUpdates(voiceStates: { userId: string; guildId?: string; channelId?: string | null; oldChannelId?: string | null; }[]) {
    const myId = UserStore.getCurrentUser()?.id;
    // my room before this batch, so people leaving it still count as "my room"
    const myRoomBefore = myId ? lastChannel.get(myId) ?? null : null;
    let added = false;

    for (const s of voiceStates) {
        const now = s.channelId ?? null;
        // our own map is right for the current user too, where Discord sends oldChannelId === channelId on a move
        const prev = lastChannel.has(s.userId) ? lastChannel.get(s.userId)! : s.oldChannelId ?? null;
        lastChannel.set(s.userId, now);

        if (prev === now || isQuiet()) continue;
        const isMe = s.userId === myId;
        if (!isMe && settings.store.hidden.includes(s.userId)) continue;
        const isFriend = RelationshipStore.isFriend(s.userId);
        const myRooms = [SelectedChannelStore.getVoiceChannelId(), myRoomBefore].filter(Boolean);
        const myRoom = !isMe && myRooms.some(id => id === prev || id === now);
        // only people you care about: friends, My list, people in your room, and you
        if (!isMe && !isFriend && !myRoom && !settings.store.watchlist.includes(s.userId)) continue;

        const from = snapshot(prev);
        const to = snapshot(now);
        if (!from && !to) continue;

        const user = UserStore.getUser(s.userId);
        entries.unshift({
            key: nextKey++,
            time: Date.now(),
            kind: prev && now ? "move" : now ? "join" : "leave",
            userId: s.userId,
            userName: user ? displayName(user, (to ?? from)?.guildId ?? null) : "Unknown user",
            isMe,
            isFriend,
            from,
            to,
            myRoom,
        });
        added = true;
    }

    if (!added) return;
    entries = entries.slice(0, MAX_ENTRIES);
    emit();
    save();
}
