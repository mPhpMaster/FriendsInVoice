import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const unix = process.platform === "darwin" || process.platform === "linux";

for (const os of ["Darwin", "Linux"]) {
    for (const failed of [false, true]) test(`${os} installer ${failed ? "restores previous source after build failure" : "replaces old source without stale modules"}`, { skip: !unix }, async () => {
        const root = await mkdtemp(join(tmpdir(), "fiv-installer-"));
        try {
            const bundle = join(root, "Friends In Voice"), home = join(root, "home"), mock = join(root, "bin");
            const vencord = join(home, "Vencord source"), installed = join(vencord, "src", "userplugins", "friendsInVoice");
            const resources = os === "Darwin" ? join(home, "Applications", "Discord.app", "Contents", "Resources") : join(home, ".local", "share", "discord", "resources");
            for (const path of [join(bundle, "friendsInVoice"), installed, resources, mock, join(vencord, "dist"), join(vencord, "node_modules")]) await mkdir(path, { recursive: true });
            await copyFile(join(repo, "install.sh"), join(bundle, "install.sh"));
            await writeFile(join(bundle, "friendsInVoice", "index.tsx"), "export const current = true;\n");
            await writeFile(join(installed, "obsolete.ts"), "export const old = true;\n");
            await writeFile(join(vencord, "package.json"), '{"name":"vencord"}');
            await writeFile(join(vencord, "dist", "patcher.js"), "");
            await writeFile(join(resources, "app.asar"), `require(${JSON.stringify(join(vencord, "dist", "patcher.js"))});`);
            const scripts = { uname: `printf '%s\\n' '${os}'`, pnpm: `exit ${failed ? 1 : 0}`,
                osascript: "exit 0", open: "exit 0", pkill: "exit 0", pgrep: "exit 1", sleep: "exit 0", nohup: "exit 0" };
            for (const [name, body] of Object.entries(scripts)) {
                const path = join(mock, name);
                await writeFile(path, `#!/bin/sh\n${body}\n`);
                await chmod(path, 0o755);
            }
            const env = { ...process.env, HOME: home, PATH: `${mock}:${process.env.PATH}` };
            const detect = spawnSync("/bin/bash", [join(bundle, "install.sh"), "--detect-only", "--vencord-dir", vencord], { env, encoding: "utf8", timeout: 20_000 });
            assert.equal(detect.status, 0, detect.stdout + detect.stderr);
            assert.match(detect.stdout, /installed: yes/);
            assert.equal(await readFile(join(installed, "obsolete.ts"), "utf8"), "export const old = true;\n");
            const update = spawnSync("/bin/bash", [join(bundle, "install.sh"), "--vencord-dir", vencord], { env, encoding: "utf8", timeout: 20_000 });
            assert.equal(update.status === 0, !failed, update.stdout + update.stderr);
            assert.deepEqual(await readdir(installed), [failed ? "obsolete.ts" : "index.tsx"]);
            const work = (await readdir(vencord)).find(name => name.startsWith(".friends-in-voice-install."));
            assert.ok(work);
            if (!failed) assert.equal(await readFile(join(vencord, work, "previous", "obsolete.ts"), "utf8"), "export const old = true;\n");
        } finally { await rm(root, { recursive: true, force: true }); }
    });
}
