/** after joining or leaving voice, wait this long for things to settle before changing the status */
export const AUTO_STATUS_DELAY = 10_000;
/** at most this many automatic status changes in any minute */
export const AUTO_STATUS_PER_MINUTE = 3;

/** Auto switch status: one status while you're in a call, another when you're not */
export class AutoStatus {
    constructor(api, bridge, data, timers = { set: setTimeout, clear: clearTimeout, now: Date.now }) {
        this.api = api;
        this.bridge = bridge;
        this.data = data;
        this.timers = timers;
        this.pending = null;
        this.writes = [];
    }
    /** only writes when the status actually changes, and at most 3 times a minute */
    apply(inCall = !!this.bridge.myVoiceChannel()) {
        const { autoStatus, statusInCall, statusOutsideCall } = this.data.value;
        if (!autoStatus || !this.bridge.currentId()) return;
        const now = this.timers.now();
        this.writes = this.writes.filter(time => now - time < 60_000);
        if (this.writes.length >= AUTO_STATUS_PER_MINUTE) return this.schedule(60_000 - (now - this.writes[0]) + 1000);
        const wanted = inCall ? statusInCall : statusOutsideCall;
        if (this.bridge.currentStatus?.() === wanted) return;
        this.writes.push(now);
        void this.bridge.setStatus(wanted)
            .catch(error => this.api.Logger.error("Auto switch status failed", error));
    }
    schedule(delay) {
        this.cancel();
        this.pending = this.timers.set(() => { this.pending = null; this.apply(); }, delay);
    }
    cancel() {
        if (this.pending) this.timers.clear(this.pending);
        this.pending = null;
    }
    /** quick channel hopping ends in one status change, for wherever you are 10 seconds after the last hop */
    onUpdates(voiceStates) {
        if (!this.data.value.autoStatus || !Array.isArray(voiceStates)) return;
        const me = this.bridge.currentId();
        if (voiceStates.some(state => state?.userId === me)) this.schedule(AUTO_STATUS_DELAY);
    }
}
