/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { GuardAction, GuardCommand, GuardNotice, GuardWire } from "./personalGuardsTypes";

export const GUARD_ACTIONS: GuardAction[] = ["mute", "deafen", "disconnect"];
// for menu items such as "Mute JoeShaia"
export const GUARD_VERBS: Record<GuardAction, string> = {
    mute: "Mute",
    deafen: "Deafen",
    disconnect: "Disconnect",
};
export const GUARD_LABELS: Record<GuardAction, string> = {
    mute: "Mute microphone",
    deafen: "Deafen",
    disconnect: "Disconnect from voice",
};

const PREFIX = "[FriendsInVoice Guard v2] ";
// In Discord a guard message is one masked link: only its text shows, <…> stops the link preview,
// and the data is in the URL fragment (never sent to the site). Clicking it opens the project page.
const LINK = "https://github.com/mPhpMaster/FriendsInVoice#fiv-guard=";
const LINKED = /#fiv-guard=([A-Za-z0-9_\-\s]+)>?\)/;
const SNOWFLAKE = /^\d{17,20}$/;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;

export function isUserId(value: string): boolean {
    return SNOWFLAKE.test(value);
}

export function newGuardNonce(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function makeCommand(ownerId: string, action: GuardAction, inviteNonce?: string): GuardCommand {
    return { kind: "command", ownerId, action, createdAt: Date.now(), nonce: newGuardNonce(), ...(inviteNonce ? { inviteNonce } : {}) };
}

export function makeGrantNotice(ownerId: string, actions: GuardAction[]): GuardNotice {
    return { kind: "grant", ownerId, actions: GUARD_ACTIONS.filter(action => actions.includes(action)), createdAt: Date.now() };
}

function toBase64Url(text: string): string {
    let binary = "";
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
    try {
        const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
        return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
    } catch { return null; }
}

export function serializeWire(wire: GuardWire, summary = "Personal Guards message"): string {
    // Discord doesn't render a masked link whose text has an emoji, so the shield goes before it
    return `🛡️ [${summary}](<${LINK}${toBase64Url(JSON.stringify(wire))}>)`;
}

export function inviteSummary(actions: GuardAction[]): string {
    return `Personal Guard invite: ${GUARD_ACTIONS.filter(action => actions.includes(action)).map(action => GUARD_LABELS[action].toLowerCase()).join(", ")}`;
}

export function isGuardMessage(content: string): boolean {
    return content.startsWith(PREFIX) || content.includes("#fiv-guard=");
}

function guardJson(content: string): string | null {
    if (content.length > 3000) return null;
    const envelopes = content.split(PREFIX).length - 1 + content.split("#fiv-guard=").length - 1;
    // exactly one envelope: joined or pasted-together messages are rejected
    if (envelopes !== 1) return null;
    // messages from versions before the link format
    if (content.startsWith(PREFIX)) return content.slice(PREFIX.length);
    // composer extensions can insert spacing into long encoded words
    const data = LINKED.exec(content)?.[1]?.replace(/\s/g, "");
    return data ? fromBase64Url(data) : null;
}

export function parseGuardMessage(content: string): GuardWire | null {
    const json = guardJson(content);
    if (!json) return null;
    let data: unknown;
    try { data = JSON.parse(json); } catch { return null; }
    if (!data || typeof data !== "object") return null;
    const value = data as Record<string, unknown>;
    // Discord composer extensions can insert spacing into long encoded words.
    // Remove only transport whitespace; all field checks and AES-GCM verification still apply.
    for (const field of ["publicKey", "fromKey", "iv", "ciphertext"]) {
        if (typeof value[field] === "string") value[field] = value[field].replace(/[ \t\r\n]/g, "");
    }
    if (value.version !== 2 && value.version !== 3) return null;
    if (value.type === "key" && value.version === 2 && typeof value.publicKey === "string" &&
        value.publicKey.length === 87 && BASE64_URL.test(value.publicKey)) return value as unknown as GuardWire;
    if (value.type === "invite" && value.version === 3 && typeof value.publicKey === "string" &&
        value.publicKey.length === 87 && BASE64_URL.test(value.publicKey) &&
        typeof value.nonce === "string" && /^[a-f\d-]{36}$/i.test(value.nonce) &&
        Array.isArray(value.actions) && value.actions.length > 0 &&
        value.actions.every(action => GUARD_ACTIONS.includes(action))) return value as unknown as GuardWire;
    if (value.type === "sealed" && value.version === 2 && typeof value.to === "string" && isUserId(value.to) &&
        typeof value.fromKey === "string" && value.fromKey.length === 87 && BASE64_URL.test(value.fromKey) &&
        typeof value.iv === "string" && value.iv.length === 16 && BASE64_URL.test(value.iv) &&
        typeof value.ciphertext === "string" && value.ciphertext.length > 20 && BASE64_URL.test(value.ciphertext)) {
        return value as unknown as GuardWire;
    }
    return null;
}

export function parseGuardPayload(value: unknown): GuardCommand | GuardNotice | null {
    if (!value || typeof value !== "object") return null;
    const payload = value as Record<string, unknown>;
    if (typeof payload.ownerId !== "string" || !isUserId(payload.ownerId) ||
        typeof payload.createdAt !== "number" || !Number.isSafeInteger(payload.createdAt)) return null;
    if (payload.kind === "command" && GUARD_ACTIONS.includes(payload.action as GuardAction) &&
        typeof payload.nonce === "string" && /^[a-f\d-]{36}$/i.test(payload.nonce) &&
        (payload.inviteNonce === undefined || (typeof payload.inviteNonce === "string" && /^[a-f\d-]{36}$/i.test(payload.inviteNonce))))
        return payload as unknown as GuardCommand;
    if (payload.kind === "grant" && Array.isArray(payload.actions) &&
        payload.actions.every(action => GUARD_ACTIONS.includes(action))) return payload as unknown as GuardNotice;
    return null;
}
