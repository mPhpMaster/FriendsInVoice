/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { getUserSettingLazy } from "@api/UserSettings";
import type { PluginNative } from "@utils/types";
import { ChannelStore, PresenceStore, showToast, UserStore, VoiceStateStore } from "@webpack/common";

import { openPageFor,openPrivateChannel, setPageOpen, settings } from ".";
import type { UpdateStatus } from "./updateTypes";
import { isNewer } from "./updateVersion";
import { describeChannel, displayName } from "./voiceContent";
import { seedVoiceLog } from "./voiceLog";
const StatusSettings = getUserSettingLazy<string>("status", "status")!;
const VERSION = "1.14.1";
const REPO = "mPhpMaster/FriendsInVoice";// ---------- lists ----------
const UpdateNative = VencordNative.pluginHelpers.FriendsInVoice as PluginNative<typeof import("./native")>;

export type ListKey = "watchlist" | "notifyOnline" | "blacklist" | "notifyVoice" | "hidden";

export function inList(key: ListKey, id: string) {
    return settings.store[key].includes(id);
}

export function toggleInList(key: ListKey, id: string) {
    const list = settings.store[key];
    settings.store[key] = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    if (key === "notifyOnline" || key === "blacklist") lastStatus.set(id, PresenceStore.getStatus(id));
    if (key === "notifyVoice") lastVoiceChannel.set(id, VoiceStateStore.getVoiceStateForUser(id)?.channelId ?? null);
}

// ---------- voice join notifications ----------

const lastVoiceChannel = new Map<string, string | null>();

export function seedVoiceChannels() {
    lastVoiceChannel.clear();
    for (const id of settings.store.notifyVoice) {
        lastVoiceChannel.set(id, VoiceStateStore.getVoiceStateForUser(id)?.channelId ?? null);
    }
}

function notifyJoinedVoice(id: string, channelId: string) {
    const { user, name } = nameOf(id);
    const channel = ChannelStore.getChannel(channelId);
    const where = channel ? describeChannel(channel) : null;
    const offline = !isOnline(PresenceStore.getStatus(id));

    showNotification({
        title: `🔊 ${name} joined a voice room${offline ? " (shows offline)" : ""}`,
        body: where ? `${where.roomName} · ${where.place}. Click to see who's with them.` : "Click to see where they are.",
        icon: user?.getAvatarURL(undefined, 128),
        onClick: () => openPageFor(id),
    });
}

export function onVoiceStateUpdates(voiceStates: { userId: string; channelId?: string | null; }[]) {
    const list = settings.store.notifyVoice;
    if (!list.length) return;

    for (const s of voiceStates) {
        if (!list.includes(s.userId)) continue;

        const now = s.channelId ?? null;
        const prev = lastVoiceChannel.get(s.userId);
        lastVoiceChannel.set(s.userId, now);

        // only notify when they go from "not in voice" to "in a room"; moving between rooms isn't a new join
        if (Date.now() < quietUntil || !now || prev) continue;
        notifyJoinedVoice(s.userId, now);
    }
}

// ---------- online notifications ----------

const lastStatus = new Map<string, string>();
let quietUntil = 0;
let reseedTimer: ReturnType<typeof setTimeout> | undefined;

// after (re)connecting, Discord sends presences and voice states in bulk; don't treat those as changes,
// and re-read where everyone is once things have settled
export function startQuietPeriod() {
    quietUntil = Date.now() + 15_000;
    clearTimeout(reseedTimer);
    reseedTimer = setTimeout(() => {
        seedStatuses();
        seedVoiceChannels();
        seedVoiceLog();
    }, 15_000);
}

export const isQuiet = () => Date.now() < quietUntil;

export const isOnline = (status?: string) => !!status && status !== "offline" && status !== "invisible";

export function seedStatuses() {
    lastStatus.clear();
    for (const id of [...settings.store.notifyOnline, ...settings.store.blacklist]) {
        lastStatus.set(id, PresenceStore.getStatus(id));
    }
}

function nameOf(id: string) {
    const user = UserStore.getUser(id);
    return { user, name: user ? displayName(user, null) : "Someone" };
}

function notifyCameOnline(id: string) {
    const { user, name } = nameOf(id);
    showNotification({
        title: `${name} is online`,
        body: "Click to open your DM with them.",
        icon: user?.getAvatarURL(undefined, 128),
        onClick: () => {
            setPageOpen(false);
            openPrivateChannel(id);
        },
    });

    if (settings.store.notifyOnce) {
        settings.store.notifyOnline = settings.store.notifyOnline.filter(x => x !== id);
    }
}

function notifyRunAway(id: string) {
    const { user, name } = nameOf(id);
    showNotification({
        title: `🏃 ${name} is online`,
        body: "They're on your Run away list. Click to go invisible.",
        icon: user?.getAvatarURL(undefined, 128),
        onClick: async () => {
            await StatusSettings.updateSetting("invisible");
            showToast({ text: "Your status is now Invisible", variant: "success" });
        },
    });
}

export function onPresenceChange() {
    const { notifyOnline, blacklist } = settings.store;
    if (!notifyOnline.length && !blacklist.length) return;

    for (const id of new Set([...notifyOnline, ...blacklist])) {
        const status = PresenceStore.getStatus(id);
        const prev = lastStatus.get(id);
        lastStatus.set(id, status);

        // presences arrive in bulk after (re)connecting, so don't treat those as "came online"
        if (Date.now() < quietUntil || prev === undefined) continue;
        if (isOnline(prev) || !isOnline(status)) continue;

        if (blacklist.includes(id)) notifyRunAway(id);
        if (notifyOnline.includes(id)) notifyCameOnline(id);
    }
}

// ---------- update check ----------

let notifiedVersion: string | null = null;
let updateTimer: ReturnType<typeof setInterval> | undefined;

let updateInProgress = false;

async function applyUpdate(version: string, releaseUrl: string) {
    if (updateInProgress) return;
    updateInProgress = true;
    let lastStage = "";
    const timer = setInterval(async () => {
        const status = await UpdateNative.getUpdateStatus() as UpdateStatus;
        if (status.stage !== lastStage) {
            lastStage = status.stage;
            showToast({ text: status.message, variant: status.stage === "failed" ? "critical" : "success" });
        }
    }, 1000);
    try {
        showToast({ text: `Downloading Friends in Voice v${version}…`, variant: "success" });
        const status = await UpdateNative.installUpdate(version, VERSION) as UpdateStatus;
        if (status.stage === "failed") {
            showNotification({
                title: "Friends in Voice update failed",
                body: `${status.message} Click to open the release page.`,
                permanent: true,
                onClick: () => VencordNative.native.openExternal(releaseUrl)
            });
        } else {
            showToast({ text: status.message, variant: "success" });
        }
    } catch (error) {
        showNotification({
            title: "Friends in Voice update failed",
            body: `${String(error)} Click to open the release page.`,
            permanent: true,
            onClick: () => VencordNative.native.openExternal(releaseUrl)
        });
    } finally {
        clearInterval(timer);
        updateInProgress = false;
    }
}

export async function checkForUpdate(manual = false) {
    if (!manual && !settings.store.checkForUpdates) return;

    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
            headers: { Accept: "application/vnd.github+json" }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const { tag_name } = await res.json();
        const latest = String(tag_name).replace(/^v/, "");

        if (!isNewer(latest, VERSION)) {
            if (manual) showToast({ text: `Friends in Voice is up to date (v${VERSION})`, variant: "success" });
            return;
        }
        if (!manual && notifiedVersion === latest) return;
        notifiedVersion = latest;

        showNotification({
            title: `Friends in Voice v${latest} is out`,
            body: `You have v${VERSION}. Click to download, install, build, and restart Discord automatically.`,
            permanent: true,
            onClick: () => void applyUpdate(latest, `https://github.com/${REPO}/releases/tag/v${latest}`),
        });
    } catch {
        if (manual) showToast({ text: "Couldn't check for updates", variant: "critical" });
    }
}

export function startUpdateTimer() { updateTimer = setInterval(() => checkForUpdate(), 6 * 60 * 60 * 1000); }
export function stopUpdateTimer() { clearInterval(updateTimer); clearTimeout(reseedTimer); }
