/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { offerAutoStatus, statusOptions } from "./autoStatus";
import type { GuardGrant, GuardInvite } from "./personalGuardsTypes";

export const settings = definePluginSettings({
    notifyOnce: {
        type: OptionType.BOOLEAN,
        description: "Remove someone from \"Notify me when online\" after their first notification",
        default: true,
    },
    smartReplies: {
        type: OptionType.BOOLEAN,
        description: "Suggest replies under the latest message someone sends you in a DM (click one to put it in the message box)",
        default: true,
    },
    smartRepliesAi: {
        type: OptionType.BOOLEAN,
        description: "Add a \"✨ Smarter replies\" button that asks Claude (AI) for replies. Needs an API key below; when you click it, the recent messages of that chat are sent to Anthropic",
        default: false,
    },
    anthropicApiKey: {
        type: OptionType.STRING,
        description: "Your Claude API key, from console.anthropic.com (saved in Vencord's settings on this computer)",
        default: "",
        placeholder: "sk-ant-...",
    },
    aiModel: {
        type: OptionType.STRING,
        description: "Claude model used for smarter replies",
        default: "claude-opus-5-5",
    },
    checkForUpdates: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when a new version of Friends in Voice is released",
        default: true,
    },
    showWhatsNew: {
        type: OptionType.BOOLEAN,
        description: "After Friends in Voice updates, show what's new the next time Discord starts",
        default: true,
    },
    stayInVoice: {
        type: OptionType.BOOLEAN,
        description: "Stay in voice when you're away: don't get moved to the server's AFK channel or dropped from a DM call, for up to 2 hours without mouse or keyboard",
        default: false,
        restartNeeded: true,
    },
    neverIdle: {
        type: OptionType.BOOLEAN,
        description: "Never go idle: keep your status when you step away from the computer",
        default: false,
        restartNeeded: true,
    },
    autoStatus: {
        type: OptionType.BOOLEAN,
        description: "Status suggestions: when you join or leave a call, a notification asks if you want to change your status (pick both statuses below). Nothing changes until you click it",
        default: false,
        onChange: () => offerAutoStatus(),
    },
    statusInCall: {
        type: OptionType.SELECT,
        description: "Status suggestions: the status to suggest while you're in a voice channel or call",
        options: statusOptions("online"),
        onChange: () => offerAutoStatus(),
    },
    statusOutsideCall: {
        type: OptionType.SELECT,
        description: "Status suggestions: the status to suggest when you're not in a call",
        options: statusOptions("invisible"),
        onChange: () => offerAutoStatus(),
    },
    autoAllowGuardCommands: {
        type: OptionType.BOOLEAN,
        description: "Personal Guards: apply your guardians' commands right away, without asking you first (off: you get an Allow button and nothing happens until you click it)",
        default: false,
    },
    alwaysHideButton: {
        type: OptionType.BOOLEAN,
        description: "Keep the Friends in Voice button hidden in the server list. Shift + F12 opens the page and shows the button for 5 seconds",
        default: true,
    },
    guardServer: {
        type: OptionType.STRING,
        description: "Personal Guards server (pairing codes and encrypted guard commands go here, never through Discord). Leave it as is unless you run your own",
        default: "https://friendsinvoice.sarhsoft.com",
        placeholder: "https://friendsinvoice.sarhsoft.com",
    },
    watchlist: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
    notifyOnline: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
    blacklist: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
    notifyVoice: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
    hidden: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
    personalGuards: { type: OptionType.CUSTOM, default: [] as GuardGrant[] },
    knownGuardGrants: { type: OptionType.CUSTOM, default: [] as GuardGrant[] },
    pendingGuardInvites: { type: OptionType.CUSTOM, default: [] as GuardInvite[] },
    declinedGuardInvites: { type: OptionType.CUSTOM, default: [] as string[] },
    guardBlocks: { type: OptionType.CUSTOM, default: [] as { userId: string; until: number; }[] },
    guardReplay: { type: OptionType.CUSTOM, default: [] as { nonce: string; createdAt: number; }[] },
    guardPeerKeys: { type: OptionType.CUSTOM, default: [] as { userId: string; publicKey: string; }[] },
    /** the account that kept the lists saved before they were split per account */
    accountDataOwner: { type: OptionType.CUSTOM, default: "" },
});
