/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { GuardAction } from "./personalGuardsTypes";

export type OwnerSetupStep = "choose" | "invite" | "waiting" | "active";

export function ownerSetupStep(actions: GuardAction[], paired = false, codeOpen = false): OwnerSetupStep {
    if (!actions.length) return "choose";
    if (paired) return "active";
    return codeOpen ? "waiting" : "invite";
}

export function ownerSetupMessage(step: OwnerSetupStep): string {
    switch (step) {
        case "choose": return "Choose the actions this person may use on your account.";
        case "invite": return "Get an invite code and give it to them. They enter it in their Personal Guards tab.";
        case "waiting": return "Waiting for them to enter the code. It works once, for 10 minutes.";
        case "active": return "Active. They can use the checked actions while you're both in the same voice channel.";
    }
}
