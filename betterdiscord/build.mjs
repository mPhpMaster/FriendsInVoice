import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const version = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8")).version;
const header = `/**
 * @name FriendsInVoice
 * @author mPhpMaster
 * @description Voice rooms, friend alerts, encrypted Personal Guards, and smart DM replies for BetterDiscord.
 * @version ${version}
 * @website https://github.com/mPhpMaster/FriendsInVoice
 * @source https://github.com/mPhpMaster/FriendsInVoice
 */\n`;
const output = resolve(root, "FriendsInVoice.plugin.js");
const result = await build({
    entryPoints: [resolve(root, "src", "index.cjs")],
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "chrome120",
    write: false,
    // BetterDiscord plugins must not be minified: https://docs.betterdiscord.app/plugins/publishing/guidelines
    minify: false,
    logLevel: "info"
});
await writeFile(output, header + result.outputFiles[0].text);
console.log(output);
