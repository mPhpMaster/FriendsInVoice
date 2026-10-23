import { pickReleases, RELEASES_URL, whatsNewAction } from "../../friendsInVoice/whatsNewNotes.ts";
import { accountStore } from "./accountStore.js";
import { add, button, element } from "./dom.js";

export const REPO_URL = "https://github.com/mPhpMaster/FriendsInVoice";
// saved in this Discord's own storage, so each Discord on the computer shows the window once
const SEEN_KEY = "whatsNewSeen";

export const openLink = url => window.open(url, "_blank", "noopener,noreferrer");

function inline(parent, parts) {
    for (const part of parts) {
        let node = part.code ? element("code", "", part.text) : document.createTextNode(part.text);
        if (part.bold) { const strong = element("strong"); strong.append(node); node = strong; }
        if (part.href) {
            const link = element("a", "fivbd-link");
            link.href = part.href;
            link.addEventListener("click", event => { event.preventDefault(); openLink(part.href); });
            link.append(node);
            node = link;
        }
        parent.append(node);
    }
    return parent;
}

export function renderRelease(release) {
    const section = element("section", "fivbd-whats-new-release");
    const title = element("h3", "", `v${release.version} `);
    title.append(button("View on GitHub", () => openLink(release.url)));
    section.append(title);
    let list = null;
    for (const block of release.blocks) {
        if (block.type === "item") {
            list ??= section.appendChild(element("ul"));
            list.append(inline(element("li"), block.parts));
            continue;
        }
        list = null;
        section.append(inline(element(block.type === "heading" ? "h4" : "p"), block.parts));
    }
    return section;
}

/** after an update, shows the release notes once */
export class WhatsNew {
    constructor(api, data, version, meta = accountStore("meta")) {
        this.api = api;
        this.data = data;
        this.version = version;
        this.meta = meta;
        this.checked = false;
        this.shade = null;
        this.onKey = event => { if (event.key === "Escape") this.close(); };
    }
    async check() {
        if (this.checked) return;
        this.checked = true;
        try {
            const seen = await this.meta.get(SEEN_KEY) ?? null;
            const usedBefore = !!this.data.owner || this.data.value.watchlist.length > 0;
            const action = whatsNewAction(seen, this.version, usedBefore);
            if (action === "nothing") return;
            if (action === "show" && this.data.value.showWhatsNew) {
                const response = await this.api.Net.fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } });
                if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
                const releases = pickReleases(await response.json(), seen, this.version);
                // not published yet (or offline): try again next time Discord starts
                if (!releases.length) return;
                this.open(releases);
            }
            await this.meta.put(SEEN_KEY, this.version);
        } catch (error) {
            this.checked = false;
            this.api.Logger.error("What's new failed", error);
        }
    }
    open(releases) {
        this.close();
        this.shade = element("div", "fivbd-shade");
        this.shade.addEventListener("click", event => { if (event.target === this.shade) this.close(); });
        const panel = element("section", "fivbd-panel fivbd-whats-new");
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "What's new in Friends In Voice");
        const head = element("header", "fivbd-head");
        add(head, element("h2", "", `Friends In Voice updated to v${releases[0].version}`), button("✕", () => this.close()));
        const body = element("main", "fivbd-body");
        for (const release of releases) body.append(renderRelease(release));
        const foot = element("footer", "fivbd-foot");
        add(foot, button("Open GitHub", () => openLink(REPO_URL)), button("Got it", () => this.close(), "active"));
        add(panel, head, body, foot);
        this.shade.append(panel);
        document.body.append(this.shade);
        document.addEventListener("keydown", this.onKey);
    }
    close() {
        this.shade?.remove();
        this.shade = null;
        document.removeEventListener("keydown", this.onKey);
    }
}
