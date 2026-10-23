import { add, button, element, heading, paragraph } from "./dom.js";
import { openLink, REPO_URL } from "./whatsNew.js";

const SWITCHES = [
    ["notifyOnce", "Remove an online alert after it fires once"],
    ["smartReplies", "Show built-in smart replies in the dashboard"],
    ["smartRepliesAi", "Enable the optional Claude reply button"],
    ["checkForUpdates", "Check GitHub for BetterDiscord plugin releases"],
    ["showWhatsNew", "After the plugin updates, show what's new when Discord starts"],
    ["autoStatus", "Auto switch status: change your status when you join or leave a call"]
];
const STATUS_LABELS = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", invisible: "Invisible" };

export function settingsPanel(view) {
    const root = element("div", "fivbd-setting");
    add(root, heading("FriendsInVoice settings", 2),
        paragraph("BetterDiscord settings are stored separately from Vencord settings. Personal Guards needs a fresh permission exchange on this client."),
        button("Open FriendsInVoice", () => view.open("voice")));
    for (const [key, title] of SWITCHES) {
        const label = element("label");
        const input = element("input");
        input.type = "checkbox";
        input.checked = view.data.value[key];
        input.addEventListener("change", () => {
            view.data.set(key, input.checked);
            if (key === "autoStatus") view.autoStatus?.apply();
            view.render();
        });
        add(label, input, element("span", "", title));
        root.append(label);
    }
    for (const [key, title] of [
        ["statusInCall", "Auto switch status: your status while you're in a voice channel or call"],
        ["statusOutsideCall", "Auto switch status: your status when you're not in a call"]
    ]) {
        const label = element("label");
        label.style.alignItems = "flex-start";
        label.style.flexDirection = "column";
        const select = element("select");
        for (const [value, text] of Object.entries(STATUS_LABELS)) {
            const option = element("option", "", text);
            option.value = value;
            select.append(option);
        }
        select.value = view.data.value[key];
        select.addEventListener("change", () => { view.data.set(key, select.value); view.autoStatus?.apply(); });
        add(label, element("span", "", title), select);
        root.append(label);
    }
    for (const [key, title, type] of [
        ["anthropicApiKey", "Claude API key (saved on this computer)", "password"],
        ["aiModel", "Claude model", "text"]
    ]) {
        const label = element("label");
        label.style.alignItems = "flex-start";
        label.style.flexDirection = "column";
        const input = element("input");
        input.type = type;
        input.value = view.data.value[key];
        input.autocomplete = "off";
        input.addEventListener("change", () => view.data.set(key, input.value.trim()));
        add(label, element("span", "", title), input);
        root.append(label);
    }
    root.append(button("Check for updates", () => void view.alerts.checkUpdate(true)), button("Open GitHub", () => openLink(REPO_URL)));
    return root;
}
