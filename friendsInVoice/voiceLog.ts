/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, RelationshipStore, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import { settings } from ".";
import { isQuiet } from "./notifications";
import { describeChannel, displayName } from "./voiceContent";

export type LogKind = "join" | "leave" | "move";

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

const MAX_ENTRIES = 500;

let entries: LogEntry[] = [];
let nextKey = 0;
const lastChannel = new Map<string, string | null>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(fn => fn());

export function getLog() {
    return entries;
}

export function clearLog() {
    entries = [];
    emit();
}

export function subscribeLog(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}

export function seedVoiceLog() {
    lastChannel.clear();
    for (const states of Object.values(VoiceStateStore.getAllVoiceStates() ?? {})) {
        for (const s of Object.values(states ?? {}) as any[]) {
            if (s?.channelId) lastChannel.set(s.userId, s.channelId);
        }
    }
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

        const from = snapshot(prev);
        const to = snapshot(now);
        if (!from && !to) continue;

        const myRooms = [SelectedChannelStore.getVoiceChannelId(), myRoomBefore].filter(Boolean);
        const user = UserStore.getUser(s.userId);
        entries.unshift({
            key: nextKey++,
            time: Date.now(),
            kind: prev && now ? "move" : now ? "join" : "leave",
            userId: s.userId,
            userName: user ? displayName(user, (to ?? from)?.guildId ?? null) : "Unknown user",
            isMe,
            isFriend: RelationshipStore.isFriend(s.userId),
            from,
            to,
            myRoom: !isMe && myRooms.some(id => id === prev || id === now),
        });
        added = true;
    }

    if (!added) return;
    if (entries.length > MAX_ENTRIES) entries = entries.slice(0, MAX_ENTRIES);
    else entries = [...entries];
    emit();
}
