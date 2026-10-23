import { AlertService } from "./alerts.js";
import { DataStore } from "./data.js";
import { DiscordBridge } from "./discord.js";
import { GuardService } from "./guards.js";
import { installUserMenu } from "./menu.js";
import { ReplyService } from "./replies.js";
import { settingsPanel } from "./settingsUi.js";
import { Dashboard } from "./view.js";
import { VoiceLog } from "./voiceLog.js";

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
            this.replies = new ReplyService(this.api, this.bridge, this.data);
            this.alerts = new AlertService(this.api, this.bridge, this.data, tab => this.view.open(tab), this.version);
            this.voiceLog = new VoiceLog(this.bridge, this.data, this.api);
            this.voiceLog.onChange = () => { if (this.view.tab === "log") this.view.refresh(); };
            Object.assign(this.view, { guards: this.guards, replies: this.replies, alerts: this.alerts, voiceLog: this.voiceLog });
            this.view.start();
            this.unsubscribers.push(installUserMenu(this.api, this.view));
            const onMessage = event => void this.guards.onMessage(event?.message).catch(error => this.api.Logger.error("Guard message failed", error));
            const onConnect = () => { this.alerts.reconnect(); this.voiceLog.reconnect(); };
            const onVoice = event => this.voiceLog.onUpdates(event?.voiceStates);
            const logEvents = {
                RELATIONSHIP_ADD: event => this.voiceLog.onRelationshipAdd(event?.relationship),
                RELATIONSHIP_REMOVE: event => this.voiceLog.onRelationshipRemove(event?.relationship),
                GUILD_CREATE: event => event?.guild?.id && this.voiceLog.guild(event.guild.id),
                GUILD_UPDATE: event => event?.guild?.id && this.voiceLog.guild(event.guild.id),
                GUILD_DELETE: event => this.voiceLog.onGuildDelete(event?.guild)
            };
            this.bridge.dispatcher.subscribe("MESSAGE_CREATE", onMessage);
            this.bridge.dispatcher.subscribe("CONNECTION_OPEN", onConnect);
            this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe("MESSAGE_CREATE", onMessage));
            this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe("CONNECTION_OPEN", onConnect));
            this.bridge.dispatcher.subscribe("VOICE_STATE_UPDATES", onVoice);
            this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe("VOICE_STATE_UPDATES", onVoice));
            for (const [name, handler] of Object.entries(logEvents)) {
                this.bridge.dispatcher.subscribe(name, handler);
                this.unsubscribers.push(() => this.bridge.dispatcher.unsubscribe(name, handler));
            }
            this.voiceLog.seed();
            this.alerts.seed();
            this.pollTimer = setInterval(() => { this.alerts.poll(); this.view.refresh(); }, 5000);
            this.updateTimer = setInterval(() => void this.alerts.checkUpdate(), 6 * 60 * 60 * 1000);
            this.started = true;
            void this.alerts.checkUpdate();
        } catch (error) {
            this.api.UI.showToast(`FriendsInVoice could not start: ${String(error)}`, { type: "error" });
            this.stop();
            throw error;
        }
    }
    stop() {
        clearInterval(this.pollTimer);
        clearInterval(this.updateTimer);
        for (const unsubscribe of this.unsubscribers.splice(0).reverse()) {
            try { unsubscribe?.(); } catch (error) { this.api.Logger.error("Cleanup failed", error); }
        }
        this.guards?.stop();
        this.voiceLog?.stop();
        this.view?.stop();
        this.started = false;
    }
    onSwitch() { this.view?.refresh(); }
    getSettingsPanel() {
        return this.view ? settingsPanel(this.view) : document.createTextNode("Enable FriendsInVoice to view settings.");
    }
};
