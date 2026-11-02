import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { brokenPlugins, directBuildArgs, pnpmVersion, vencordDirFromAsar } from "../repair.mjs";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

test("repair finds plugins named in a failed build, but not FriendsInVoice", () => {
    const output = [
        "✘ [ERROR] No matching export in \"src/webpack/common/index.ts\" for import \"Button\"",
        "    src/userplugins/prayerTimesBreak/citySearch.tsx:11:9:",
        "src\\userplugins\\otherPlugin\\index.ts:3:1: ERROR",
        "src/userplugins/friendsInVoice/index.tsx:1:1: ERROR"
    ].join("\n");
    assert.deepEqual(brokenPlugins(output), ["prayerTimesBreak", "otherPlugin"]);
    assert.deepEqual(brokenPlugins("Error: Cannot find module 'C:\\Users\\x\\AppData\\Local\\node\\corepack\\v1\\pnpm\\12.15.0\\bin\\pnpm.cjs'"), []);
});

test("repair reads pnpm's version, the build command and the patched Vencord folder", () => {
    assert.equal(pnpmVersion("pnpm@12.15.0+sha512.abc"), "12.15.0");
    assert.equal(pnpmVersion(undefined), "latest");
    assert.deepEqual(directBuildArgs("node --require=./scripts/suppressExperimentalWarnings.js scripts/build/build.mjs"),
        ["--require=./scripts/suppressExperimentalWarnings.js", "scripts/build/build.mjs"]);
    assert.equal(directBuildArgs("node a.mjs && rm -rf x"), null);
    assert.equal(vencordDirFromAsar('require("D:\\\\Discord Tools\\\\Vencord\\\\dist\\\\patcher.js")', "win32"), "D:\\Discord Tools\\Vencord");
    assert.equal(vencordDirFromAsar('require("/home/me/Vencord source/dist/patcher.js")', "linux"), "/home/me/Vencord source");
    assert.equal(vencordDirFromAsar('require("./app.js")', "darwin"), null);
});

test("repair installs a fresh plugin, repairs dependencies and moves a plugin that breaks the build aside", { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "fiv-repair-"));
    try {
        const bundle = join(root, "bundle"), vencord = join(root, "Vencord"), mock = join(root, "bin"), home = join(root, "home");
        const plugins = join(vencord, "src", "userplugins");
        for (const dir of [join(bundle, "friendsInVoice"), join(plugins, "friendsInVoice"), join(plugins, "brokenPlugin"), join(vencord, "scripts"), mock, home])
            await mkdir(dir, { recursive: true });
        await copyFile(join(repo, "repair.mjs"), join(bundle, "repair.mjs"));
        await writeFile(join(bundle, "friendsInVoice", "index.tsx"), "export const fresh = true;\n");
        await writeFile(join(plugins, "friendsInVoice", "obsolete.ts"), "old\n");
        await writeFile(join(plugins, "brokenPlugin", "index.tsx"), "broken\n");
        await writeFile(join(vencord, "package.json"), JSON.stringify({ name: "vencord", packageManager: "pnpm@12.15.0", scripts: { build: "node build.mjs" } }));
        // fails while brokenPlugin is still in src/userplugins, like esbuild does
        await writeFile(join(vencord, "build.mjs"), `import { existsSync } from "node:fs";
if (existsSync("src/userplugins/brokenPlugin")) { console.error("src/userplugins/brokenPlugin/index.tsx:1:1: ERROR: No matching export"); process.exit(1); }
console.log("built");\n`);
        await writeFile(join(vencord, "scripts", "runInstaller.mjs"), "");
        for (const [name, body] of Object.entries({ pnpm: 'echo "pnpm $*" >> "$HOME/pnpm.log"; exit 0', pkill: "exit 0" })) {
            await writeFile(join(mock, name), `#!/bin/sh\n${body}\n`);
            await chmod(join(mock, name), 0o755);
        }
        const result = spawnSync(process.execPath, [join(bundle, "repair.mjs"), "--vencord-dir", vencord, "--yes"], {
            env: { ...process.env, HOME: home, PATH: `${mock}:${process.env.PATH}` }, encoding: "utf8", timeout: 30_000
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /brokenPlugin/);
        assert.match(result.stdout, /built/);
        assert.deepEqual(await readdir(join(plugins, "friendsInVoice")), ["index.tsx"]);
        assert.deepEqual(await readdir(plugins), ["friendsInVoice"]);
        assert.deepEqual(await readdir(join(vencord, "userplugins-disabled")), ["brokenPlugin"]);
    } finally { await rm(root, { recursive: true, force: true }); }
});
