/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";
import "./styleExtras.css";

import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { showNotification } from "@api/Notifications";
import { isPluginEnabled } from "@api/PluginManager";
import { addServerListElement, removeServerListElement, ServerListRenderPosition } from "@api/ServerList";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import definePlugin, { type PluginNative } from "@utils/types";
import { Alerts, ChannelActionCreators, ChannelStore, ContextMenuApi, Menu, PresenceStore, React, ReactDOM, RelationshipStore, SelectedChannelStore, SelectedGuildStore, Tooltip, useEffect, useReducer, UserStore, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

import { leaveAccount, loadAccount, startAccountData, stopAccountData } from "./accountData";
import { cancelAutoStatus, offerAutoStatus, onAutoStatusVoiceUpdates, statusOptions } from "./autoStatus";
import { codeFromText } from "./guardServer";
import { flushNames, loadNames } from "./nameCache";
import { checkForUpdate, onPresenceChange, onVoiceStateUpdates, seedStatuses, seedVoiceChannels, startQuietPeriod, startUpdateTimer, stopUpdateTimer } from "./notifications";
import { GuardCodeCard } from "./personalGuardsCodes";
import { GuardNotificationHost } from "./personalGuardsNotice";
import { isGuardMessage } from "./personalGuardsProtocol";
import { clearGuardRuntime, installGuardCommandHandler } from "./personalGuardsRuntime";
import { startGuardServer, stopGuardServer, syncGuardProfile, updateGuardListening } from "./personalGuardsServer";
import { PersonalGuardsTab } from "./personalGuardsTab";
import { settings } from "./pluginSettings";
import { SmartReplies } from "./smartReplies";
import { startStayInVoiceLimit, stopStayInVoiceLimit } from "./stayInVoice";
import { onSyncAccountChange, startSync, stopSync } from "./sync";
import { UserContextPatch } from "./userContextMenu";
import { useVoiceData, visibleVoiceChannelId } from "./voiceContent";
import { flushVoiceLog, onGuildDelete, onGuildUpdate, onRelationshipAdd, onRelationshipRemove, onVoiceLogUpdates, seedVoiceLog } from "./voiceLog";
import { LogTab, useLog } from "./voiceLogTab";
import { AlertsTab, MyListTab, RunAwayTab, VoiceTab, WatchedCard } from "./voiceTabs";
import { REPO_URL, showWhatsNew } from "./whatsNew";

export { inList, isOnline, toggleInList } from "./notifications";
export { settings } from "./pluginSettings";

const VERSION = "1.24.0";
const ToggleNative = VencordNative.pluginHelpers.FriendsInVoice as PluginNative<typeof import("./native")>;

// Restarts Discord without Vencord. A desktop shortcut brings it back (the plugin can't run while Vencord is off).
function toggleVencord() {
    Alerts.show({
        title: "Turn Vencord off?",
        body: "Discord closes and opens again as normal Discord, without Vencord or Friends in Voice. To turn Vencord back on, open the \"Discord + Vencord\" shortcut on your desktop. Running the Friends in Voice installer again also turns it back on.",
        confirmText: "Restart without Vencord",
        cancelText: "Cancel",
        onConfirm: async () => {
            const result = await ToggleNative.disableVencord();
            if (!result.ok) showNotification({ title: "Toggle Vencord", body: result.error ?? "Couldn't turn Vencord off." });
        },
    });
}
const DONATE_URL = "https://paypal.me/mfsafadi";

const cl = classNameFactory("vc-fiv-");

// Discord's openPrivateChannel now takes { recipientIds }. Vencord's helper still passes a bare user id,
// which Discord reads as "no recipients" and creates an empty group DM, so call Discord directly.
export function openPrivateChannel(userId: string) {
    return ChannelActionCreators.openPrivateChannel({ recipientIds: [userId] });
}


let pageOpen = false;
let requestedTab: Tab = "voice";
let guardsPageRequest = 0;
let focusUserId: string | null = null;
const pageListeners = new Set<() => void>();

export function setPageOpen(open: boolean) {
    pageOpen = open;
    if (!open) focusUserId = null;
    pageListeners.forEach(fn => fn());
}

function setFocusUser(id: string | null) {
    focusUserId = id;
    pageListeners.forEach(fn => fn());
}

export function openPageFor(id: string) {
    focusUserId = id;
    requestedTab = "voice";
    setPageOpen(true);
}

export function openGuardsPage() {
    requestedTab = "guards";
    guardsPageRequest++;
    setPageOpen(true);
}

function usePageOpen() {
    const [, force] = useReducer(x => x + 1, 0);
    useEffect(() => {
        pageListeners.add(force);
        return () => void pageListeners.delete(force);
    }, []);
    return pageOpen;
}

// ---------- page ----------

type Tab = "voice" | "mine" | "alerts" | "runaway" | "guards" | "log";

function getNav() {
    return document.querySelector<HTMLElement>(`.${cl("server-button")}`)?.closest("nav") ?? null;
}

// Discord's sidebar: the server list, the channel / friends list and the user panel under them
function getSidebar() {
    return document.querySelector<HTMLElement>('section[class^="panels_"], section[class*=" panels_"]')?.parentElement ?? null;
}

// the main area right of the sidebar, where Discord shows the chat or its own pages (Friends, Shop, …)
function getContentRect() {
    const sidebar = getSidebar()?.getBoundingClientRect();
    const nav = getNav()?.getBoundingClientRect();
    return { left: sidebar?.right ?? nav?.right ?? 72, top: sidebar?.top ?? nav?.top ?? 0 };
}

function Spotlight({ id, data }: { id: string; data: ReturnType<typeof useVoiceData>; }) {
    return (
        <div className={cl("spotlight")}>
            <div className={cl("spotlight-head")}>
                <span>📍 Where they are now</span>
                <span className={cl("remove")} title="Hide" onClick={() => setFocusUser(null)}>✕</span>
            </div>
            <WatchedCard id={id} room={data.roomByUser.get(id)} myChannel={data.myChannel} />
        </div>
    );
}

// values the patches were applied with (they only change after reloading Discord)
const loadedAway = { stayInVoice: false, neverIdle: false };

function FriendsInVoicePage() {
    usePageOpen(); // re-render when the focused person changes
    const focus = focusUserId;
    const data = useVoiceData(focus);
    const log = useLog();
    const { notifyOnline, blacklist, notifyVoice } = settings.use(["notifyOnline", "blacklist", "notifyVoice"]);
    settings.use(["personalGuards", "knownGuardGrants", "guardPeerKeys", "pendingGuardInvites"]);
    const [tab, setTab] = useState<Tab>(requestedTab);
    const [, refreshGuards] = useReducer(value => value + 1, 0);
    const [rect, setRect] = useState(getContentRect);
    const bodyRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!focus) return;
        setTab("voice");
        bodyRef.current?.scrollTo({ top: 0 });
    }, [focus]);

    useEffect(() => { if (requestedTab === "guards") setTab("guards"); }, [guardsPageRequest]);


    const guildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const [initialNav] = useState(() => `${guildId}/${channelId}`);

    // close when the user navigates somewhere else
    useEffect(() => {
        if (`${guildId}/${channelId}` !== initialNav) setPageOpen(false);
    }, [guildId, channelId]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPageOpen(false); };
        const onResize = () => setRect(getContentRect());

        // any click in the server list (Discord logo, a server, …) closes the page, even if the route doesn't change
        const nav = getNav();
        const onNavClick = (e: MouseEvent) => {
            if (!(e.target as Element | null)?.closest(`.${cl("server-button")}`)) setPageOpen(false);
        };

        // follow the sidebar when its divider is dragged
        const sidebar = getSidebar();
        const sidebarObserver = new ResizeObserver(onResize);
        if (sidebar) sidebarObserver.observe(sidebar);

        window.addEventListener("keydown", onKey);
        window.addEventListener("resize", onResize);
        nav?.addEventListener("click", onNavClick, true);
        // a running Activity (its iframe sits in a layer above the app) would cover the page: hide it while the page is open
        document.body.classList.add(cl("page-open"));
        return () => {
            document.body.classList.remove(cl("page-open"));
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onResize);
            nav?.removeEventListener("click", onNavClick, true);
            sidebarObserver.disconnect();
        };
    }, []);

    const friendsInVoice = new Set(data.rooms.flatMap(r => r.members.filter(m => m.isFriend && !m.isMe && !m.isHidden).map(m => m.user.id))).size;
    const watchedInVoice = data.watchlist.filter(id => data.roomByUser.has(id)).length;

    return (
        <div className={cl("page")} style={{ left: rect.left, top: rect.top }}>
            <div className={cl("page-header")}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d={HEADSET_PATH} /></svg>
                <div className={cl("page-title")}>Friends in Voice</div>
                <div className={cl("tabs")}>
                    <div className={cl("tab", tab === "voice" && "tab-active")} onClick={() => setTab("voice")}>
                        🔊 In voice <span className={cl("count")}>{data.rooms.length}</span>
                    </div>
                    <div className={cl("tab", tab === "mine" && "tab-active")} onClick={() => setTab("mine")}>
                        ⭐ My list <span className={cl("count")}>{watchedInVoice}/{data.watchlist.length}</span>
                    </div>
                    <div className={cl("tab", tab === "alerts" && "tab-active")} onClick={() => setTab("alerts")}>
                        🔔 Alerts <span className={cl("count")}>{notifyVoice.length + notifyOnline.length}</span>
                    </div>
                    <div className={cl("tab", tab === "runaway" && "tab-active")} onClick={() => setTab("runaway")}>
                        🏃 Run away <span className={cl("count")}>{blacklist.length}</span>
                    </div>
                    <div className={cl("tab", tab === "guards" && "tab-active")} onClick={() => setTab("guards")}>
                        🛡️ Personal Guards <span className={cl("count")}>{settings.store.personalGuards.filter(grant => grant.actions.length).length}</span>
                    </div>
                    <div className={cl("tab", tab === "log" && "tab-active")} onClick={() => setTab("log")}>
                        📜 Log <span className={cl("count")}>{log.length}</span>
                    </div>
                </div>
                <div className={cl("page-sub")}>{friendsInVoice} friend{friendsInVoice === 1 ? "" : "s"} in voice</div>
                <div className={cl("close")} onClick={() => setPageOpen(false)} title="Close (Esc)">✕</div>
            </div>
            <div className={cl("page-body")} ref={bodyRef}>
                {focus && <Spotlight id={focus} data={data} />}
                {tab === "voice" && <VoiceTab data={data} />}
                {tab === "mine" && <MyListTab data={data} />}
                {tab === "alerts" && <AlertsTab data={data} />}
                {tab === "runaway" && <RunAwayTab data={data} />}
                {tab === "guards" && <PersonalGuardsTab store={settings.store} refresh={refreshGuards} />}
                {tab === "log" && <LogTab />}
                <div className={cl("note")}>
                    Discord only shares voice activity and online status for servers you're also in, so people in servers you haven't joined won't show up.
                    {" · "}v{VERSION}{" · "}
                    <span className={cl("link")} onClick={() => checkForUpdate(true)}>Check for updates</span>
                    {" · "}
                    <span className={cl("link")} title="Restart Discord without Vencord; a desktop shortcut turns it back on" onClick={toggleVencord}>Toggle Vencord</span>
                    {" · "}
                    <span className={cl("link")} title="Source code, releases and issues" onClick={() => VencordNative.native.openExternal(REPO_URL)}>GitHub</span>
                    {" · "}
                    <span className={cl("link")} title="Like the plugin? Support it on PayPal" onClick={() => VencordNative.native.openExternal(DONATE_URL)}>❤️ Donate</span>
                </div>
            </div>
        </div>
    );
}

// ---------- server list button ----------

const HEADSET_PATH = "M12 2a10 10 0 0 0-10 10v5a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H4.06A8 8 0 0 1 19.94 12H18a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-5A10 10 0 0 0 12 2Z";

/** how long Shift + F12 shows the hidden button */
const PEEK_MS = 5000;
let peekUntil = 0;
let peekTimer: ReturnType<typeof setTimeout> | undefined;
const peekListeners = new Set<() => void>();

// Shift + F12 opens (or closes) the page and shows the hidden button for 5 seconds.
// Alerts and guards keep working while the button is hidden.
function onToggleButtonKey(event: KeyboardEvent) {
    if (event.key !== "F12" || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    setPageOpen(!pageOpen);
    peekUntil = Date.now() + PEEK_MS;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => peekListeners.forEach(listener => listener()), PEEK_MS + 50);
    peekListeners.forEach(listener => listener());
}

function useButtonVisible() {
    const { alwaysHideButton } = settings.use(["alwaysHideButton"]);
    const [, rerender] = useReducer((x: number) => x + 1, 0);
    useEffect(() => { peekListeners.add(rerender); return () => { peekListeners.delete(rerender); }; }, []);
    return !alwaysHideButton || Date.now() < peekUntil;
}

function ServerListButton() {
    const open = usePageOpen();

    const { hidden } = settings.use(["hidden"]);
    const visible = useButtonVisible();
    const count = useStateFromStores([VoiceStateStore, RelationshipStore], () => {
        let n = 0;
        for (const id of RelationshipStore.getFriendIDs()) {
            if (!hidden.includes(id) && visibleVoiceChannelId(id)) n++;
        }
        return n;
    }, [hidden]);

    return (
        <>
            {visible && <Tooltip text={`Friends in Voice — ${count} friend${count === 1 ? "" : "s"} in voice`} position="right">
                {props => (
                    <div
                        {...props}
                        className={cl("server-button", open && "server-button-open")}
                        onClick={() => setPageOpen(!pageOpen)}
                        role="button"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d={HEADSET_PATH} /></svg>
                        {count > 0 && <span className={cl("badge")}>{count}</span>}
                    </div>
                )}
            </Tooltip>}
            {open && ReactDOM.createPortal(
                <ErrorBoundary><FriendsInVoicePage /></ErrorBoundary>,
                document.body
            )}
            {ReactDOM.createPortal(<ErrorBoundary><GuardNotificationHost store={settings.store} /></ErrorBoundary>, document.body)}
        </>
    );
}

// ---------- context menu ----------

type AwayKey = "stayInVoice" | "neverIdle";

const AWAY_OPTIONS: Record<AwayKey, { label: string; builtIn: string; }> = {
    stayInVoice: { label: "Stay in voice when away (up to 2 hours)", builtIn: "DisableCallIdle" },
    neverIdle: { label: "Never go idle", builtIn: "CustomIdle" },
};

const awayChanged = () => settings.store.stayInVoice !== loadedAway.stayInVoice || settings.store.neverIdle !== loadedAway.neverIdle;

function toggleAway(key: AwayKey) {
    const on = !settings.store[key];
    settings.store[key] = on;
    ContextMenuApi.closeContextMenu();

    const changed = awayChanged();
    showNotification({
        title: `${AWAY_OPTIONS[key].label}: ${on ? "ON" : "OFF"}`,
        body: changed ? "Click here to reload Discord and apply it." : "Back to how it was when Discord started; no reload needed.",
        onClick: changed ? () => location.reload() : undefined,
    });
}

function toggleAutoStatus() {
    const on = !settings.store.autoStatus;
    settings.store.autoStatus = on;
    ContextMenuApi.closeContextMenu();
    offerAutoStatus();
    const label = (value: string) => statusOptions("").find(option => option.value === value)?.label ?? value;
    showNotification({
        title: `Status suggestions: ${on ? "ON" : "OFF"}`,
        body: on
            ? `When you join or leave a call, you'll be asked about ${label(settings.store.statusInCall)} in calls and ${label(settings.store.statusOutsideCall)} otherwise. Nothing changes until you click.`
            : "No more status suggestions.",
    });
}

// options shown when you right-click yourself
export function selfMenuItems() {
    return (
        <Menu.MenuGroup>
            {(Object.keys(AWAY_OPTIONS) as AwayKey[]).map(key => {
                const { label, builtIn } = AWAY_OPTIONS[key];
                const builtInOn = isPluginEnabled(builtIn);
                return (
                    <Menu.MenuCheckboxItem
                        key={key}
                        id={`vc-fiv-${key}`}
                        label={builtInOn ? `${label} (on via ${builtIn})` : label}
                        checked={builtInOn || settings.store[key]}
                        disabled={builtInOn}
                        action={() => toggleAway(key)}
                    />
                );
            })}
            <Menu.MenuCheckboxItem
                id="vc-fiv-autoStatus"
                label="Status suggestions in calls"
                checked={settings.store.autoStatus}
                action={toggleAutoStatus}
            />
            {awayChanged() && (
                <Menu.MenuItem id="vc-fiv-reload" label="Reload Discord to apply" action={() => location.reload()} />
            )}
        </Menu.MenuGroup>
    );
}

export default definePlugin({
    name: "FriendsInVoice",
    description: "A page showing which voice rooms your friends are in and one-click join, plus My list, voice/online alerts, a Run away list and a Log of who joined, left or moved",
    authors: [{ name: "mPhpMaster", id: 0n }],
    dependencies: ["ServerListAPI", "UserSettingsAPI", "MessageAccessoriesAPI"],
    settings,

    // "Stay in voice" and "Never go idle". Same patches as Vencord's DisableCallIdle / CustomIdle plugins,
    // skipped when those are enabled so the two don't fight over the same code.
    patches: [
        {
            find: "this.idleTimeout.start(",
            predicate: () => settings.store.stayInVoice && !isPluginEnabled("DisableCallIdle"),
            replacement: {
                match: /this\.idleTimeout\.(start|stop)/g,
                replace: "$self.noop"
            }
        },
        {
            find: "handleIdleUpdate(){",
            predicate: () => settings.store.stayInVoice && !isPluginEnabled("DisableCallIdle"),
            replacement: {
                match: "handleIdleUpdate(){",
                replace: "handleIdleUpdate(){return;"
            }
        },
        {
            find: 'type:"IDLE",idle:',
            predicate: () => settings.store.neverIdle && !isPluginEnabled("CustomIdle"),
            replacement: {
                // Discord goes idle after `Date.now() - lastActivity > <timeout>`; make the timeout infinite
                match: /(?<=Date\.now\(\)-\i>)\i\.\i\|\|/,
                replace: "Infinity||"
            }
        },
    ],

    noop() { },

    contextMenus: {
        "user-context": UserContextPatch,
    },

    flux: {
        CONNECTION_OPEN() {
            startQuietPeriod();
            void loadAccount();
            onSyncAccountChange();
            void startGuardServer();
            setTimeout(() => void showWhatsNew(VERSION), 3000);
            offerAutoStatus();
        },
        CURRENT_USER_UPDATE() {
            // you changed your own name or username; the server gets the new one
            syncGuardProfile();
        },
        LOGOUT() {
            stopGuardServer();
            leaveAccount();
        },
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: { userId: string; channelId?: string | null; oldChannelId?: string | null; }[]; }) {
            onVoiceStateUpdates(voiceStates);
            // decides only whether to listen for guard commands from the Friends in Voice server; nothing goes to Discord
            updateGuardListening();
            onVoiceLogUpdates(voiceStates);
            onAutoStatusVoiceUpdates(voiceStates);
        },
        RELATIONSHIP_ADD({ relationship }: { relationship: { id: string; type: number; user?: any; }; }) {
            onRelationshipAdd(relationship);
        },
        RELATIONSHIP_REMOVE({ relationship }: { relationship: { id: string; type?: number; }; }) {
            onRelationshipRemove(relationship);
        },
        GUILD_CREATE({ guild }: { guild: { id: string; }; }) {
            onGuildUpdate(guild.id);
        },
        GUILD_UPDATE({ guild }: { guild: { id: string; }; }) {
            onGuildUpdate(guild.id);
        },
        GUILD_DELETE({ guild }: { guild: { id: string; unavailable?: boolean; }; }) {
            onGuildDelete(guild);
        },
    },

    renderButton: ErrorBoundary.wrap(ServerListButton, { noop: true }),

    start() {
        addMessageAccessory("FriendsInVoiceSmartReplies", props => {
            const { message } = props;
            if (!settings.store.smartReplies || !message?.author || message.author.bot) return null;
            if (message.author.id === UserStore.getCurrentUser()?.id) return null;
            // only messages people wrote (DEFAULT, REPLY), not system messages such as "accepted your friend request":
            // https://docs.discord.com/developers/resources/message#message-object-message-types
            if (message.type !== 0 && message.type !== 19) return null;
            if (isGuardMessage(message.content ?? "") || codeFromText(message.content ?? "")) return null;

            const channel = props.channel ?? ChannelStore.getChannel(message.channel_id);
            if (!channel?.isDM()) return null;

            return (
                <ErrorBoundary noop>
                    <SmartReplies message={message} channel={channel} />
                </ErrorBoundary>
            );
        });

        addMessageAccessory("FriendsInVoiceGuardInvite", props => {
            const { message } = props;
            const content = message?.content ?? "";
            if (!message?.author || message.author.bot || (!isGuardMessage(content) && !codeFromText(content))) return null;
            const channel = props.channel ?? ChannelStore.getChannel(message.channel_id);
            if (!channel?.isDM()) return null;
            return <ErrorBoundary noop><GuardCodeCard message={message} channel={channel} /></ErrorBoundary>;
        });

        void loadNames();
        startSync();
        loadedAway.stayInVoice = settings.store.stayInVoice;
        loadedAway.neverIdle = settings.store.neverIdle;
        if (loadedAway.stayInVoice && !isPluginEnabled("DisableCallIdle")) startStayInVoiceLimit();
        startQuietPeriod();
        seedStatuses();
        seedVoiceChannels();
        seedVoiceLog();
        startAccountData();
        installGuardCommandHandler(settings.store);
        void startGuardServer();
        PresenceStore.addChangeListener(onPresenceChange);

        addServerListElement(ServerListRenderPosition.Above, this.renderButton);
        window.addEventListener("keydown", onToggleButtonKey, true);

        // enabled while Discord is already running, so CONNECTION_OPEN won't come
        if (UserStore.getCurrentUser()) setTimeout(() => void showWhatsNew(VERSION), 3000);
        setTimeout(() => checkForUpdate(), 10_000);
        startUpdateTimer();
        offerAutoStatus();
    },

    stop() {
        stopSync();
        flushNames();
        stopStayInVoiceLimit();
        cancelAutoStatus();
        stopGuardServer();
        stopAccountData();
        flushVoiceLog();
        clearGuardRuntime();
        removeMessageAccessory("FriendsInVoiceSmartReplies");
        removeMessageAccessory("FriendsInVoiceGuardInvite");
        setPageOpen(false);
        PresenceStore.removeChangeListener(onPresenceChange);
        stopUpdateTimer();
        removeServerListElement(ServerListRenderPosition.Above, this.renderButton);
        window.removeEventListener("keydown", onToggleButtonKey, true);
        clearTimeout(peekTimer);
    },
});
