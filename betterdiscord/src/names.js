import { accountStore } from "./accountStore.js";

const MAX = 5000;

/**
 * Saved names, so people Discord hasn't loaded still show by name. Names come from what Discord already loaded;
 * the only request is right-click → Refresh name.
 */
export class NameCache {
    constructor(store = accountStore("meta")) {
        this.store = store;
        this.names = new Map();
        this.timer = null;
    }
    async load() {
        const saved = await this.store.get("names").catch(() => null);
        for (const item of Array.isArray(saved) ? saved : []) if (item?.id && item.username && !this.names.has(item.id)) this.names.set(item.id, item);
    }
    all() { return [...this.names.values()]; }
    get(id) { return this.names.get(id); }
    /** newer entries win; used for names from another device */
    merge(items = []) {
        let changed = false;
        for (const item of items) {
            if (!item?.id || !item.username) continue;
            const current = this.names.get(item.id);
            if (current && current.savedAt >= item.savedAt) continue;
            this.names.set(item.id, item);
            changed = true;
        }
        if (changed) this.save();
        return changed;
    }
    remember(user, force = false) {
        if (!user?.id || !user.username) return;
        const current = this.names.get(user.id), globalName = user.globalName ?? null;
        if (!force && current && current.username === user.username && current.globalName === globalName) return;
        this.names.set(user.id, { id: user.id, username: user.username, globalName, avatar: user.avatar ?? null, savedAt: Date.now() });
        this.save();
        this.onChange?.();
    }
    save() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), 1000);
    }
    flush() {
        clearTimeout(this.timer);
        this.timer = null;
        return this.store.put("names", this.all().slice(-MAX)).catch(() => {});
    }
}
