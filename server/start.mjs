import { fileURLToPath } from "node:url";

import { createAdmin } from "./admin.mjs";
import { createApp, createStats, GuardStore } from "./server.mjs";
import { createSite } from "./site.mjs";

const port = Number(process.env.PORT ?? 3077);
const host = process.env.HOST ?? "127.0.0.1";
const version = process.env.FIV_VERSION ?? "1";
const dataFile = process.env.DATA_FILE ?? fileURLToPath(new URL("./data/guards.json", import.meta.url));
const store = new GuardStore(dataFile);
const stats = createStats();
// the dashboard at /admin stays off until ADMIN_PASSWORD_HASH is set (node hash-password.mjs)
const admin = createAdmin({ store, passwordHash: process.env.ADMIN_PASSWORD_HASH, version, dataFile, stats });
const server = createApp({ store, version, admin, site: createSite(), stats });
server.listen(port, host, () => console.log(`FriendsInVoice guard server on http://${host}:${port}`));

function stop() {
    store.flush();
    process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
