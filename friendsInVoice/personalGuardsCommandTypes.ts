/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface GuardCommandContext {
    ownerId: string;
    senderId: string;
    senderKey: string;
    pinnedKey?: string;
    sharesVoice: boolean;
    now: number;
}
