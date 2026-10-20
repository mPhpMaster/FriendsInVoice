// Discord permission bits: https://docs.discord.com/developers/topics/permissions#permissions-bitwise-permission-flags
const VIEW_CHANNEL = 1n << 10n;
const CONNECT = 1n << 20n;
const MOVE_MEMBERS = 1n << 24n;
const CHANNEL_OBFUSCATED = 1 << 17;
const STATUSES = ["online", "idle", "dnd", "invisible"];
// Discord exports these under minified names (the dispatcher is "h"), which BdApi only checks with searchExports
const IN_EXPORTS = { searchExports: true };

export class DiscordBridge {
    constructor(api) {
        this.api = api;
        const webpack = api.Webpack;
        this.userStore = webpack.getStore("UserStore");
        this.channelStore = webpack.getStore("ChannelStore");
        this.voiceStore = webpack.getStore("VoiceStateStore");
        this.relationshipStore = webpack.getStore("RelationshipStore");
        this.presenceStore = webpack.getStore("PresenceStore");
        this.guildStore = webpack.getStore("GuildStore");
        this.memberStore = webpack.getStore("GuildMemberStore");
        this.permissionStore = webpack.getStore("PermissionStore");
        this.selectedChannelStore = webpack.getStore("SelectedChannelStore");
        this.messageStore = webpack.getStore("MessageStore");
        this.mediaStore = webpack.getStore("MediaEngineStore");
        this.dispatcher = webpack.getByKeys("subscribe", "unsubscribe", "dispatch", IN_EXPORTS);
        this.channelActions = webpack.getByKeys("openPrivateChannel");
        this.componentDispatch = webpack.getByKeys("dispatchToLastSubscribed", IN_EXPORTS);
        this.voiceActions = webpack.getByKeys("toggleSelfMute", "toggleSelfDeaf");
        this.voiceChannelActions = webpack.getByKeys("selectVoiceChannel", "selectChannel");
        this.profileActions = webpack.getByKeys("openUserProfileModal");
        if (!this.userStore || !this.channelStore || !this.voiceStore || !this.relationshipStore || !this.permissionStore || !this.dispatcher)
            throw new Error("Discord stores or dispatcher are unavailable in this client build.");
    }
    currentId() { return this.userStore.getCurrentUser()?.id ?? null; }
    user(id) { return this.userStore.getUser(id); }
    openProfile(id) {
        if (!this.profileActions?.openUserProfileModal) throw new Error("Discord's profile opener is unavailable.");
        this.profileActions.openUserProfileModal({ userId: id });
    }
    name(id, guildId = null) {
        const user = this.user(id);
        return this.relationshipStore.getNickname?.(id) ?? (guildId && this.memberStore?.getNick?.(guildId, id)) ??
            user?.globalName ?? user?.username ?? id;
    }
    status(id) { return this.presenceStore?.getStatus?.(id) ?? "offline"; }
    voiceState(id) { return this.voiceStore.getVoiceStateForUser?.(id) ?? null; }
    voiceChannel(id) { return this.voiceState(id)?.channelId ?? null; }
    // "Locked" without Connect; "Full" at the user limit unless you have Move Members:
    // https://docs.discord.com/developers/topics/voice-connections
    joinBlocker(channel) {
        if (!channel.guild_id) return null;
        if (!this.permissionStore.can(VIEW_CHANNEL, channel) || !this.permissionStore.can(CONNECT, channel)) return "Locked";
        const limit = channel.userLimit ?? 0;
        if (!limit || this.permissionStore.can(MOVE_MEMBERS, channel)) return null;
        return Object.keys(this.voiceStore.getVoiceStatesForChannel?.(channel.id) ?? {}).length >= limit ? "Full" : null;
    }
    // the voice channel this client is in; voiceChannel(me) can return a session on another device
    myVoiceChannel() { return this.selectedChannelStore?.getVoiceChannelId?.() ?? null; }
    sharesVoice(id) {
        const mine = this.myVoiceChannel();
        return !!mine && !!this.voiceStore.getVoiceStatesForChannel?.(mine)?.[id];
    }
    isDm(channel) { return !!channel?.isDM?.(); }
    channel(id) { return this.channelStore.getChannel(id); }
    selectedChannel() { return this.selectedChannelStore?.getChannelId?.() ?? null; }
    async openDm(id) {
        if (!this.channelActions?.openPrivateChannel) throw new Error("Discord's DM opener is unavailable.");
        await this.channelActions.openPrivateChannel({ recipientIds: [id] });
        for (let attempt = 0; attempt < 25; attempt++) {
            const channel = this.channel(this.selectedChannel());
            if (this.isDm(channel) && channel.recipients?.includes(id)) return true;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error("The intended DM did not open. No text was inserted.");
    }
    async prepareDm(id, text) {
        await this.openDm(id);
        if (!this.componentDispatch?.dispatchToLastSubscribed)
            throw new Error("Discord's message composer is unavailable. Nothing was sent.");
        this.componentDispatch.dispatchToLastSubscribed("INSERT_TEXT", { rawText: text, plainText: text });
    }
    insertReply(text) {
        if (!this.componentDispatch?.dispatchToLastSubscribed) throw new Error("Discord's message composer is unavailable.");
        this.componentDispatch.dispatchToLastSubscribed("INSERT_TEXT", { rawText: text, plainText: text });
    }
    currentDm() {
        const id = this.selectedChannel();
        const channel = this.channel(id);
        return this.isDm(channel) ? channel : null;
    }
    lastIncomingDm() {
        const channel = this.currentDm();
        if (!channel) return null;
        const message = this.messageStore?.getLastMessage?.(channel.id);
        return message && message.author?.id !== this.currentId() && !message.author?.bot ? { channel, message } : null;
    }
    recentDmLines(channelId) {
        const messages = this.messageStore?.getMessages?.(channelId)?._array ?? [];
        return messages.filter(message => message.content?.trim()).slice(-8)
            .map(message => ({ mine: message.author?.id === this.currentId(), content: message.content.slice(0, 500) }));
    }
    roomDescription(channel) {
        const guild = channel.guild_id && this.guildStore?.getGuild?.(channel.guild_id);
        // Discord sends channels you can't view as "___hidden___" with the CHANNEL_OBFUSCATED flag (1 << 17)
        if (guild) return { place: guild.name, roomName: channel.name === "___hidden___" || (channel.flags & CHANNEL_OBFUSCATED) ? "Private channel" : channel.name ?? "Voice", guildId: guild.id };
        if (this.isDm(channel)) return { place: "Direct call", roomName: this.name(channel.recipients?.[0]), guildId: null };
        return { place: "Group call", roomName: channel.name ?? "Group DM", guildId: null };
    }
    rooms(watchlist = []) {
        const friendIds = new Set(this.relationshipStore.getFriendIDs?.() ?? []);
        const tracked = new Set([...friendIds, ...watchlist]);
        const me = this.currentId();
        // getAllVoiceStates() is keyed by guild id ("@me" for calls), then user id; group the states by their channel
        const byChannel = new Map();
        for (const states of Object.values(this.voiceStore.getAllVoiceStates?.() ?? {})) {
            for (const state of Object.values(states ?? {})) {
                if (!state?.channelId || !state.userId || !this.user(state.userId)) continue;
                byChannel.set(state.channelId, [...byChannel.get(state.channelId) ?? [], state]);
            }
        }
        const result = [];
        for (const [channelId, members] of byChannel) {
            if (!members.some(state => state.userId !== me && tracked.has(state.userId))) continue;
            const channel = this.channel(channelId);
            if (!channel) continue;
            const info = this.roomDescription(channel);
            result.push({ channelId, ...info, blocker: this.joinBlocker(channel), members: members.map(state => ({
                id: state.userId, name: this.name(state.userId, info.guildId),
                friend: friendIds.has(state.userId), watched: watchlist.includes(state.userId),
                mute: !!(state.mute || state.selfMute), deaf: !!(state.deaf || state.selfDeaf), stream: !!state.selfStream
            })) });
        }
        return result.sort((a, b) => a.place.localeCompare(b.place) || a.roomName.localeCompare(b.roomName));
    }
    applyGuardAction(action) {
        if (action === "disconnect") {
            const previous = this.myVoiceChannel();
            if (!previous || !this.voiceChannelActions?.selectVoiceChannel) return null;
            this.voiceChannelActions.selectVoiceChannel(null);
            return () => this.voiceChannelActions.selectVoiceChannel(previous);
        }
        if (action === "mute" || action === "deafen") {
            const method = action === "mute" ? "toggleSelfMute" : "toggleSelfDeaf";
            const check = action === "mute" ? "isSelfMute" : "isSelfDeaf";
            if (!this.voiceActions?.[method] || !this.mediaStore?.[check]) return null;
            const wasActive = this.mediaStore[check]();
            if (!wasActive) this.voiceActions[method]();
            return () => { if (!wasActive && this.mediaStore[check]()) this.voiceActions[method](); };
        }
        return null;
    }
    async setInvisible() {
        // Discord's status user setting is the one exported setting whose value is a status
        this.statusSetting ??= this.api.Webpack.getModule?.(item => {
            try { return typeof item?.updateSetting === "function" && STATUSES.includes(item.getSetting?.()); } catch { return false; }
        }, IN_EXPORTS);
        if (this.statusSetting?.updateSetting) return this.statusSetting.updateSetting("invisible");
        throw new Error("Discord's status control is unavailable in this build.");
    }
}
