import { AlertService } from "./alerts.js";
import { AutoStatus } from "./autoStatus.js";
import { DataStore } from "./data.js";
import { DiscordBridge } from "./discord.js";
import { GuardService } from "./guards.js";
import { installUserMenu } from "./menu.js";
import { ReplyService } from "./replies.js";
import { settingsPanel } from "./settingsUi.js";
import { Dashboard } from "./view.js";
import { VoiceLog } from "./voiceLog.js";
import { WhatsNew } from "./whatsNew.js";

module.exports = class FriendsInVoice {
    constructor(meta) {
        this.version = meta?.version ?? "1.10.0";
        this.api = new globalThis.BdApi("FriendsInVoice");
        this.unsubscribers = [];
        this.started = false;
    }
    start() {
        if (this.started) return;
        try {
            this.data = new DataStore(this.api);
            this.bridge = new DiscordBridge(this.api);
            this.view = new Dashboard(this.api, this.bridge, this.data, this.version);
            this.guards = new GuardService(this.api, this.bridge, this.data, tab => this.view.open(tab));
            this.guards.changed = () => this.view.refresh();
            this.replies = new ReplyService(this.api, this.bridge, this.data);
            this.alerts = new AlertService(this.api, this.bridge, this.data, tab => this.view.open(tab), this.version);
            this.voiceLog = new VoiceLog(this.bridge, this.data, this.api);
            this.whatsNew = new WhatsNew(this.api, this.data, this.version);
            this.autoStatus = new AutoStatus(this.api, this.bridge, this.data);
            this.voiceLog.onChange = () => { if (this.view.tab === "log") this.view.refresh(); };
            Object.assign(this.view, { guards: this.guards, replies: this.replies, alerts: this.alerts, voiceLog: this.voiceLog, autoStatus: this.autoStatus });
            this.view.start();
            this.unsubscribers.push(installUserMenu(this.api, this.view));
            const onMessage = event => void this.guards.onMessage(event?.message).catch(error => this.api.Logger.error("Guard message failed", error));
            // each Discord account has its own lists and log; Discord connects again after switching accounts
            const loadAccount = async () => {
                const id = this.bridge.currentId();
                await this.data.useAccount(id);
                void this.voiceLog.useAccount(id);
                if (this.started) void this.guards.account.refresh();
            };
            this.data.onAccount = () => this.view.refresh();
            const showWhatsNew = () => { this.whatsNewTimer = setTimeout(() => void this.whatsNew.check(), 3000); };
            const onConnect = () => { this.alerts.reconnect(); this.voiceLog.reconnect(); loadAccount(); showWhatsNew(); this.autoStatus.apply(); };
            const onLogout = () => { this.data.leave(); this.voiceLog.flush(); };
            const onVoice = event => {
                this.voiceLog.onUpdates(event?.voiceStates); this.autoStatus.onUpdates(event?.voiceStates);
                for (const id of Object.keys(this.bridge.voiceStore.getVoiceStatesForChannel?.(this.bridge.myVoiceChannel()) ?? {}).slice(0, 20))
                    void this.guards.account.sync(id, 1);
            };
            const logEvents = {
                RELATIONSHIP_ADD: event => this.voiceLog.onRelationshipAdd(event?.relationship),
                RELATIONSHIP_REMOVE: event => this.voiceLog.onRelationshipRemove(event?.relationship),
                GUILD_CREATE: event => event?.guild?.id && this.voiceLog.guild(event.guild.id),
                GUILD_UPDATE: event => event?.guild?.id && this.voiceLog.guild(event.guild.id),
                GUILD_DELETE: event => this.voiceLog.onGuildDelete(event?.guild),
                CHANNEL_SELECT: event => this.guards.account.onChannel(event?.channelId),
                MESSAGE_REACTION_ADD: event => this.guards.account.onReaction(event),
                MESSAGE_REACTION_REMOVE: event => this.guards.account.onReaction(event)
            };
            this.bridge.dispatcher.subscribe("MESSAGE_CREATE", onMessage);
            this.bridge.dispatcher.subscribe("CONNECTION_OPEN", onConnect);
            this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe("MESSAGE_CREATE", onMessage));
            this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe("CONNECTION_OPEN", onConnect));
            this.bridge.dispatcher.subscribe("LOGOUT", onLogout);
            this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe("LOGOUT", onLogout));
            this.bridge.dispatcher.subscribe("VOICE_STATE_UPDATES", onVoice);
            this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe("VOICE_STATE_UPDATES", onVoice));
            for (const [name, handler] of Object.entries(logEvents)) {
                this.bridge.dispatcher.subscribe(name, handler);
                this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe(name, handler));
            }
            loadAccount();
            this.voiceLog.seed();
            this.alerts.seed();
            this.autoStatus.apply();
            this.pollTimer = setInterval(() => { this.alerts.poll(); this.view.refresh(); }, 5000);
            this.updateTimer = setInterval(() => void this.alerts.checkUpdate(), 6 * 60 * 60 * 1000);
            this.started = true;
            void this.alerts.checkUpdate();
            // after an update BetterDiscord starts the plugin before Discord connects; otherwise it's already connected
            if (this.bridge.currentId()) showWhatsNew();
        } catch (error) {
            this.api.UI.showToast(`FriendsInVoice could not start: ${String(error)}`, { type: "error" });
            this.stop();
            throw error;
        }
    }
    stop() {
        clearInterval(this.pollTimer);
        clearInterval(this.updateTimer);
        clearTimeout(this.whatsNewTimer);
        for (const unsubscribe of this.unsubscribers.splice(0).reverse()) {
            try { unsubscribe?.(); } catch (error) { this.api.Logger.error("Cleanup failed", error); }
        }
        this.guards?.stop();
        this.voiceLog?.stop();
        this.view?.stop();
        this.whatsNew?.close();
        this.started = false;
    }
    onSwitch() { this.view?.refresh(); }
    getSettingsPanel() {
        return this.view ? settingsPanel(this.view) : document.createTextNode("Enable FriendsInVoice to view settings.");
    }
};
