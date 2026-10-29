import { GUARD_ACTIONS, GUARD_LABELS } from "../../friendsInVoice/personalGuardsProtocol.ts";

import { add, button, element, heading, paragraph } from "./dom.js";

function identity(id, view) {
    const user = view.bridge.user(id);
    const label = `${view.bridge.name(id)}${user ? ` · @${user.username}` : ""} · ${id}`;
    return button(label, () => {
        try { view.bridge.openProfile(id); } catch (error) { view.error(error); }
    });
}

function ownerCard(id, view) {
    const { data, guards } = view;
    const actions = guards.grantFor(id);
    const card = element("section", "fivbd-card");
    add(card, identity(id, view), paragraph("Choose their allowed actions, then send one invitation. They choose Accept or Refuse."));
    const options = element("div", "fivbd-guard-options");
    for (const action of GUARD_ACTIONS) {
        const label = element("label");
        const checkbox = element("input");
        checkbox.type = "checkbox";
        checkbox.checked = actions.includes(action);
        checkbox.addEventListener("change", () => {
            const next = checkbox.checked ? [...actions, action] : actions.filter(item => item !== action);
            data.grant(id, next);
            view.render();
        });
        add(label, checkbox, element("span", "", GUARD_LABELS[action]));
        options.append(label);
    }
    card.append(options);
    const controls = element("div", "fivbd-actions");
    const prepare = button("Invite guardian", () => { view.close(); void guards.invite(id); });
    prepare.disabled = !actions.length;
    add(controls, prepare, button("Revoke and remove", () => { guards.revoke(id); view.render(); }, "danger"));
    card.append(controls);
    return card;
}

function accessCard(id, view) {
    const card = element("section", "fivbd-card");
    const together = view.bridge.sharesVoice(id);
    add(card, identity(id, view), paragraph(together ? "Choose one action, then press Send in the prepared DM." : "Join the same voice channel to use guard actions."));
    const controls = element("div", "fivbd-actions");
    for (const action of view.guards.knownFor(id)) {
        const item = button(GUARD_LABELS[action], () => { view.close(); void view.guards.sendCommand(id, action); });
        item.disabled = !together || !view.guards.keyFor(id);
        controls.append(item);
    }
    controls.append(button("Remove access", () => void view.guards.removeAccess(id), "danger"));
    card.append(controls);
    return card;
}

export function renderGuardsTab(parent, view) {
    add(parent, heading("Personal Guards", 2),
        paragraph("Right-click a person in Discord → Personal Guards → Add as Guardian. Choose exactly which actions they may use on your account."),
        paragraph("Send one invitation. They accept or refuse it here. Accepted access follows their Discord account on devices with this plugin. Each voice action is one encrypted DM you send manually."));
    const search = element("input", "fivbd-search");
    search.type = "search";
    search.placeholder = "Search guardians and access…";
    const contents = element("div");
    function update() {
        contents.replaceChildren();
        const query = search.value.trim().toLowerCase();
        const match = id => `${view.bridge.name(id)} ${view.bridge.user(id)?.username ?? ""} ${id}`.toLowerCase().includes(query);
        const pending = view.data.value.pendingGuardInvites.filter(invite => match(invite.userId));
        if (pending.length) contents.append(heading("Invitations"));
        for (const invite of pending) {
            const card = element("section", "fivbd-card");
            add(card, identity(invite.userId, view), paragraph(invite.actions.map(action => GUARD_LABELS[action]).join(" · ")),
                button("Accept", () => void view.guards.decide(invite, true)),
                button("Refuse", () => void view.guards.decide(invite, false), "danger"));
            contents.append(card);
        }
        add(contents, heading("People who guard me"));
        const owners = element("div", "fivbd-grid");
        for (const item of view.data.value.personalGuards.filter(item => match(item.userId))) owners.append(ownerCard(item.userId, view));
        contents.append(owners);
        if (!view.data.value.personalGuards.length) contents.append(paragraph("No guardians yet. Add someone from their Discord right-click menu.", "fivbd-empty"));
        contents.append(heading("Access others gave you"));
        const access = element("div", "fivbd-grid");
        for (const item of view.data.value.knownGuardGrants.filter(item => match(item.userId))) access.append(accessCard(item.userId, view));
        contents.append(access);
        if (!view.data.value.knownGuardGrants.length) contents.append(paragraph("No accepted access yet. Accept an invitation from its notice or the Invitations list above.", "fivbd-empty"));
    }
    search.addEventListener("input", update);
    add(parent, search, contents);
    update();
}
