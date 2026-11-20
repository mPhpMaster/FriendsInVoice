import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createApp, GuardStore } from "../server.mjs";
import { createSite } from "../site.mjs";

let server, base;
before(async () => {
    server = createApp({ store: new GuardStore(null), site: createSite() });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

test("the install page and installers are served", async () => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /install\.ps1/);
    const bat = await fetch(`${base}/FriendsInVoice-Installer.bat`);
    assert.match(bat.headers.get("content-disposition"), /attachment/);
    assert.match(await bat.text(), /\r\n/, "batch files keep Windows line endings");
    const sh = await (await fetch(`${base}/install.sh`)).text();
    assert.ok(!sh.includes("\r"), "shell scripts keep Unix line endings");
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/v1/pairs`)).status, 401, "the API still works next to the site");
});
