import { add, button, element } from "./dom.js";
import { STYLE } from "./style.js";
import { renderGuardsTab } from "./viewGuards.js";
import { renderListTab } from "./viewLists.js";
import { renderLogTab } from "./viewLog.js";
import { renderRepliesTab } from "./viewReplies.js";
import { renderVoiceTab } from "./viewVoice.js";
import { openLink, REPO_URL } from "./whatsNew.js";

const TABS = [
    ["voice", "In Voice"], ["mine", "My List"], ["alerts", "Alerts"],
    ["runaway", "Run Away"], ["guards", "Personal Guards"], ["replies", "Smart replies"], ["log", "Log"]
];

export class Dashboard {
    constructor(api, bridge, data, version) {
        this.api = api;
        this.bridge = bridge;
        this.data = data;
        this.version = version;
        this.tab = "voice";
        this.shade = null;
        this.onKey = event => { if (event.key === "Escape") this.close(); };
    }
    start() {
        this.api.DOM.addStyle(STYLE);
        this.launcher = button("🔊 Friends In Voice", () => this.open(), "fivbd-launch");
        document.body.append(this.launcher);
        document.addEventListener("keydown", this.onKey);
    }
    stop() {
        this.close();
        this.launcher?.remove();
        document.removeEventListener("keydown", this.onKey);
        this.api.DOM.removeStyle();
    }
    error(error) {
        this.api.UI.showToast(error instanceof Error ? error.message : String(error), { type: "error" });
    }
    open(tab = this.tab) {
        this.tab = TABS.some(item => item[0] === tab) ? tab : "voice";
        if (!this.shade) {
            this.shade = element("div", "fivbd-shade");
            this.shade.addEventListener("click", event => { if (event.target === this.shade) this.close(); });
            document.body.append(this.shade);
        }
        this.render();
    }
    close() { this.shade?.remove(); this.shade = null; }
    refresh() {
        if (!this.shade || ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
        this.render();
    }
    render() {
        if (!this.shade) return;
        const oldBody = this.shade.querySelector(".fivbd-body");
        const scroll = oldBody?.scrollTop ?? 0;
        const panel = element("section", "fivbd-panel");
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Friends In Voice");
        const head = element("header", "fivbd-head");
        add(head, element("h2", "", "Friends In Voice"), button("✕", () => this.close()));
        const tabs = element("nav", "fivbd-tabs");
        for (const [id, title] of TABS) {
            const item = button(title, () => this.open(id), id === this.tab ? "active" : "");
            item.setAttribute("aria-current", id === this.tab ? "page" : "false");
            tabs.append(item);
        }
        const body = element("main", "fivbd-body");
        try {
            if (this.tab === "voice") renderVoiceTab(body, this);
            else if (["mine", "alerts", "runaway"].includes(this.tab)) renderListTab(body, this, this.tab);
            else if (this.tab === "guards") renderGuardsTab(body, this);
            else if (this.tab === "log") renderLogTab(body, this);
            else renderRepliesTab(body, this);
        } catch (error) { body.textContent = `This panel could not load: ${String(error)}`; }
        const foot = element("footer", "fivbd-foot");
        const links = element("span", "fivbd-foot-links");
        add(links, button("GitHub", () => openLink(REPO_URL)), button("Check for updates", () => void this.alerts?.checkUpdate(true)));
        add(foot, element("span", "", `BetterDiscord · v${this.version}`), links);
        add(panel, head, tabs, body, foot);
        this.shade.replaceChildren(panel);
        body.scrollTop = scroll;
    }
}
