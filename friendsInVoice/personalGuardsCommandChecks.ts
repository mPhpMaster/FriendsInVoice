/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { GuardCommandContext } from "./personalGuardsCommandTypes";
import { GUARD_ACTIONS, isUserId } from "./personalGuardsProtocol";
import { writeGuardSetting } from "./personalGuardsSettings";
import type { GuardCommand, GuardsStore } from "./personalGuardsTypes";

export const GUARD_COMMAND_COOLDOWN = 3000;

export function guardCommandRejection(store: GuardsStore, command: GuardCommand, context: GuardCommandContext): string | null {
    if (!isUserId(context.senderId) || context.senderId === context.ownerId || command.ownerId !== context.ownerId) return "Wrong account.";
    if (!Number.isSafeInteger(command.createdAt) || Math.abs(context.now - command.createdAt) > 5 * 60_000) return "Command expired. Send a new command.";
    const grant = store.personalGuards.find(item => item.userId === context.senderId);
    if (!GUARD_ACTIONS.includes(command.action) || !grant?.actions.includes(command.action)) return "The sender is not allowed to use this action.";
    if (grant.inviteNonce ? command.inviteNonce !== grant.inviteNonce : !context.pinnedKey || context.pinnedKey !== context.senderKey)
        return "Invitation or secure key does not match. Use the newest invitation.";
    if (!context.sharesVoice) return "Both accounts must be in the same voice channel.";
    if (store.guardBlocks.some(block => block.userId === context.senderId && block.until > context.now)) return "This guardian is temporarily blocked.";
    if (store.guardReplay.some(entry => entry.nonce === command.nonce)) return "Duplicate command.";
    if (store.guardReplay.some(entry => entry.guardianId === context.senderId && context.now - entry.createdAt < GUARD_COMMAND_COOLDOWN))
        return "Please wait three seconds before another command.";
    return null;
}

export function reserveGuardCommand(store: GuardsStore, command: GuardCommand, senderId: string, now: number): void {
    writeGuardSetting(store, "guardReplay", [...store.guardReplay.filter(entry => now - entry.createdAt <= 5 * 60_000),
        { nonce: command.nonce, createdAt: now, guardianId: senderId }]);
}
