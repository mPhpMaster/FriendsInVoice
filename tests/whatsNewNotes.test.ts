import assert from "node:assert/strict";
import { test } from "node:test";

import { parseInline, parseNotes, pickReleases, whatsNewAction } from "../friendsInVoice/whatsNewNotes";

const NOTES = `## What's new

**📜 Log tab** ([#4](https://github.com/mPhpMaster/FriendsInVoice/pull/4))
- A history of who joined, tagged **YOUR ROOM**.
- Run \`install.bat\`, see [docs](javascript:alert(1)).

Everything is in the BetterDiscord version too.

## Update

Vencord: click the notification.

## Verification

All tests passed.
`;

const release = (version: string, body = NOTES, extra = {}) => ({ tag_name: `v${version}`, body, html_url: `https://example.test/v${version}`, ...extra });

test("notes keep what's new and drop the update and verification sections", () => {
    const blocks = parseNotes(NOTES);
    assert.deepEqual(blocks.map(block => block.type), ["text", "item", "item", "text"]);
    assert.ok(!JSON.stringify(blocks).includes("Vencord: click"));
    assert.ok(!JSON.stringify(blocks).includes("All tests passed"));
    assert.deepEqual(blocks[0].parts[0], { text: "📜 Log tab", bold: true });
    assert.deepEqual(blocks[0].parts[2], { text: "#4", href: "https://github.com/mPhpMaster/FriendsInVoice/pull/4" });
});

test("only https links become links, and code and bold are kept", () => {
    const parts = parseInline("Run `install.bat`, see [docs](javascript:alert(1)) and **bold [x](https://a.test)**");
    assert.deepEqual(parts[1], { text: "install.bat", code: true });
    assert.ok(parts.every(part => !part.href || part.href.startsWith("https://")));
    assert.deepEqual(parts.at(-1), { text: "x", href: "https://a.test", bold: true });
});

test("shows every release since the last one seen, newest first", () => {
    const releases = [release("1.16.0"), release("1.15.0"), release("1.14.0"), release("1.13.0"), release("1.17.0")];
    assert.deepEqual(pickReleases(releases, "1.13.0", "1.16.0").map(item => item.version), ["1.16.0", "1.15.0", "1.14.0"]);
    assert.deepEqual(pickReleases(releases, null, "1.16.0").map(item => item.version), ["1.16.0"]);
});

test("skips drafts, pre-releases, empty notes and missing releases", () => {
    const releases = [release("1.16.0", NOTES, { draft: true }), release("1.15.0", NOTES, { prerelease: true }), release("1.14.0", "")];
    assert.deepEqual(pickReleases(releases, "1.13.0", "1.16.0"), []);
});

test("shows after an update, never on a new install or twice", () => {
    assert.equal(whatsNewAction("1.14.0", "1.15.0", true), "show");
    assert.equal(whatsNewAction(null, "1.15.0", true), "show");
    assert.equal(whatsNewAction(null, "1.15.0", false), "remember");
    assert.equal(whatsNewAction("1.15.0", "1.15.0", true), "nothing");
    assert.equal(whatsNewAction("1.16.0", "1.15.0", true), "remember");
});
