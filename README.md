# 🎧 FriendsInVoice — a Vencord plugin

**[العربية](README.ar.md)**

See at a glance **which voice rooms your friends are in, who is with them, and join with one click** — all from a full page inside Discord.

## Features

- **🎧 Button in the server list** with a live badge showing how many friends are in voice right now (turns yellow and counts only *My list* people once you've added some).
- **Full page, not a popup** — covers Discord's main area next to the server list. Close it with ✕, `Esc`, or by clicking any server.
- **All rooms tab** — every voice room that has at least one of your friends, laid out side by side:
  - server name & icon, room name (click it to open the channel),
  - **"Here because of:"** — the friends that put this room on the list, so you instantly know why it's there,
  - everyone in the room, with `FRIEND` / `MY LIST` / `LIVE` tags and muted/deafened icons,
  - **Join** button (shows `Joined` if you're already there, `Locked` if you lack permission).
- **⭐ My list tab** — pick specific people to follow. Each gets a card showing where they are, who's with them, and a Join button — or "Not in a voice room you can see".
  - Add people by typing their name in the box at the top of the tab,
  - or hover anyone in a room and click **☆**,
  - or **right-click any user → Add to My list (Friends in Voice)** (works for non-friends too).
  - Remove them with the yellow **★**.
- Search across people, servers and rooms.
- Everything updates live as people join, leave, mute or start streaming.
- Direct and group calls are shown too.

## Install

User plugins require Vencord built from source. The included installer does all of it for you (Windows):

1. [Download the latest release](../../releases/latest) and unzip it.
2. Double-click **`install.bat`**. It installs Git / Node.js / pnpm if missing, downloads Vencord, adds the plugin, builds it, and patches Discord.
3. Fully quit Discord (tray icon → **Quit**) and reopen it.
4. **Settings → Vencord → Plugins**, search **FriendsInVoice**, turn it on.

Already have a Vencord source folder? Run:

```powershell
.\install.ps1 -VencordDir D:\Vencord
```

### Manual install

Copy the `friendsInVoice` folder into `Vencord/src/userplugins/`, then run `pnpm build` (and `pnpm inject` once). See Vencord's [guide to installing custom plugins](https://docs.vencord.dev/installing/custom-plugins/).

## Notes & limitations

- **Discord only sends voice activity for servers you are also a member of** (and calls you can see). A friend in a voice room on a server you haven't joined can't be shown — this is a Discord limitation, not something a plugin can bypass.
- The page is drawn on top of Discord's main area (Discord has no API for adding new pages). If the button doesn't appear right after enabling the plugin, click any server once, or press `Ctrl+R`.
- If a Discord update removes Vencord, run `install.bat` again.
- Your *My list* is saved in Vencord's plugin settings, so it survives restarts and is included in Vencord settings sync/backups.

## License

GPL-3.0-or-later, same as Vencord.
