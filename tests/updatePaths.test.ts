import assert from "node:assert/strict";
import { test } from "node:test";

import { vencordRootFromArchive } from "../friendsInVoice/updatePaths";

test("updater locates source from Windows, macOS and Linux archive paths with spaces", () => {
    for (const [platform, patcher, root] of [
        ["win32", "D:\\Discord Tools\\Vencord\\dist\\patcher.js", "D:\\Discord Tools\\Vencord"],
        ["darwin", "/Users/Friend Name/Vencord/dist/patcher.js", "/Users/Friend Name/Vencord"],
        ["linux", "/home/friend/Vencord source/dist/patcher.js", "/home/friend/Vencord source"]
    ] as const) assert.deepEqual(vencordRootFromArchive(`require(${JSON.stringify(patcher)});`, platform), { patcher, root });
});

test("updater rejects unpatched archives, relative paths and malformed Windows escapes", () => {
    assert.throws(() => vencordRootFromArchive('require("./app.js");', "darwin"));
    assert.throws(() => vencordRootFromArchive('require("relative\\\\dist\\\\patcher.js");', "win32"), /invalid/);
    assert.throws(() => vencordRootFromArchive('require("C:\\invalid\\\\dist\\\\patcher.js");', "win32"));
});
