/** after joining or leaving voice, wait this long for things to settle before asking */
export const AUTO_STATUS_DELAY = 10_000;
const LABELS = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", invisible: "Invisible" };

/**
 * Status suggestions: when you join or leave a call, a notice asks if you want the status you picked.
 * Nothing changes until you click it; the plugin never changes your status by itself.
 */
export class AutoStatus {
    constructor(api, bridge, data, timers = { set: setTimeout, clear: clearTimeout }) {
        this.api = api;
        this.bridge = bridge;
        this.data = data;
        this.timers = timers;
        this.pending = null;
        this.lastOffer = "";
    }
    /** shows the suggestion for being in or out of a call, once, and only when your status differs */
    apply(inCall = !!this.bridge.myVoiceChannel()) {
        const { autoStatus, statusInCall, statusOutsideCall } = this.data.value;
        if (!autoStatus || !this.bridge.currentId()) return;
        const wanted = inCall ? statusInCall : statusOutsideCall;
        if (this.bridge.currentStatus?.() === wanted) { this.lastOffer = ""; return; }
        if (this.lastOffer === wanted) return;
        this.lastOffer = wanted;
        const label = LABELS[wanted] ?? wanted;
        this.api.UI.showNotice(`Change your status to ${label}? ${inCall ? "You're in a call." : "You're not in a call anymore."}`, {
            timeout: 30_000,
            buttons: [{ label: `Set ${label}`, onClick: () => this.accept(wanted) }]
        });
    }
    accept(status) {
        if (this.bridge.currentStatus?.() === status) return;
        void this.bridge.setStatus(status)
            .catch(error => this.api.Logger.error("Changing the status failed", error));
    }
    schedule(delay) {
        this.cancel();
        this.pending = this.timers.set(() => { this.pending = null; this.apply(); }, delay);
    }
    cancel() {
        if (this.pending) this.timers.clear(this.pending);
        this.pending = null;
    }
    /** quick channel hopping ends in one suggestion, for wherever you are 10 seconds after the last hop */
    onUpdates(voiceStates) {
        if (!this.data.value.autoStatus || !Array.isArray(voiceStates)) return;
        const me = this.bridge.currentId();
        if (voiceStates.some(state => state?.userId === me)) { this.lastOffer = ""; this.schedule(AUTO_STATUS_DELAY); }
    }
}
