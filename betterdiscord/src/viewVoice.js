import { add, button, element, paragraph } from "./dom.js";

export function renderVoiceTab(parent, view) {
    const input = element("input", "fivbd-search");
    input.type = "search";
    input.placeholder = "Search people, servers, or voice rooms…";
    input.setAttribute("aria-label", input.placeholder);
    const results = element("div", "fivbd-grid");
    function update() {
        results.replaceChildren();
        const query = input.value.trim().toLowerCase();
        const rooms = view.bridge.rooms(view.data.value.watchlist).filter(room =>
            !query || `${room.place} ${room.roomName} ${room.members.map(member => member.name).join(" ")}`.toLowerCase().includes(query));
        if (!rooms.length) { results.append(paragraph(query ? "Nothing matches your search." : "No friends in visible voice rooms.", "fivbd-empty")); return; }
        for (const room of rooms) {
            const card = element("section", "fivbd-card");
            add(card, element("h3", "", room.roomName), paragraph(room.place));
            for (const member of room.members) {
                const row = element("div", "fivbd-person");
                const flags = [member.mute && "muted", member.deaf && "deafened", member.stream && "streaming"].filter(Boolean).join(", ");
                add(row, element("span", "", `${member.name}${flags ? ` · ${flags}` : ""}`),
                    button(member.watched ? "★" : "☆", () => { view.data.toggleList("watchlist", member.id); update(); }));
                card.append(row);
            }
            if (view.bridge.voiceChannel(view.bridge.currentId()) !== room.channelId && view.bridge.voiceChannelActions?.selectVoiceChannel) {
                const join = button(room.blocker ?? "Join voice", () => {
                    try { view.bridge.voiceChannelActions.selectVoiceChannel(room.channelId); } catch (error) { view.error(error); }
                });
                join.disabled = !!room.blocker;
                card.append(join);
            }
            results.append(card);
        }
    }
    input.addEventListener("input", update);
    add(parent, input, results);
    update();
}
