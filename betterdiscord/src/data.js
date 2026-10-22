export const LISTS = ["watchlist", "notifyOnline", "blacklist", "notifyVoice", "hidden"];
export const ACTIONS = ["mute", "deafen", "disconnect"];

const DEFAULTS = {
    watchlist: [], notifyOnline: [], blacklist: [], notifyVoice: [], hidden: [],
    notifyOnce: true, smartReplies: true, smartRepliesAi: false,
    anthropicApiKey: "", aiModel: "claude-opus-5-5", checkForUpdates: true,
    personalGuards: [], knownGuardGrants: [], guardPeerKeys: [], guardBlocks: [], guardReplay: []
};
const isId = value => typeof value === "string" && /^\d{17,20}$/.test(value);
const isAction = value => ACTIONS.includes(value);

export function normalizeData(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const data = { ...DEFAULTS };
    for (const key of LISTS) data[key] = Array.isArray(source[key]) ? [...new Set(source[key].filter(isId))] : [];
    for (const key of ["notifyOnce", "smartReplies", "smartRepliesAi", "checkForUpdates"])
        if (typeof source[key] === "boolean") data[key] = source[key];
    for (const key of ["anthropicApiKey", "aiModel"])
        if (typeof source[key] === "string") data[key] = source[key].slice(0, 300);
    for (const key of ["personalGuards", "knownGuardGrants"])
        data[key] = Array.isArray(source[key]) ? source[key].filter(item => isId(item?.userId) && Array.isArray(item.actions))
            .map(item => ({ userId: item.userId, actions: ACTIONS.filter(action => item.actions.includes(action)) })) : [];
    data.guardPeerKeys = Array.isArray(source.guardPeerKeys) ? source.guardPeerKeys.filter(item => isId(item?.userId) &&
        typeof item.publicKey === "string" && /^[A-Za-z0-9_-]{87}$/.test(item.publicKey))
        .map(item => ({ userId: item.userId, publicKey: item.publicKey })) : [];
    data.guardBlocks = Array.isArray(source.guardBlocks) ? source.guardBlocks.filter(item => isId(item?.userId) &&
        Number.isSafeInteger(item.until) && item.until > Date.now()).map(item => ({ userId: item.userId, until: item.until })) : [];
    data.guardReplay = Array.isArray(source.guardReplay) ? source.guardReplay.filter(item => typeof item?.nonce === "string" &&
        Number.isSafeInteger(item.createdAt) && Date.now() - item.createdAt < 300000)
        .map(item => ({ nonce: item.nonce, createdAt: item.createdAt })) : [];
    return data;
}

export class DataStore {
    constructor(api) {
        this.api = api;
        this.value = normalizeData(api.Data.load("settings"));
    }
    save() { this.api.Data.save("settings", this.value); }
    listHas(key, id) { return LISTS.includes(key) && this.value[key].includes(id); }
    toggleList(key, id) {
        if (!LISTS.includes(key) || !isId(id)) return false;
        this.value[key] = this.listHas(key, id) ? this.value[key].filter(item => item !== id) : [...this.value[key], id];
        this.save();
        return true;
    }
    set(key, value) {
        if (!(key in DEFAULTS)) return false;
        const candidate = normalizeData({ ...this.value, [key]: value });
        this.value[key] = candidate[key];
        this.save();
        return true;
    }
    grant(id, actions) {
        if (!isId(id) || !Array.isArray(actions) || !actions.every(isAction)) return false;
        this.value.personalGuards = [...this.value.personalGuards.filter(item => item.userId !== id),
            { userId: id, actions: ACTIONS.filter(action => actions.includes(action)) }];
        this.save();
        return true;
    }
    revoke(id) {
        this.value.personalGuards = this.value.personalGuards.filter(item => item.userId !== id);
        this.save();
    }
}
