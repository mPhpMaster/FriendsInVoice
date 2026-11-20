/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { getUserSettingLazy } from "@api/UserSettings";
import { SelectedChannelStore, showToast, UserStore } from "@webpack/common";

import { settings } from ".";

// Discord's own status user setting (online, idle, dnd, invisible)
const StatusSetting = getUserSettingLazy<string>("status", "status")!;

export const statusOptions = (defaultValue: string) => [
    { label: "Online", value: "online", default: defaultValue === "online" },
    { label: "Idle", value: "idle", default: defaultValue === "idle" },
    { label: "Do Not Disturb", value: "dnd", default: defaultValue === "dnd" },
    { label: "Invisible", value: "invisible", default: defaultValue === "invisible" },
];

/** after joining or leaving voice, wait this long for things to settle before asking */
export const AUTO_STATUS_DELAY = 10_000;

let pending: ReturnType<typeof setTimeout> | undefined;
let lastOffer = "";

const labelOf = (value: string) => statusOptions("").find(option => option.value === value)?.label ?? value;

/**
 * Suggests the status for being in or out of a call. Nothing changes until you click the notification:
 * the plugin never changes your status by itself.
 */
export function offerAutoStatus(inCall = !!SelectedChannelStore.getVoiceChannelId()) {
    if (!settings.store.autoStatus || !UserStore.getCurrentUser()) return;
    const wanted = inCall ? settings.store.statusInCall : settings.store.statusOutsideCall;
    if (StatusSetting.getSetting() === wanted) { lastOffer = ""; return; }
    // the same suggestion isn't repeated while it's still the one that fits
    if (lastOffer === wanted) return;
    lastOffer = wanted;
    showNotification({
        title: `Change your status to ${labelOf(wanted)}?`,
        body: inCall ? "You're in a call. Click to change it." : "You're not in a call anymore. Click to change it.",
        onClick: () => {
            if (StatusSetting.getSetting() === wanted) return;
            void StatusSetting.updateSetting(wanted);
            showToast({ text: `Your status is now ${labelOf(wanted)}`, variant: "success" });
        },
    });
}

function scheduleAutoStatus(delay: number) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => { pending = undefined; offerAutoStatus(); }, delay);
}

export function cancelAutoStatus() {
    if (pending) clearTimeout(pending);
    pending = undefined;
    lastOffer = "";
}

export function onAutoStatusVoiceUpdates(voiceStates: { userId: string; channelId?: string | null; }[]) {
    if (!settings.store.autoStatus) return;
    const myId = UserStore.getCurrentUser()?.id;
    // quick channel hopping ends in one suggestion, for wherever you are 10 seconds after the last hop
    if (voiceStates.some(state => state.userId === myId)) { lastOffer = ""; scheduleAutoStatus(AUTO_STATUS_DELAY); }
}
