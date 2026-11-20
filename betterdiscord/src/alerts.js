import { isNewer } from "../../friendsInVoice/updateVersion.ts";

const online = status => !!status && status !== "offline" && status !== "invisible";

export class AlertService {
    constructor(api, bridge, data, openPage, version) {
        this.api = api;
        this.bridge = bridge;
        this.data = data;
        this.openPage = openPage;
        this.version = version;
        this.previousStatus = new Map();
        this.previousVoice = new Map();
        this.quietUntil = Date.now() + 15000;
        this.notifiedVersion = null;
    }
    seed() {
        const settings = this.data.value;
        for (const id of new Set([...settings.notifyOnline, ...settings.blacklist]))
            this.previousStatus.set(id, this.bridge.status(id));
        for (const id of settings.notifyVoice) this.previousVoice.set(id, this.bridge.visibleVoiceChannel(id));
    }
    reconnect() {
        this.quietUntil = Date.now() + 15000;
        this.seed();
    }
    poll() {
        const settings = this.data.value;
        for (const id of new Set([...settings.notifyOnline, ...settings.blacklist])) {
            const now = this.bridge.status(id);
            const before = this.previousStatus.get(id);
            this.previousStatus.set(id, now);
            if (Date.now() < this.quietUntil || before === undefined || online(before) || !online(now)) continue;
            if (settings.blacklist.includes(id)) {
                this.api.UI.showNotice(`${this.bridge.name(id)} is online (Run Away list).`, {
                    buttons: [{ label: "Go invisible", onClick: () => void this.bridge.setInvisible()
                        .catch(error => this.api.UI.showToast(String(error), { type: "error" })) }]
                });
            }
            if (settings.notifyOnline.includes(id)) {
                this.api.UI.showNotice(`${this.bridge.name(id)} is online.`, {
                    buttons: [{ label: "Open DM", onClick: () => void this.bridge.openDm(id).catch(error => this.api.UI.showToast(String(error), { type: "error" })) }]
                });
                if (settings.notifyOnce) this.data.set("notifyOnline", settings.notifyOnline.filter(item => item !== id));
            }
        }
        for (const id of settings.notifyVoice) {
            const now = this.bridge.visibleVoiceChannel(id);
            const before = this.previousVoice.get(id);
            this.previousVoice.set(id, now);
            if (Date.now() < this.quietUntil || before === undefined || before || !now) continue;
            const room = this.bridge.channel(now);
            const place = room ? this.bridge.roomDescription(room) : null;
            this.api.UI.showNotice(`${this.bridge.name(id)} joined ${place?.roomName ?? "voice"}.`, {
                buttons: [{ label: "Show rooms", onClick: () => this.openPage("voice") }]
            });
        }
    }
    async checkUpdate(manual = false) {
        if (!manual && !this.data.value.checkForUpdates) return;
        try {
            const response = await this.api.Net.fetch("https://api.github.com/repos/mPhpMaster/FriendsInVoice/releases/latest", {
                headers: { Accept: "application/vnd.github+json" }
            });
            if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
            const release = await response.json();
            const version = String(release.tag_name ?? "").replace(/^v/, "");
            const asset = release.assets?.find(item => item.name === "FriendsInVoice.plugin.js");
            if (!isNewer(version, this.version) || !asset) {
                if (manual) this.api.UI.showToast(`BetterDiscord plugin is up to date (v${this.version}).`, { type: "success" });
                return;
            }
            if (!manual && this.notifiedVersion === version) return;
            this.notifiedVersion = version;
            const url = `https://github.com/mPhpMaster/FriendsInVoice/releases/tag/v${version}`;
            this.api.UI.showNotice(`FriendsInVoice BetterDiscord v${version} is available.`, {
                buttons: [{ label: "Open release", onClick: () => window.open(url, "_blank", "noopener,noreferrer") }]
            });
        } catch (error) {
            if (manual) this.api.UI.showToast(`Update check failed: ${String(error)}`, { type: "error" });
        }
    }
}
