const isUserId = value => typeof value === "string" && /^\d{17,20}$/.test(value);
const isNonce = value => typeof value === "string" && /^[a-f\d-]{36}$/i.test(value);

export function normalizeGuardGrant(item, actions) {
    return {
        userId: item.userId, actions: actions.filter(action => item.actions.includes(action)),
        ...(isNonce(item.inviteNonce) ? { inviteNonce: item.inviteNonce } : {}),
        ...(isUserId(item.inviteMessageId) ? { inviteMessageId: item.inviteMessageId } : {}),
        ...(isUserId(item.inviteChannelId) ? { inviteChannelId: item.inviteChannelId } : {})
    };
}

export function normalizeGuardInvites(raw) {
    return (Array.isArray(raw) ? raw : []).flatMap(item => {
        if (!isUserId(item?.userId) || typeof item.publicKey !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(item.publicKey) ||
            !isNonce(item.nonce) || !Array.isArray(item.actions) || !item.actions.length ||
            !item.actions.every(action => ["mute", "deafen", "disconnect"].includes(action))) return [];
        return [{ userId: item.userId, publicKey: item.publicKey, actions: [...new Set(item.actions)], nonce: item.nonce,
                ...(isUserId(item.messageId) ? { messageId: item.messageId } : {}),
                ...(isUserId(item.channelId) ? { channelId: item.channelId } : {}) }];
    }).slice(-50);
}
