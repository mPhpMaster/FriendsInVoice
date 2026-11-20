import { formatCode } from "../../friendsInVoice/guardServer.ts";
import { GUARD_ACTIONS, GUARD_LABELS } from "../../friendsInVoice/personalGuardsProtocol.ts";

import { add, button, element, heading, paragraph } from "./dom.js";

function identity(id, view) {
    const user = view.bridge.user(id);
    const label = `${view.bridge.name(id)}${user ? ` · @${user.username}` : ""} · ${id}`;
    return button(label, () => {
        try { view.bridge.openProfile(id); } catch (error) { view.error(error); }
    });
}

function codeBox(view, id, code, expiresAt) {
    const box = element("div", "fivbd-card");
    const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
    add(box, paragraph(`Invite code for ${view.bridge.name(id)}: ${formatCode(code)}`),
        paragraph(`It works once, only for their account, for ${minutes} minutes. They enter it in their Personal Guards tab.`));
    const controls = element("div", "fivbd-actions");
    add(controls,
        button("Copy code", () => { void navigator.clipboard?.writeText(formatCode(code)); view.api?.UI?.showToast?.("Code copied", { type: "info" }); }),
        button("Put it in their DM", () => { view.close(); void view.guards.draftCode(id, code); }));
    box.append(controls);
    return box;
}

function ownerCard(id, view) {
    const { data, guards } = view;
    const grant = data.value.personalGuards.find(item => item.userId === id);
    const actions = guards.grantFor(id);
    const open = grant?.code && grant.codeExpiresAt > Date.now();
    const card = element("section", "fivbd-card");
    add(card, identity(id, view), paragraph(grant?.pairId
        ? "Active. They can use the checked actions while you're both in the same voice channel."
        : open ? "Waiting for them to enter the code." : "Choose their allowed actions, then get an invite code and give it to them."));
    const options = element("div", "fivbd-guard-options");
    for (const action of GUARD_ACTIONS) {
        const label = element("label");
        const checkbox = element("input");
        checkbox.type = "checkbox";
        checkbox.checked = actions.includes(action);
        checkbox.addEventListener("change", () => {
            const next = checkbox.checked ? [...actions, action] : actions.filter(item => item !== action);
            guards.setGrant(id, next);
            view.render();
        });
        add(label, checkbox, element("span", "", GUARD_LABELS[action]));
        options.append(label);
    }
    card.append(options);
    if (open) card.append(codeBox(view, id, grant.code, grant.codeExpiresAt));
    const controls = element("div", "fivbd-actions");
    if (!grant?.pairId) {
        const prepare = button(open ? "New invite code" : "Get invite code", async () => { await guards.invite(id); view.render(); });
        prepare.disabled = !actions.length;
        controls.append(prepare);
    }
    controls.append(button("Revoke and remove", () => { guards.revoke(id); view.render(); }, "danger"));
    card.append(controls);
    return card;
}

function accessCard(id, view) {
    const card = element("section", "fivbd-card");
    const together = view.bridge.sharesVoice(id);
    const actions = view.guards.knownFor(id);
    add(card, identity(id, view), paragraph(!actions.length
        ? "This access came from an old DM invite and no longer works. Ask them for an invite code."
        : together ? "Choose one action. It applies right away." : "Join the same voice channel to use guard actions."));
    const controls = element("div", "fivbd-actions");
    for (const action of actions) {
        const item = button(GUARD_LABELS[action], () => void view.guards.sendCommand(id, action));
        item.disabled = !together || !view.guards.keyFor(id);
        controls.append(item);
    }
    controls.append(button("Remove access", async () => { await view.guards.removeAccess(id); view.render(); }, "danger"));
    card.append(controls);
    return card;
}

function codeEntry(view) {
    const wrap = element("div", "fivbd-actions");
    const input = element("input", "fivbd-search");
    input.placeholder = "Enter a guard code, like ABCD-2345";
    input.maxLength = 12;
    const result = element("div");
    const use = button("Use code", async () => {
        const offer = await view.guards.lookup(input.value);
        result.replaceChildren();
        if (!offer) return;
        const card = element("section", "fivbd-card");
        add(card, paragraph(`Become ${view.bridge.name(offer.ownerId)}'s Personal Guard?`),
            paragraph(`While you're both in the same voice channel you'll be able to: ${offer.actions.map(action => GUARD_LABELS[action]).join(" · ")}`),
            button("Accept", async () => { if (await view.guards.decide(offer.code, true)) { input.value = ""; view.render(); } }),
            button("Refuse", async () => { if (await view.guards.decide(offer.code, false)) { input.value = ""; result.replaceChildren(); } }, "danger"));
        result.append(card);
    });
    add(wrap, input, use);
    const box = element("div");
    add(box, wrap, result);
    return box;
}

export function renderGuardsTab(parent, view) {
    add(parent, heading("Personal Guards", 2),
        paragraph("Right-click a person in Discord → Personal Guards → Add as Guardian. Choose exactly which actions they may use on your account, then give them the invite code."),
        paragraph("Pairing and commands go through the Friends in Voice server, end-to-end encrypted, and never through Discord messages. Your private key stays on this device."));
    add(parent, heading("Enter an invite code"), codeEntry(view));
    const search = element("input", "fivbd-search");
    search.type = "search";
    search.placeholder = "Search guardians and access…";
    const contents = element("div");
    function update() {
        contents.replaceChildren();
        const query = search.value.trim().toLowerCase();
        const match = id => `${view.bridge.name(id)} ${view.bridge.user(id)?.username ?? ""} ${id}`.toLowerCase().includes(query);
        add(contents, heading("People who guard me"));
        const owners = element("div", "fivbd-grid");
        for (const item of view.data.value.personalGuards.filter(item => match(item.userId))) owners.append(ownerCard(item.userId, view));
        contents.append(owners);
        if (!view.data.value.personalGuards.length) contents.append(paragraph("No guardians yet. Add someone from their Discord right-click menu.", "fivbd-empty"));
        contents.append(heading("Access others gave you"));
        const access = element("div", "fivbd-grid");
        for (const item of view.data.value.knownGuardGrants.filter(item => match(item.userId))) access.append(accessCard(item.userId, view));
        contents.append(access);
        if (!view.data.value.knownGuardGrants.length) contents.append(paragraph("No access yet. When someone gives you an invite code, enter it above.", "fivbd-empty"));
    }
    search.addEventListener("input", update);
    add(parent, search, contents);
    update();
}
