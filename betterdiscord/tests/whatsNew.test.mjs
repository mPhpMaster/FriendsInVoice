import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { memoryStore } from "./memoryStore.mjs";

// whatsNew.js imports the Vencord plugin's TypeScript, so bundle it the way build.mjs does
const bundled = await build({ entryPoints: [new URL("../src/whatsNew.js", import.meta.url).pathname], bundle: true, format: "esm", write: false });
const { WhatsNew } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const NOTES = "## What's new\n\n**🆕 Thing** ([#9](https://github.com/mPhpMaster/FriendsInVoice/pull/9))\n- It works.\n\n## Update\n\nReplace the file.\n";

function setup({ seen, owner = "111111111111111111", showWhatsNew = true, releases = [{ tag_name: "v1.15.0", body: NOTES }] } = {}) {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    const meta = memoryStore(seen ? { whatsNewSeen: seen } : {});
    let fetches = 0;
    const api = {
        Net: { fetch: async () => { fetches++; return { ok: true, json: async () => releases }; } },
        Logger: { error() {} }
    };
    const data = { owner, value: { watchlist: [], showWhatsNew } };
    return { whatsNew: new WhatsNew(api, data, "1.15.0", meta), meta, fetches: () => fetches };
}

test("shows the new release's notes once after an update", async () => {
    const { whatsNew, meta, fetches } = setup({ seen: "1.14.0" });
    await whatsNew.check();
    const text = document.querySelector(".fivbd-whats-new").textContent;
    assert.match(text, /updated to v1\.15\.0/);
    assert.match(text, /It works\./);
    assert.doesNotMatch(text, /Replace the file/);
    assert.equal(document.querySelector(".fivbd-link").href, "https://github.com/mPhpMaster/FriendsInVoice/pull/9");
    assert.equal(meta.map.get("whatsNewSeen"), "1.15.0");
    whatsNew.close();
    whatsNew.checked = false;
    await whatsNew.check();
    assert.equal(document.querySelector(".fivbd-whats-new"), null);
    assert.equal(fetches(), 1);
});

test("a new install or the setting turned off only remembers the version", async () => {
    for (const options of [{ owner: "" }, { seen: "1.14.0", showWhatsNew: false }]) {
        const { whatsNew, meta, fetches } = setup(options);
        await whatsNew.check();
        assert.equal(document.querySelector(".fivbd-whats-new"), null);
        assert.equal(fetches(), 0);
        assert.equal(meta.map.get("whatsNewSeen"), "1.15.0");
    }
});

test("a release that isn't published yet is tried again next time", async () => {
    const { whatsNew, meta } = setup({ seen: "1.14.0", releases: [] });
    await whatsNew.check();
    assert.equal(document.querySelector(".fivbd-whats-new"), null);
    assert.equal(meta.map.get("whatsNewSeen"), "1.14.0");
});
