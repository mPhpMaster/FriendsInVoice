import { fileURLToPath } from "node:url";

import { createApp, GuardStore } from "./server.mjs";

const port = Number(process.env.PORT ?? 3077);
const host = process.env.HOST ?? "127.0.0.1";
const store = new GuardStore(process.env.DATA_FILE ?? fileURLToPath(new URL("./data/guards.json", import.meta.url)));
const server = createApp({ store, version: process.env.FIV_VERSION ?? "1" });
server.listen(port, host, () => console.log(`FriendsInVoice guard server on http://${host}:${port}`));

function stop() {
    store.flush();
    process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
