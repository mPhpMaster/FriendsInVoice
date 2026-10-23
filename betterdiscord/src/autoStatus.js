/** Auto switch status: one status while you're in a call, another when you're not */
export class AutoStatus {
    constructor(api, bridge, data) {
        this.api = api;
        this.bridge = bridge;
        this.data = data;
    }
    apply(inCall = !!this.bridge.myVoiceChannel()) {
        const { autoStatus, statusInCall, statusOutsideCall } = this.data.value;
        if (!autoStatus || !this.bridge.currentId()) return;
        void this.bridge.setStatus(inCall ? statusInCall : statusOutsideCall)
            .catch(error => this.api.Logger.error("Auto switch status failed", error));
    }
    onUpdates(voiceStates) {
        if (!this.data.value.autoStatus || !Array.isArray(voiceStates)) return;
        const me = this.bridge.currentId();
        const mine = voiceStates.find(state => state?.userId === me);
        if (mine) this.apply(!!mine.channelId);
    }
}
