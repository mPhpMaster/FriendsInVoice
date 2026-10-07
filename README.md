# 🎧 FriendsInVoice — a Vencord plugin

**[العربية](README.ar.md)**

See at a glance **which voice rooms your friends are in, who is with them, and join with one click**, all from a full page inside Discord. Follow specific people, get a notification when someone comes online, and keep a blacklist that lets you go invisible in one click.

## Features

- **🎧 Button in the server list** with a live badge showing how many friends are in voice right now.
- **Full page, not a popup**: it covers Discord's main area next to the server list. Close it with ✕, `Esc`, or by clicking anything in the server list (a server or the Discord logo, which takes you back to your DMs).

### 🔊 In voice (home tab)

Every voice room that has at least one of your **friends** in it, laid out side by side:

- server name & icon, room name (click it to open the channel),
- **"Here because of:"**: the friends that put this room on the list, so you instantly know why it's there,
- everyone in the room, with `FRIEND` / `MY LIST` / `LIVE` tags and muted/deafened icons,
- a `SHOWS OFFLINE` tag on people who are in the room even though their status says offline,
- a **Join** button (shows `Joined` if you're already there, `Locked` if you lack permission),
- search across people, servers and rooms.

### ⭐ My list

Pick specific people to follow, friends or not. Each gets a card showing their online status, where they are, who's with them and a Join button, or "Not in a voice room you can see".

- Add people by typing their name in the box at the top of the tab,
- or hover anyone in a room and click **☆**,
- or **right-click any user → Add to My list**.
- Remove them with the yellow **★**.

### 🔔 Alerts

- **Notify me when online**: right-click a user → **Notify me when online**. When they come online you get a notification; click it to open your DM with them. By default they're removed from the list after the first notification (you can change this in the plugin settings).
- **Blacklist**: right-click a user → **Add to blacklist**. Every time one of them comes online you get a notification; click it to switch your status to **Invisible**.
- Both lists can also be managed from the 🔔 Alerts tab (add by name, see who's online, remove with ✕).

### Updates

The plugin checks GitHub for new releases (at startup and every 6 hours). When one is out you get a notification in Discord; click it to open the download page, then run `install.bat` from the new zip. You can also click **Check for updates** at the bottom of the page. The check can be turned off in the plugin settings.

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

To update, do the same with the new release, then press `Ctrl+R` in Discord.

### Manual install

Copy the `friendsInVoice` folder into `Vencord/src/userplugins/`, then run `pnpm build` (and `pnpm inject` once). See Vencord's [guide to installing custom plugins](https://docs.vencord.dev/installing/custom-plugins/).

## Notes & limitations

- **Discord only sends voice activity and online status for servers you are also a member of** (and calls you can see). A friend in a voice room on a server you haven't joined can't be shown, and online alerts only work for people Discord shares a status for (friends, or people in your servers). This is a Discord limitation, not something a plugin can bypass.
- There's no way to be in a voice room without the other people seeing you; everyone connected always appears in the room's member list.
- Alerts only fire while Discord is open. Right after Discord starts or reconnects, the plugin waits a few seconds so it doesn't notify you about everyone who was already online.
- The page is drawn on top of Discord's main area (Discord has no API for adding new pages). If the button doesn't appear right after enabling the plugin, click any server once, or press `Ctrl+R`.
- If a Discord update removes Vencord, run `install.bat` again.
- My list, the alert lists and the blacklist are saved in Vencord's plugin settings, so they survive restarts.

## See also

- [AutoSwitchStatus](https://github.com/mPhpMaster/AutoSwitchStatus): automatically go invisible when you're not in a call, and back online when you join one.

## License

GPL-3.0-or-later, same as Vencord.
