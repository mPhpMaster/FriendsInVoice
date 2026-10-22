import { add, button, element, paragraph } from "./dom.js";

const FILTERS = [["all", "Everything"], ["friends", "Friends"], ["myroom", "My room"], ["me", "Me"]];
const ICONS = { join: "➡️", leave: "⬅️", move: "🔀" };

// Right-clicking the real item in Discord's sidebar opens Discord's own menu for it. The sidebar only has the item
// while it's on screen (a server in a closed folder, or a channel of another server, isn't), so fall back to our own menu.
function openSidebarMenu(listItemId, event) {
    const target = document.querySelector(`[data-list-item-id="${listItemId}"]`);
    if (!target) return false;
    const { clientX, clientY, screenX, screenY } = event;
    setTimeout(() => target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX, clientY, screenX, screenY })));
    return true;
}

function menu(view, event, items) {
    const open = view.api.ContextMenu?.open, build = view.api.ContextMenu?.buildMenu;
    if (open && build) open(event, build(items.filter(Boolean)));
}

function rightClick(node, handler) {
    node.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); handler(event); });
}

function copy(text) { void navigator.clipboard?.writeText(text); }

function guarded(view, run) {
    return () => { try { run(); view.close(); } catch (error) { view.error(error); } };
}

function link(text, className, title) {
    const node = element("span", `fivbd-log-link ${className}`, text);
    node.title = title;
    return node;
}

function person(view, entry) {
    const node = link(entry.isMe ? "You" : entry.userName, "fivbd-log-person", entry.isMe ? "" : "Click to message · Right-click for options");
    if (entry.isMe) return node;
    node.addEventListener("click", () => void view.bridge.openDm(entry.userId).then(() => view.close()).catch(error => view.error(error)));
    rightClick(node, event => menu(view, event, [
        { label: "Profile", action: () => { try { view.bridge.openProfile(entry.userId); } catch (error) { view.error(error); } } },
        { label: "Message", action: () => void view.bridge.openDm(entry.userId).then(() => view.close()).catch(error => view.error(error)) },
        { label: "Copy User ID", action: () => copy(entry.userId) }
    ]));
    return node;
}

function room(view, info) {
    const node = link(`🔊 ${info.roomName}`, "fivbd-log-room", "Click to open · Right-click for options");
    node.addEventListener("click", guarded(view, () => view.bridge.openChannel(info.guildId, info.id)));
    rightClick(node, event => {
        if (openSidebarMenu(`channels___${info.id}`, event)) return;
        const channel = view.bridge.channel(info.id);
        menu(view, event, [
            channel && !view.bridge.joinBlocker(channel) && view.bridge.voiceChannelActions?.selectVoiceChannel &&
                { label: "Join Voice", action: () => view.bridge.voiceChannelActions.selectVoiceChannel(info.id) },
            { label: "Open Chat", action: guarded(view, () => view.bridge.openChannel(info.guildId, info.id)) },
            info.guildId && { label: "Copy Link", action: () => copy(`https://discord.com/channels/${info.guildId}/${info.id}`) },
            { label: "Copy Channel ID", action: () => copy(info.id) }
        ]);
    });
    return node;
}

function place(view, info) {
    if (!info.guildId) return element("span", "fivbd-log-place", info.place);
    const node = link(info.place, "fivbd-log-place", "Click to open the server · Right-click for options");
    node.addEventListener("click", guarded(view, () => view.bridge.openGuild(info.guildId)));
    rightClick(node, event => {
        if (openSidebarMenu(`guildsnav___${info.guildId}`, event)) return;
        menu(view, event, [
            { label: "Open Server", action: guarded(view, () => view.bridge.openGuild(info.guildId)) },
            { label: "Copy Server ID", action: () => copy(info.guildId) }
        ]);
    });
    return node;
}

const where = (view, info) => [room(view, info), document.createTextNode(" in "), place(view, info)];

function describe(view, entry) {
    const { from, to } = entry;
    if (entry.kind === "join") return ["joined ", ...where(view, to)];
    if (entry.kind === "leave") return ["left ", ...where(view, from)];
    if (from.guildId === to.guildId) return ["moved from ", room(view, from), " to ", room(view, to), " in ", place(view, to)];
    return ["moved from ", ...where(view, from), " to ", ...where(view, to)];
}

function matches(entry, filter, query) {
    if (filter === "friends" && !entry.isFriend) return false;
    if (filter === "myroom" && !entry.myRoom) return false;
    if (filter === "me" && !entry.isMe) return false;
    return !query || [entry.userName, entry.from?.roomName, entry.from?.place, entry.to?.roomName, entry.to?.place]
        .some(text => text?.toLowerCase().includes(query));
}

export function renderLogTab(parent, view) {
    const log = view.voiceLog;
    view.logFilter ??= "all";
    const input = element("input", "fivbd-search");
    input.type = "search";
    input.placeholder = "Search people, servers, or voice rooms…";
    input.setAttribute("aria-label", input.placeholder);
    const filters = element("div", "fivbd-actions");
    for (const [id, title] of FILTERS)
        filters.append(button(title, () => { view.logFilter = id; view.render(); }, id === view.logFilter ? "active" : ""));
    if (log.entries.length) filters.append(button("Clear", () => { log.clear(); view.render(); }));
    const list = element("div", "fivbd-log");
    function update() {
        const query = input.value.trim().toLowerCase();
        const shown = log.entries.filter(entry => matches(entry, view.logFilter, query));
        list.replaceChildren();
        if (!shown.length) {
            list.append(paragraph(log.entries.length ? "Nothing matches." : "Nothing yet. Every time someone joins, leaves or moves between voice rooms in your servers, it shows up here, including people coming into and leaving your own room.", "fivbd-empty"));
            return;
        }
        for (const entry of shown) {
            const row = element("div", `fivbd-log-row${entry.myRoom ? " fivbd-log-myroom" : ""}`);
            const time = element("span", "fivbd-muted", new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
            time.title = new Date(entry.time).toLocaleString();
            add(row, time, element("span", "", ICONS[entry.kind]), person(view, entry));
            const what = element("span", "fivbd-log-what");
            what.append(" ", ...describe(view, entry));
            row.append(what);
            if (entry.myRoom) row.append(element("span", "fivbd-log-pill", "YOUR ROOM"));
            if (entry.isFriend && !entry.isMe) row.append(element("span", "fivbd-log-pill", "FRIEND"));
            list.append(row);
        }
    }
    input.addEventListener("input", update);
    add(parent, input, filters, list, paragraph("Click a person to message them, a room to open it, or a server to go to it. Right-click any of them for options. The log keeps the last 500 events until you restart Discord.", "fivbd-muted"));
    update();
}
