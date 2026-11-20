import { add, button, element, heading, paragraph } from "./dom.js";

const TAB_LISTS = {
    mine: [{ key: "watchlist", title: "My List", empty: "No people saved yet." }],
    alerts: [
        { key: "notifyOnline", title: "Notify when online", empty: "No online alerts yet." },
        { key: "notifyVoice", title: "Notify when in voice", empty: "No voice alerts yet." }
    ],
    runaway: [{ key: "blacklist", title: "Run Away", empty: "No people on your Run Away list." }]
};

function renderPicker(parent, view, key) {
    const { bridge, data } = view;
    const input = element("input", "fivbd-search");
    input.type = "search";
    input.placeholder = `Add a friend to ${key === "watchlist" ? "My List" : key === "blacklist" ? "Run Away" : "alerts"}…`;
    input.setAttribute("aria-label", input.placeholder);
    const results = element("div", "fivbd-grid");
    function update() {
        results.replaceChildren();
        const query = input.value.trim().toLowerCase();
        if (!query) return;
        const ids = bridge.relationshipStore.getFriendIDs?.() ?? [];
        const matches = ids.filter(id => !data.listHas(key, id) &&
            `${bridge.name(id)} ${bridge.user(id)?.username ?? ""} ${id}`.toLowerCase().includes(query)).slice(0, 12);
        for (const id of matches) {
            const card = element("div", "fivbd-card");
            add(card, paragraph(`${bridge.name(id)} · ${bridge.user(id)?.username ?? id}`),
                button("Add", () => { data.toggleList(key, id); view.render(); }));
            results.append(card);
        }
        if (!matches.length) results.append(paragraph("No matching friends found.", "fivbd-muted"));
    }
    input.addEventListener("input", update);
    add(parent, input, results);
}

function renderSection(parent, view, definition) {
    const { bridge, data } = view;
    parent.append(heading(definition.title));
    renderPicker(parent, view, definition.key);
    const ids = data.value[definition.key];
    if (!ids.length) { parent.append(paragraph(definition.empty, "fivbd-empty")); return; }
    const grid = element("div", "fivbd-grid");
    for (const id of ids) {
        const card = element("section", "fivbd-card");
        const room = bridge.visibleVoiceChannel(id);
        const channel = room && bridge.channel(room);
        add(card, heading(bridge.name(id)), paragraph(`@${bridge.user(id)?.username ?? id} · ${bridge.status(id)}`),
            paragraph(channel ? `${bridge.roomDescription(channel).roomName} · ${bridge.roomDescription(channel).place}` : "Not in a visible voice room"));
        const actions = element("div", "fivbd-actions");
        add(actions,
            button("Open DM", () => void bridge.openDm(id).catch(error => view.error(error))),
            button("Remove", () => { data.toggleList(definition.key, id); view.render(); }, "danger"));
        card.append(actions);
        grid.append(card);
    }
    parent.append(grid);
}

export function renderListTab(parent, view, tab) {
    const definitions = TAB_LISTS[tab] ?? [];
    for (const definition of definitions) renderSection(parent, view, definition);
}
