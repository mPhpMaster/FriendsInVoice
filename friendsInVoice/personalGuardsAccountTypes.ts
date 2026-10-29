/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { GuardInvite, IncomingMessage } from "./personalGuardsTypes";

export type GuardAccountDecision = "accept" | "refuse" | "none";

export interface GuardAccountMessage extends IncomingMessage {
    type?: number;
    reactions?: { emoji: { id?: string | null; name?: string | null; }; me?: boolean; }[];
}

export interface GuardAccountSource {
    invite: GuardInvite;
    decision: GuardAccountDecision;
}

export interface GuardAccountBridge {
    currentAccount(): string | undefined;
    isDM(channelId: string, ownerId: string): boolean;
    fetchPage(channelId: string, before?: string): Promise<GuardAccountMessage[]>;
    reaction(channelId: string, messageId: string, emoji: string, add: boolean): Promise<void>;
}
