# Friends in Voice guard server

Pairs two Friends in Voice installs with a one-time code and relays end-to-end encrypted Personal Guard commands between them. The plugin talks only to this server for Personal Guards, so it never reads DMs, sends guard messages or adds reactions on Discord.

Node.js 18 or newer, no dependencies. State is one JSON file.

```sh
node start.mjs                 # PORT=3077 HOST=127.0.0.1 DATA_FILE=./data/guards.json
node --test test/server.test.mjs  # tests
```

Put it behind HTTPS (the plugin refuses plain `http://` except for localhost). Long polls wait up to 25 seconds, so the proxy timeout must be longer. `deploy/` has the systemd unit, the Apache include and the install script used for `friendsinvoice.sarhsoft.com` on cPanel.

## Admin dashboard

`/admin` shows server health, accounts (Discord ID, last seen, whether the owner side is listening), pairings and open codes, and can remove a pairing or an account. It reads only this server's data: no Discord calls, no tokens or token hashes. It stays off until `ADMIN_PASSWORD_HASH` is set; `node hash-password.mjs < file` prints that line (empty input makes a random password and prints it to stderr). On the live server `deploy/install.sh` does this once and keeps the password in `/root/friendsinvoice-admin-password.txt` (root only). Login is limited to 10 tries per IP per 15 minutes; sessions last 12 hours in an HttpOnly, Secure, SameSite=Strict cookie.

## What it stores

- Per install and Discord account: Discord user ID, ECDH public key, a SHA-256 hash of its random token.
- Per pairing: owner, guardian, allowed actions, invite nonce, created date.
- Invite codes until used or 10 minutes. Commands until delivered, at most 60 seconds, encrypted so the server can't read them.
- No Discord tokens, messages or voice data. The Discord user ID is a label the server can't verify; the code proves the two people agreed.

## API

Every `/v1` call except `register` needs `Authorization: Bearer <token>`.

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/v1/register` | `{discordId, publicKey}` → `{token}` |
| GET | `/v1/pairs` | `{me, pairs, codes}` for this account |
| POST | `/v1/codes` | Owner: `{guardianId, actions, nonce}` → `{code, expiresAt}` |
| GET | `/v1/codes/{code}` | Guardian: who invited and what they allow |
| POST | `/v1/codes/{code}/accept`, `/refuse` | Guardian decides |
| DELETE | `/v1/codes/{code}` | Owner cancels |
| PATCH | `/v1/pairs/{id}` | Owner changes allowed actions |
| DELETE | `/v1/pairs/{id}` | Either side removes the pairing |
| POST | `/v1/pairs/{id}/commands` | Guardian: `{wire}` (sealed command) → `{delivered}` |
| GET | `/v1/events?after=N&wait=ms` | Long poll for `pairs`, `refused` and `command` events |

Limits: 20 registrations per IP per hour, 120 requests per account per minute, 20 code lookups per account per 10 minutes, 10 open codes per owner.
