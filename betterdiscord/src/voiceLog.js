const MAX_ENTRIES = 500;

// Keeps the last voice joins, leaves and moves in memory, the same way the Vencord Log tab does
export class VoiceLog {
    constructor(bridge, data) {
        this.bridge = bridge;
        this.data = data;
        this.entries = [];
        this.lastChannel = new Map();
        this.nextKey = 0;
        this.quietUntil = Date.now() + 15000;
        this.onChange = null;
    }
    seed() {
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
    stop() { clearTimeout(this.reseedTimer); }
    clear() { this.entries = []; this.onChange?.(); }
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
            const from = this.room(prev), to = this.room(now);
            if (!from && !to) continue;
            const myRooms = [this.bridge.myVoiceChannel(), myRoomBefore].filter(Boolean);
            this.entries.unshift({
                key: this.nextKey++, time: Date.now(), kind: prev && now ? "move" : now ? "join" : "leave",
                userId: state.userId, userName: this.bridge.name(state.userId, (to ?? from).guildId), isMe,
                isFriend: !!this.bridge.relationshipStore.isFriend?.(state.userId), from, to,
                myRoom: !isMe && myRooms.some(id => id === prev || id === now)
            });
            added = true;
        }
        if (!added) return;
        this.entries = this.entries.slice(0, MAX_ENTRIES);
        this.onChange?.();
    }
}
