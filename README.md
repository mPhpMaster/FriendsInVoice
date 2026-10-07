# 🎧 FriendsInVoice: a Vencord plugin

**[العربية](README.ar.md)** · [Install](#install) · [Contributing](CONTRIBUTING.md) · [License](LICENSE)

FriendsInVoice is a plugin for **[Vencord](https://vencord.dev)** ([GitHub](https://github.com/Vendicated/Vencord)), the open-source Discord client mod.

See at a glance **which voice rooms your friends are in, who is with them, and join with one click**, all from a full page inside Discord. Get notified when a friend joins a voice room (even if they look offline) or comes online, and keep a "Run away" list that lets you go invisible in one click.

## Features

- **🎧 Button in the server list** with a live badge showing how many friends are in voice right now.
- **Full page, not a popup**: it covers Discord's main area next to the server list. Close it with ✕, `Esc`, or by clicking anything in the server list (a server or the Discord logo, which takes you back to your DMs).
- **Click anyone to message them, right-click for Discord's menu**: on every tab, clicking a person (in a room, a "Here because of" name, a card or a list) opens your DM with them, and right-clicking opens Discord's normal user menu (Profile, Message, Call, Add Friend, … plus this plugin's options).

### 🔊 In voice (home tab)

Every voice room that has at least one of your **friends** in it, laid out side by side:

- server name & icon, room name (click it to open the channel),
- **"Here because of:"**: the friends that put this room on the list, so you instantly know why it's there,
- everyone in the room, with `FRIEND` / `MY LIST` / `LIVE` tags and muted/deafened icons,
- a `SHOWS OFFLINE` tag on friends who are in the room even though their status says offline,
- a **Join** button (shows `Joined` if you're already there, `Locked` if you lack permission),
- search across people, servers and rooms.

### ⭐ My list

Pick specific people to follow, friends or not. Each gets a card showing their online status, where they are, who's with them and a Join button, or "Not in a voice room you can see".

- Add people by typing their name in the box at the top of the tab, by hovering anyone in a room and clicking **☆**, or by **right-clicking any user → Add to My list**.
- Remove them with the yellow **★**.

### 🔔 Alerts

- **Notify me when in voice**: right-click a user → **Notify me when in voice**. Every time they join a voice room you can see, you get a notification with the server and room, **even if their status shows offline**. Click it and the Friends in Voice page opens with a highlighted card showing where they are, who's with them and a Join button.
- **Notify me when online**: right-click a user → **Notify me when online**. When they come online you get a notification; click it to open your DM with them. By default they're removed from the list after the first notification (you can change this in the plugin settings).
- Both lists can be managed from the 🔔 Alerts tab (add by name, see who's online, remove with ✕).

### 🏃 Run away

Right-click a user → **Add to Run away** (or **Remove from Run away**). Every time someone on this list comes online you get a notification; click it to switch your status to **Invisible**. The 🏃 Run away tab shows everyone on the list, with their status, and lets you add or remove people.

### 🛋️ When you're away from the computer

Right-click **yourself** (your name in a voice room, the member list or a message) to find two switches:

- **Stay in voice when away**: Discord won't move you to the server's AFK channel or drop you from a DM call when you step away.
- **Never go idle**: your status won't switch to Idle when you're away from the computer.

Both are off by default. After changing one, click the notification (or **Reload Discord to apply** in the same menu) to reload Discord. If Vencord's own **DisableCallIdle** or **CustomIdle** plugin is already on, the matching switch shows as handled by it.

These don't stop a server's own bots or rules from kicking inactive people, and you'll still disconnect if your internet drops or the PC goes to sleep.
### Updates

The plugin checks GitHub for new releases (at startup and every 6 hours). When one is out you get a notification in Discord; click it to open the download page, then run the installer from the new zip (see [Update](#update)). You can also click **Check for updates** at the bottom of the page. The check can be turned off in the plugin settings.

## Install

> Custom plugins can't be added to the regular Vencord download. Vencord has to be built from source on your PC, and the installer below does all of that for you. Windows only.

**What you need:** Windows 10/11 and the Discord desktop app ([download Discord](https://discord.com/download)). Log in to Discord at least once before installing.

### Step by step

1. **Download the plugin.** Go to the [latest release](../../releases/latest) and download `FriendsInVoice-vX.Y.Z.zip`.
2. **Unzip it.** Right-click the zip → **Extract All…** → **Extract**.
3. **Run the installer.** Open the extracted folder and double-click **`install.bat`**. If Windows shows "Windows protected your PC", click **More info → Run anyway**. The installer:
   - installs **Git**, **Node.js** and **pnpm** if they're missing (you may see a few Windows permission prompts; click **Yes**),
   - downloads **[Vencord](https://github.com/Vendicated/Vencord)** to `%USERPROFILE%\Vencord` and builds it (this takes a few minutes the first time),
   - adds the FriendsInVoice plugin,
   - patches Discord so it loads Vencord,
   - asks to restart Discord. Answer **Y**.

   Already have Vencord built from source? The installer finds it automatically and only adds the plugin.
4. **Turn the plugin on.** In Discord, open **User Settings** (⚙️ next to your name, bottom left) → scroll to **Vencord** → **Plugins**. Search **FriendsInVoice** and switch it **on**.
5. **Done!** Click the **🎧** button at the top of the server list.

If the 🎧 button doesn't appear right away, click any server once, or press `Ctrl+R`.

### macOS and Linux

1. **Download and unzip** the [latest release](../../releases/latest) (double-click the zip on a Mac).
2. **Run the installer**:
   - **Mac:** double-click **`install.command`**. The first time, macOS may say it's from an unidentified developer: right-click it → **Open** → **Open**.
   - **Mac or Linux, from Terminal:** type `bash ` (with a space), drag **`install.sh`** into the Terminal window, and press Enter.

   It does the same as the Windows installer: installs **Git** (Mac: Apple's Command Line Tools), **Node.js** (Mac: offers to install [Homebrew](https://brew.sh) for it) and **pnpm** if they're missing, downloads and builds **Vencord** in `~/Vencord` (or finds the one you already have), adds FriendsInVoice, patches Discord and offers to restart it. If FriendsInVoice is already installed, it asks whether to uninstall or update it.
3. **Turn the plugin on**: in Discord, **User Settings** → **Vencord** → **Plugins**, search **FriendsInVoice** and switch it **on**.

If patching Discord fails on a Mac, open **System Settings → Privacy & Security → App Management**, turn on **Terminal**, and run the installer again.

Options work the same way: `bash install.sh --vencord-dir ~/Vencord`, `--branch ptb` (or `canary`), `--detect-only`.

### Windows installer options

Run these from a terminal opened in the unzipped folder (`install.bat` passes the options on to `install.ps1`):

```powershell
.\install.bat                          # same as double-clicking it
.\install.bat -VencordDir D:\Vencord   # use (or create) Vencord in this folder
.\install.bat -Branch ptb              # Discord PTB (or: canary)
.\install.bat -DetectOnly              # only show what's installed, change nothing
```

### Update

Download the new release, unzip it, and run `install.bat` again (Mac/Linux: `install.command` or `install.sh`). It will say FriendsInVoice is already installed and ask whether to uninstall it. Answer **N**, then **Y** to update.

### Uninstall

Run `install.bat` (Mac/Linux: `install.command` or `install.sh`) and answer **Y** when it asks whether to uninstall FriendsInVoice. This removes only the plugin; Vencord stays installed. To remove Vencord too, see the [Vencord docs](https://docs.vencord.dev/installing/).

### Manual install (advanced)

Copy the `friendsInVoice` folder into `Vencord/src/userplugins/`, then run `pnpm build` (and `pnpm inject` once) in the Vencord folder. See Vencord's [guide to installing custom plugins](https://docs.vencord.dev/installing/custom-plugins/).

## Notes & limitations

- **Discord only sends voice activity and online status for servers you are also a member of** (and calls you can see). A friend in a voice room on a server you haven't joined can't be shown, and alerts only work for people Discord shares this information about. This is a Discord limitation, not something a plugin can bypass.
- There's no way to be in a voice room without the other people seeing you; everyone connected always appears in the room's member list.
- Alerts only fire while Discord is open. Right after Discord starts or reconnects, the plugin waits a few seconds so it doesn't notify you about everyone who was already online or in voice.
- The page is drawn on top of Discord's main area (Discord has no API for adding new pages).
- If a Discord update removes Vencord, run `install.bat` again.
- My list, the alert lists and the Run away list are saved in Vencord's plugin settings, so they survive restarts.

## Contributing

FriendsInVoice is open source and contributions are welcome: bug reports, ideas, translations and pull requests. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for how to set up a dev environment, and please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

- 🐞 [Report a bug](../../issues/new?template=bug_report.yml)
- ✨ [Suggest a feature](../../issues/new?template=feature_request.yml)

## See also

- [AutoSwitchStatus](https://github.com/mPhpMaster/AutoSwitchStatus): automatically go invisible when you're not in a call, and back online when you join one.
- [Vencord](https://vencord.dev): the Discord client mod this plugin is built for.

## License

[GPL-3.0-or-later](LICENSE), same as Vencord. You're free to use, study, change and share this plugin; changed versions you share must stay under the same license.
