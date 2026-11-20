import { DEFAULT_GUARD_SERVER } from "../../friendsInVoice/guardServer.ts";
import { deriveSyncKeys, SYNC_LISTS, SyncError, syncOnce } from "../../friendsInVoice/syncCore.ts";

import { accountStore } from "./accountStore.js";
import { netTransport } from "./guards.js";

const PUSH_DELAY = 60_000;
const PULL_EVERY = 15 * 60_000;
const logId = entry => `${entry.time}:${entry.userId}:${entry.kind}`;

/**
 * Syncs the lists, the Log and saved names between devices through the Friends in Voice server.
 * Everything is encrypted here with a key made from the sync passphrase; Discord is never contacted.
 */
export class SyncService {
    constructor(api, bridge, data, voiceLog, options = {}) {
        Object.assign(this, { api, bridge, data, voiceLog });
        this.transport = options.transport ?? netTransport(api);
        this.meta = options.meta ?? accountStore("meta");
        this.timers = options.timers ?? { set: setTimeout, clear: clearTimeout, every: setInterval, stopEvery: clearInterval };
        this.changedAt = {};
        this.metaAccount = null;
        this.keys = null;
        this.running = null;
        this.applying = false;
        this.lastError = "";
    }
    enabled() { return (this.data.value.syncPassphrase ?? "").trim().length >= 8; }
    start() {
        this.data.onListChange = key => this.listChanged(key);
        this.pull = this.timers.every(() => void this.run(), PULL_EVERY);
    }
    stop() {
        this.data.onListChange = null;
        this.timers.clear(this.pushTimer);
        this.timers.stopEvery(this.pull);
    }
    async loadMeta(account) {
        if (this.metaAccount === account) return;
        this.changedAt = (await this.meta.get(`syncMeta_${account}`).catch(() => null)) ?? {};
        this.metaAccount = account;
    }
    listChanged(key) {
        const account = this.data.accountId;
        if (this.applying || !account || !SYNC_LISTS.includes(key)) return;
        this.changedAt[key] = Date.now();
        void this.meta.put(`syncMeta_${account}`, { ...this.changedAt }).catch(() => {});
        this.schedule();
    }
    /** called after the Log or names change */
    schedule() {
        if (this.applying || !this.enabled()) return;
        this.timers.clear(this.pushTimer);
        this.pushTimer = this.timers.set(() => void this.run(), PUSH_DELAY);
    }
    local() {
        const lists = {};
        for (const key of SYNC_LISTS) lists[key] = { ids: [...this.data.value[key]], changedAt: this.changedAt[key] ?? 0 };
        const log = this.voiceLog.entries.map(({ key, ...entry }) => entry);
        return { lists, log, names: this.bridge.names?.all() ?? [] };
    }
    apply(account, merged) {
        this.applying = true;
        try {
            for (const key of SYNC_LISTS) {
                const remote = merged.lists[key];
                if (!remote || remote.changedAt <= (this.changedAt[key] ?? 0)) continue;
                this.data.value[key] = [...remote.ids];
                this.changedAt[key] = remote.changedAt;
            }
            this.data.save();
            const known = new Set(this.voiceLog.entries.map(logId));
            const added = merged.log.filter(entry => !known.has(logId(entry)));
            if (added.length) {
                this.voiceLog.entries = [...this.voiceLog.entries, ...added.map(entry => ({ ...entry, key: this.voiceLog.nextKey++ }))]
                    .sort((a, b) => b.time - a.time).slice(0, 5000);
                this.voiceLog.onChange?.();
                this.voiceLog.save();
            }
            this.bridge.names?.merge(merged.names);
        } finally { this.applying = false; }
        void this.meta.put(`syncMeta_${account}`, { ...this.changedAt }).catch(() => {});
    }
    run(manual = false) {
        this.running ??= (async () => {
            const account = this.data.accountId;
            if (!this.enabled() || !account || this.voiceLog.accountId !== account) {
                if (manual) this.api.UI.showToast("Set a sync passphrase (8+ characters) first.", { type: "error" });
                return;
            }
            await this.loadMeta(account);
            const passphrase = this.data.value.syncPassphrase.trim();
            try {
                if (this.keys?.account !== account || this.keys.passphrase !== passphrase)
                    this.keys = { account, passphrase, keys: await deriveSyncKeys(passphrase, account) };
                const merged = await syncOnce({ transport: this.transport, server: this.data.value.guardServer || DEFAULT_GUARD_SERVER, keys: this.keys.keys, local: this.local() });
                if (this.data.accountId === account) this.apply(account, merged);
                this.lastError = "";
                if (manual) this.api.UI.showToast("Synced.", { type: "success" });
            } catch (error) {
                const message = error?.message ?? String(error);
                if (manual || (message !== this.lastError && !(error instanceof SyncError && error.status === 0)))
                    this.api.UI.showToast(`Sync: ${message}`, { type: "error" });
                this.lastError = message;
            }
        })().finally(() => { this.running = null; });
        return this.running;
    }
}
