import { accountStore } from "./accountStore.js";
import { normalizeGuardGrant, normalizeGuardInvites } from "./guardData.js";

export const LISTS = ["watchlist", "notifyOnline", "blacklist", "notifyVoice", "hidden"];
/** saved per Discord account; everything else is shared by every account on this computer */
export const ACCOUNT_KEYS = [...LISTS, "personalGuards", "knownGuardGrants", "pendingGuardInvites", "declinedGuardInvites", "guardPeerKeys", "guardBlocks", "guardReplay"];
export const ACTIONS = ["mute", "deafen", "disconnect"];
export const STATUSES = ["online", "idle", "dnd", "invisible"];

const DEFAULTS = {
    watchlist: [], notifyOnline: [], blacklist: [], notifyVoice: [], hidden: [],
    notifyOnce: true, smartReplies: true, smartRepliesAi: false,
    anthropicApiKey: "", syncPassphrase: "", aiModel: "claude-opus-5-5", guardServer: "https://friendsinvoice.sarhsoft.com", checkForUpdates: true, showWhatsNew: true,
    autoStatus: false, autoAllowGuardCommands: false, alwaysHideButton: true, statusInCall: "online", statusOutsideCall: "invisible",
    personalGuards: [], knownGuardGrants: [], pendingGuardInvites: [], declinedGuardInvites: [], guardPeerKeys: [], guardBlocks: [], guardReplay: []
};
export const isId = value => typeof value === "string" && /^\d{17,20}$/.test(value);
const isAction = value => ACTIONS.includes(value);

export function normalizeData(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const data = { ...DEFAULTS };
    for (const key of LISTS) data[key] = Array.isArray(source[key]) ? [...new Set(source[key].filter(isId))] : [];
    for (const key of ["notifyOnce", "smartReplies", "smartRepliesAi", "checkForUpdates", "showWhatsNew", "autoStatus", "autoAllowGuardCommands", "alwaysHideButton"])
        if (typeof source[key] === "boolean") data[key] = source[key];
    for (const key of ["anthropicApiKey", "aiModel", "syncPassphrase"])
        if (typeof source[key] === "string") data[key] = source[key].slice(0, 300);
    if (typeof source.guardServer === "string" && /^https:\/\/[^/\s]+\/?$/i.test(source.guardServer.trim())) data.guardServer = source.guardServer.trim();
    for (const key of ["statusInCall", "statusOutsideCall"])
        if (STATUSES.includes(source[key])) data[key] = source[key];
    for (const key of ["personalGuards", "knownGuardGrants"])
        data[key] = Array.isArray(source[key]) ? source[key].filter(item => isId(item?.userId) && Array.isArray(item.actions))
            .map(item => normalizeGuardGrant(item, ACTIONS)) : [];
    data.pendingGuardInvites = normalizeGuardInvites(source.pendingGuardInvites);
    data.declinedGuardInvites = (Array.isArray(source.declinedGuardInvites) ? source.declinedGuardInvites : [])
        .filter(value => typeof value === "string" && /^[a-f\d-]{36}$/i.test(value)).slice(-50);
    data.guardPeerKeys = Array.isArray(source.guardPeerKeys) ? source.guardPeerKeys.filter(item => isId(item?.userId) &&
        typeof item.publicKey === "string" && /^[A-Za-z0-9_-]{87}$/.test(item.publicKey))
        .map(item => ({ userId: item.userId, publicKey: item.publicKey })) : [];
    data.guardBlocks = Array.isArray(source.guardBlocks) ? source.guardBlocks.filter(item => isId(item?.userId) &&
        Number.isSafeInteger(item.until) && item.until > Date.now()).map(item => ({ userId: item.userId, until: item.until })) : [];
    data.guardReplay = Array.isArray(source.guardReplay) ? source.guardReplay.filter(item => typeof item?.nonce === "string" &&
        Number.isSafeInteger(item.createdAt) && Date.now() - item.createdAt < 300000)
        .map(item => ({ nonce: item.nonce, createdAt: item.createdAt, ...(isId(item.guardianId) ? { guardianId: item.guardianId } : {}) })) : [];
    return data;
}

const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key]]));

export class DataStore {
    constructor(api, accounts = accountStore("accounts")) {
        this.api = api;
        this.accounts = accounts;
        const raw = api.Data.load("settings");
        this.value = normalizeData(raw);
        // the account that kept the lists saved before they were split per account
        this.owner = isId(raw?.accountOwner) ? raw.accountOwner : "";
        this.accountId = null;
        this.loading = null;
        this.onAccount = null;
        // once split, the lists in the shared file aren't this account's; start empty until it loads
        if (this.owner) this.clearAccount();
    }
    clearAccount() { Object.assign(this.value, pick(normalizeData({}), ACCOUNT_KEYS)); }
    save() {
        const shared = pick(this.value, Object.keys(this.value).filter(key => !ACCOUNT_KEYS.includes(key)));
        // until the first account takes them, the old lists stay in the shared file
        this.api.Data.save("settings", this.owner ? { ...shared, accountOwner: this.owner } : this.value);
        if (this.accountId) void this.accounts.put(this.accountId, pick(this.value, ACCOUNT_KEYS)).catch(() => { });
    }
    /** load the lists of the account that's logged in; on start and whenever Discord connects */
    async useAccount(id) {
        if (!isId(id) || id === this.accountId || id === this.loading) return;
        this.accountId = null;
        this.loading = id;
        const inherits = !this.owner;
        if (!inherits) this.clearAccount();
        const saved = await this.accounts.get(id).catch(() => undefined);
        if (this.loading !== id) return;
        this.loading = null;
        if (saved) Object.assign(this.value, pick(normalizeData(saved), ACCOUNT_KEYS));
        else if (inherits) this.owner = id;
        else this.clearAccount();
        this.accountId = id;
        this.save();
        this.onAccount?.(id);
    }
    /** logged out: stop saving until the next account loads */
    leave() { this.accountId = this.loading = null; }
    listHas(key, id) { return LISTS.includes(key) && this.value[key].includes(id); }
    toggleList(key, id) {
        if (!LISTS.includes(key) || !isId(id)) return false;
        this.value[key] = this.listHas(key, id) ? this.value[key].filter(item => item !== id) : [...this.value[key], id];
        this.save();
        this.onListChange?.(key);
        return true;
    }
    set(key, value) {
        if (!(key in DEFAULTS)) return false;
        const candidate = normalizeData({ ...this.value, [key]: value });
        this.value[key] = candidate[key];
        this.save();
        if (LISTS.includes(key)) this.onListChange?.(key);
        return true;
    }
    grant(id, actions) {
        if (!isId(id) || !Array.isArray(actions) || !actions.every(isAction)) return false;
        const current = this.value.personalGuards.find(item => item.userId === id);
        this.value.personalGuards = [...this.value.personalGuards.filter(item => item.userId !== id),
            { ...current, userId: id, actions: ACTIONS.filter(action => actions.includes(action)) }];
        this.save();
        return true;
    }
    revoke(id) {
        this.value.personalGuards = this.value.personalGuards.filter(item => item.userId !== id);
        this.save();
    }
}
