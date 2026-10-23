import { accountStore } from "./accountStore.js";

export const MAX_ENTRIES = 5000;
/** friends and servers, not voice */
export const ACCOUNT_KINDS = ["friend-request", "friend-added", "friend-removed", "server-removed"];
// Discord's relationship types: https://docs.discord.com/developers/resources/user#relationship-object-relationship-type
const FRIEND = 1, INCOMING = 3;
/** where the log was kept before it was split per account; the first account to load takes it */
const LEGACY_KEY = "voiceLog";
const valid = saved => Array.isArray(saved) ? saved.filter(entry => entry?.userId && (entry.from || entry.to)) : [];

// Keeps the last voice joins, leaves and moves of each account, saved so they survive restarts
export class VoiceLog {
    constructor(bridge, data, api, logs = accountStore("voiceLogs")) {
        this.bridge = bridge;
        this.data = data;
        this.api = api;
        this.logs = logs;
        this.accountId = null;
        this.entries = [];
        this.lastChannel = new Map();
        this.nextKey = 0;
        this.quietUntil = Date.now() + 15000;
        this.onChange = null;
        this.lastRelationship = new Map();
        this.guildCache = new Map();
    }
    guild(id) {
        const guild = this.bridge.guildStore?.getGuild?.(id);
        if (!guild) return this.guildCache.get(id) ?? null;
        const room = { id, guildId: id, roomName: "", place: guild.name };
        this.guildCache.set(id, room);
        return room;
    }
    seed() {
        this.lastRelationship.clear();
        for (const [id, type] of this.bridge.relationshipStore.getMutableRelationships?.() ?? []) this.lastRelationship.set(id, type);
        for (const id of Object.keys(this.bridge.guildStore?.getGuilds?.() ?? {})) this.guild(id);
        this.lastChannel.clear();
        for (const states of Object.values(this.bridge.voiceStore.getAllVoiceStates?.() ?? {}))
            for (const state of Object.values(states ?? {})) if (state?.channelId) this.lastChannel.set(state.userId, state.channelId);
    }
    // after (re)connecting Discord sends voice states in bulk; don't log those, and re-read where everyone is once settled
    reconnect() {
        this.quietUntil = Date.now() + 15000;
        clearTimeout(this.reseedTimer);
        this.reseedTimer = setTimeout(() => this.seed(), 15000);
    }
    stop() {
        clearTimeout(this.reseedTimer);
        if (this.saveTimer) this.flush();
    }
    // written a few seconds after the last change, not on every event
    save() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), 5000);
    }
    flush() {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        // keep logging even if saving fails
        if (this.accountId) void this.logs.put(this.accountId, this.entries).catch(() => { });
    }
    /** show the log of the account that's logged in, keeping the previous account's */
    async useAccount(id) {
        if (!id || id === this.accountId) return;
        if (this.saveTimer) this.flush();
        if (this.accountId) this.entries = [];
        this.accountId = id;
        this.onChange?.();
        let saved = await this.logs.get(id).catch(() => undefined);
        const legacy = saved === undefined && this.api?.Data?.load?.(LEGACY_KEY);
        if (legacy) saved = legacy;
        if (this.accountId !== id) return;
        // anything logged while it loaded comes first
        this.entries = [...this.entries, ...valid(saved)].slice(0, MAX_ENTRIES);
        this.nextKey = Math.max(this.nextKey, ...this.entries.map(entry => (entry.key ?? 0) + 1));
        this.onChange?.();
        if (!legacy && !this.entries.length) return;
        this.flush();
        if (legacy) try { this.api.Data.delete?.(LEGACY_KEY); } catch { /* it's copied already */ }
    }
    clear() { this.entries = []; this.onChange?.(); this.flush(); }
    add(entry) {
        this.entries = [{ key: this.nextKey++, time: Date.now(), from: null, to: null, myRoom: false, ...entry }, ...this.entries].slice(0, MAX_ENTRIES);
        this.onChange?.();
        this.save();
    }
    person(userId, kind) {
        if (this.data.value.hidden.includes(userId)) return;
        this.add({ kind, userId, userName: this.bridge.name(userId), isMe: false, isFriend: !!this.bridge.relationshipStore.isFriend?.(userId) });
    }
    onRelationshipAdd(relationship) {
        if (!relationship?.id) return;
        const before = this.lastRelationship.get(relationship.id);
        this.lastRelationship.set(relationship.id, relationship.type);
        if (Date.now() < this.quietUntil || before === relationship.type) return;
        if (relationship.type === INCOMING) this.person(relationship.id, "friend-request");
        else if (relationship.type === FRIEND) this.person(relationship.id, "friend-added");
    }
    // Discord doesn't say who ended a friendship, and being blocked looks the same as being unfriended
    onRelationshipRemove(relationship) {
        if (!relationship?.id) return;
        const before = this.lastRelationship.get(relationship.id) ?? relationship.type;
        this.lastRelationship.delete(relationship.id);
        if (Date.now() >= this.quietUntil && before === FRIEND) this.person(relationship.id, "friend-removed");
    }
    // GUILD_DELETE also fires during a Discord outage (unavailable: true); that isn't losing the server
    onGuildDelete(guild) {
        if (!guild?.id || guild.unavailable || Date.now() < this.quietUntil) return;
        const server = this.guild(guild.id), me = this.bridge.currentId();
        if (server && me) this.add({ kind: "server-removed", userId: me, userName: this.bridge.name(me), isMe: true, isFriend: false, from: server });
    }
    room(channelId) {
        const channel = channelId && this.bridge.channel(channelId);
        return channel ? { id: channel.id, ...this.bridge.roomDescription(channel) } : null;
    }
    onUpdates(voiceStates = []) {
        const me = this.bridge.currentId();
        const myRoomBefore = me ? this.lastChannel.get(me) ?? null : null;
        let added = false;
        for (const state of voiceStates) {
            if (!state?.userId) continue;
            const now = state.channelId ?? null;
            // our own map is right for the current user too, where Discord sends oldChannelId === channelId on a move
            const prev = this.lastChannel.has(state.userId) ? this.lastChannel.get(state.userId) : state.oldChannelId ?? null;
            this.lastChannel.set(state.userId, now);
            if (prev === now || Date.now() < this.quietUntil) continue;
            const isMe = state.userId === me;
            if (!isMe && this.data.value.hidden.includes(state.userId)) continue;
            const isFriend = !!this.bridge.relationshipStore.isFriend?.(state.userId);
            const myRooms = [this.bridge.myVoiceChannel(), myRoomBefore].filter(Boolean);
            const myRoom = !isMe && myRooms.some(id => id === prev || id === now);
            // only people you care about: friends, My list, people in your room, and you
            if (!isMe && !isFriend && !myRoom && !this.data.value.watchlist.includes(state.userId)) continue;
            const from = this.room(prev), to = this.room(now);
            if (!from && !to) continue;
            this.entries.unshift({
                key: this.nextKey++, time: Date.now(), kind: prev && now ? "move" : now ? "join" : "leave",
                userId: state.userId, userName: this.bridge.name(state.userId, (to ?? from).guildId), isMe,
                isFriend, from, to, myRoom
            });
            added = true;
        }
        if (!added) return;
        this.entries = this.entries.slice(0, MAX_ENTRIES);
        this.onChange?.();
        this.save();
    }
}
