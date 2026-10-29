/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type GuardAction = "mute" | "deafen" | "disconnect";

export interface GuardGrant {
    userId: string;
    actions: GuardAction[];
    inviteNonce?: string;
    inviteMessageId?: string;
    inviteChannelId?: string;
}

export interface GuardCommand {
    kind: "command";
    ownerId: string;
    action: GuardAction;
    createdAt: number;
    nonce: string;
    inviteNonce?: string;
}

export interface GuardInviteWire {
    type: "invite";
    version: 3;
    publicKey: string;
    actions: GuardAction[];
    nonce: string;
}

export interface GuardNotice {
    kind: "grant";
    ownerId: string;
    actions: GuardAction[];
    createdAt: number;
}

export interface GuardKeyWire {
    type: "key";
    version: 2;
    publicKey: string;
}

export interface GuardSealedWire {
    type: "sealed";
    version: 2;
    to: string;
    fromKey: string;
    iv: string;
    ciphertext: string;
}

export type GuardWire = GuardKeyWire | GuardSealedWire | GuardInviteWire;

export interface GuardInvite {
    userId: string;
    actions: GuardAction[];
    publicKey: string;
    nonce: string;
    messageId?: string;
    channelId?: string;
}

export interface GuardsStore {
    personalGuards: GuardGrant[];
    knownGuardGrants: GuardGrant[];
    pendingGuardInvites: GuardInvite[];
    declinedGuardInvites: string[];
    guardPeerKeys: { userId: string; publicKey: string; }[];
    guardBlocks: { userId: string; until: number; }[];
    guardReplay: { nonce: string; createdAt: number; guardianId?: string; }[];
}

export interface GuardEvent {
    id: string;
    guardianId: string;
    action: GuardAction;
    undo(): void;
}

export interface IncomingMessage {
    id: string;
    channel_id: string;
    content: string;
    author: { id: string; bot?: boolean; };
}

export interface GuardDraftBridge {
    open(userId: string): Promise<void>;
    currentDm(userId: string): string | null;
    getDraft(channelId: string): string;
    insert(text: string): void;
    reveal(): void;
    wait(): Promise<void>;
}

export type GuardDraftResult = "ready" | "busy" | "occupied" | "unavailable";
