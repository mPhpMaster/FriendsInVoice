import { applyGuardAccountSource, findGuardAccountSource, saveGuardAccountDecision } from "../../friendsInVoice/personalGuardsAccount.ts";

export class GuardAccountAccess {
    constructor(bridge, data, changed) {
        this.discord = bridge;
        this.data = data;
        this.changed = changed;
        this.active = true;
        this.pending = new Map();
        this.bridge = {
            currentAccount: () => this.active && !data.loading && data.accountId === bridge.currentId() ? bridge.currentId() : undefined,
            isDM: (channelId, ownerId) => {
                const channel = bridge.channel(channelId);
                return bridge.isDm(channel) && channel.recipients?.length === 1 && channel.recipients[0] === ownerId;
            },
            fetchPage: (channel, before) => bridge.guardHistory(channel, before),
            reaction: (channel, message, emoji, add) => bridge.guardReaction(channel, message, emoji, add)
        };
    }
    stop() { this.active = false; this.pending.clear(); }
    async sync(ownerId, pages = Infinity) {
        const account = this.bridge.currentAccount();
        const channelId = this.discord.channelStore?.getDMFromUserId?.(ownerId);
        if (!account || !channelId) return false;
        const key = `${account}:${channelId}`;
        if (this.pending.has(key)) return this.pending.get(key);
        const work = (async () => {
            try {
                const source = await findGuardAccountSource(this.bridge, ownerId, channelId, pages);
                if (!source || this.bridge.currentAccount() !== account) return false;
                const current = [this.data.value.knownGuardGrants.find(item => item.userId === ownerId)?.inviteMessageId,
                    this.data.value.pendingGuardInvites.find(item => item.userId === ownerId)?.messageId];
                if (current.some(id => id && BigInt(id) > BigInt(source.invite.messageId))) return false;
                applyGuardAccountSource(this.data.value, source);
                this.data.save();
                this.changed();
                return source.decision === "accept";
            } catch { return false; }
            finally { this.pending.delete(key); }
        })();
        this.pending.set(key, work);
        return work;
    }
    async decide(invite, accept) {
        await saveGuardAccountDecision(this.bridge, this.data.value, invite, accept ? "accept" : "refuse");
        this.data.save();
        this.changed();
    }
    async remove(ownerId) {
        const channelId = this.discord.channelStore?.getDMFromUserId?.(ownerId);
        if (!channelId) throw new Error("Open the invitation DM first.");
        const source = await findGuardAccountSource(this.bridge, ownerId, channelId);
        if (!source) throw new Error("The original invitation was not found. Open its DM and try again.");
        await this.decide(source.invite, false);
    }
    async refresh() {
        const account = this.bridge.currentAccount();
        const channels = this.discord.channelStore?.getSortedPrivateChannels?.() ?? [];
        for (const channel of channels.filter(item => this.discord.isDm(item)).slice(0, 20)) {
            if (!account || account !== this.bridge.currentAccount()) return;
            if (channel.recipients?.[0]) await this.sync(channel.recipients[0], 1);
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        this.onChannel(this.discord.selectedChannel());
    }
    onChannel(channelId) {
        const channel = this.discord.channel(channelId);
        if (this.discord.isDm(channel) && channel.recipients?.[0]) void this.sync(channel.recipients[0]);
    }
    onReaction(event) {
        if (event.userId === this.bridge.currentAccount()) this.onChannel(event.channelId);
    }
}
