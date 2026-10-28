# 🎧 FriendsInVoice: a Vencord plugin

**[العربية](README.ar.md)** · [Install](#install) · [BetterDiscord port](betterdiscord/README.md) · [Contributing](CONTRIBUTING.md) · [License](LICENSE)

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal&logoColor=white)](https://paypal.me/mfsafadi)

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
- a **Join** button (shows `Joined` if you're already there, `Locked` if you lack permission, `Full` if the room is at its user limit; rooms in channels you can't open show as *Private channel*),
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

### 🙈 Hide someone from In voice

Right-click a user → **Hide from In voice**. They stop showing up in the 🔊 In voice tab, they no longer bring a room into the list, and they don't count in the badge on the server-list button; in a room you see for other friends they're still listed, with a **HIDDEN** tag next to their name. To bring them back, right-click them → **Show in In voice**, or press ✕ next to their name in the 🙈 Hidden list at the bottom of the In voice tab. My list, alerts and Run away keep working for them as before.

### 📜 Log

A history of what happens around you: when a **friend**, someone on **My list**, or someone in **your room** joins, leaves or moves between voice rooms, with the time, the person, the room and the server. People coming into or leaving the room you're sitting in are tagged **YOUR ROOM**, even if they aren't your friends. It also logs **friend requests**, **new friends**, friends you **lost**, and servers you're **no longer in**. Filter by Friends, My list, My room, Me, or Friends & servers, then narrow it to one server, one person, or a date and time range, or search by name.

Everything in the log can be clicked: a **person** opens your DM with them (right-click for Discord's user menu), a **room** opens it (right-click for Discord's channel menu: join, mute, copy link…) and a **server** takes you to it (right-click for Discord's server menu). When the room or server isn't on screen in Discord's sidebar, right-click shows a short menu with the main actions instead.

Each account has its own log, saved on your computer. It keeps the last 5,000 events and shows 50 per page. People on your Hidden list aren't logged.

Discord doesn't say who ended a friendship, and it never tells you when someone blocks you: both look the same as being unfriended, so the log says "unfriended, blocked, or you removed them". In the same way, losing a server is logged as "kicked, banned, or you left".

### 🛡️ Personal Guards

Let a friend you trust mute, deafen, or disconnect **your** account while you're both in the same voice channel. No moderator permission is needed, and nothing is sent without you pressing Enter.

1. **You:** right-click them → **Make Personal Guard…**, tick what they may do (**Mute microphone**, **Deafen**, **Disconnect from voice**) and click **Prepare invite**. Your DM with them opens with the invite ready; press **Enter**.
2. **They:** the invite shows an **Accept** / **Decline** card in your DM, so it works even if they were offline when you sent it.
3. **Using it:** while you share a voice channel, they right-click you → **🛡️ Mute <you>** (or Deafen / Disconnect) and press **Enter** on the prepared message. It's sent with `@silent`, so you don't get a ping. You get a notice with **Undo** and a temporary **Block**; if a command is refused, you see why.

Change or remove access any time from the same menu (**Personal Guard settings…**). An updated invite replaces the old one, and their client takes it over automatically. Removing someone takes effect on your side immediately.

In the chat, each Personal Guards message is a single short line (a link whose hidden part carries the data; clicking it opens this project's page). The invite shows the allowed actions and your public key. Commands are encrypted with ECDH and AES-GCM, and your private key stays in local, non-extractable browser storage. Before acting, your client checks the Discord sender, the current invite, freshness, replays and that you share a voice channel. Keys are per Discord installation, so after moving to a new device send a new invite.

Under **Access others gave you**, click **Remove access** to remove an accepted owner from your local list and its Guard Actions menu. This does not change the owner's own guardian list.

Send each guard invitation or command as a separate DM. Preparing a message opens the conversation and reveals the draft. If that DM already has an unsent draft, the plugin keeps it and asks you to send or clear it before preparing another guard message. Rapid action clicks cannot combine messages. Encoded fields tolerate spaces, tabs, and line breaks introduced during message composition or delivery; the decoded key, wire format, and encrypted authentication are still validated.

### 💬 Smart replies in DMs

When someone sends you a direct message, a few suggested replies appear under their latest message. Click one to put it in the message box; you can edit it before pressing Enter, and nothing is sent by itself.

- **Built-in (on by default, free and private):** the plugin recognizes common messages and specific questions in **Arabic and English**: greetings, salam, good morning/evening, "how are you", "what are you doing", thanks, blessings, apologies, congratulations and good news, birthdays, Ramadan, Eid and Jumu'ah, condolences (handled respectfully), good luck, exams and work, "where are you", "I'm back", "miss you", voice and game invites, food and going out, photo requests, getting to know someone, profile picture compliments, asking for help or money, football, movies and series, music, weather, travel, weekend plans, staying up late, "busy / wait", tired or sick, bored, going to sleep, goodbye, laughing, compliments, links, ok / no and questions about timing, places, files, opinions, recommendations and plans. For Arabic it also detects the **dialect** (Gulf / neutral, Egyptian, Levantine, Iraqi) and replies in the same one. It shows up to four suggestions, prioritizes specific questions, and asks for context when a safe answer is not clear. Messages never leave your computer.
- **✨ Smarter replies with Claude (optional):** turn on *Smarter replies* in the plugin settings and paste a [Claude API key](https://console.anthropic.com). A **✨ Smarter replies** button then appears next to the suggestions; clicking it asks Claude for three replies that fit the conversation. Only when you click it, the last few messages of that chat are sent to Anthropic. API usage is billed to your Anthropic account. The model can be changed in the settings (default claude-opus-5-5).

Suggestions disappear as soon as anyone sends a newer message. Turn the feature off with *Smart replies* in the plugin settings.
### 🛋️ When you're away from the computer

Right-click **yourself** (your name in a voice room, the member list or a message) to find two switches:

- **Stay in voice when away**: Discord won't move you to the server's AFK channel or drop you from a DM call when you step away.
- **Never go idle**: your status won't switch to Idle when you're away from the computer.

Both are off by default. After changing one, click the notification (or **Reload Discord to apply** in the same menu) to reload Discord. If Vencord's own **DisableCallIdle** or **CustomIdle** plugin is already on, the matching switch shows as handled by it.

These don't stop a server's own bots or rules from kicking inactive people, and you'll still disconnect if your internet drops or the PC goes to sleep.
### 👻 Auto switch status

Turn on **Auto switch status** (in the plugin settings, or right-click yourself → **Auto switch status in calls**) and your status changes by itself:

| You are… | Your status becomes |
|---|---|
| In a voice channel, DM call or group call | **Online** *(changeable)* |
| Not in any call | **Invisible** *(changeable)* |

It switches the moment you join, leave or move between calls, and checks again when Discord starts. Pick both statuses (Online, Idle, Do Not Disturb or Invisible) in the plugin settings, for example *Do Not Disturb* in calls and *Online* otherwise. It's off by default; turning it off leaves your status as it is.
### Updates

The plugin checks GitHub for new releases (at startup and every 6 hours). On Windows and macOS, click the new-version notification to download the package from this repository's GitHub Release, verify its SHA-256 digest, install the plugin source, build Vencord, and restart Discord. Your plugin settings and other plugins stay in place. A failed build restores the previous source and tries to rebuild it. Linux users can use the manual update steps below. You can also click **Check for updates** at the bottom of the page. The check can be turned off in the plugin settings. Versions before v1.9.0 need one manual update to gain one-click updating.

After an update, the first time Discord starts it shows a **What's new** window with the release notes of the new version (and of any versions you skipped), once per Discord. It has links to the release and the GitHub page; turn it off with **Show what's new** in the plugin settings. The **GitHub** link at the bottom of the page opens the repository.

**macOS v1.11.0:** its update button cannot read Discord's `app.asar` archive. Install v1.11.1 manually once with `install.command`; later updates use the repaired updater.

## Install

> Custom plugins can't be added to the regular Vencord download. Vencord has to be built from source on your PC, and the installer below does all of that for you. Windows instructions follow; the included `install.command` and `install.sh` support macOS and Linux.

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
   - **Mac or Linux, from Terminal (recommended):** type `bash ` (with a space), drag **`install.sh`** into the Terminal window, and press Enter. This works on every macOS version without security prompts.
   - **Mac, double-click:** double-click **`install.command`**. The first time, macOS blocks files from unidentified developers. On macOS 15 (Sequoia) and later, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**; on older versions, right-click the file → **Open** → **Open**.

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

On Windows and macOS with v1.9.0 or newer, click the update notification. For the first update from an older version, or on Linux, download the new release, unzip it, and run `install.bat` again (Mac/Linux: `install.command` or `install.sh`). It will say FriendsInVoice is already installed and ask whether to uninstall it. Answer **N**, then **Y** to update.

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
- My list, the alert lists, the Run away list, the Hidden list, Personal Guards and the Log are saved per Discord account, so they survive restarts and a second Discord logged into another account (or switching accounts) gets its own. The first account that opens after updating keeps the lists you had before; other accounts start empty. Options like notifications and smart replies are shared by every account.

## Contributing

FriendsInVoice is open source and contributions are welcome: bug reports, ideas, translations and pull requests. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for how to set up a dev environment, and please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

- 🐞 [Report a bug](../../issues/new?template=bug_report.yml)
- ✨ [Suggest a feature](../../issues/new?template=feature_request.yml)

## See also

- [AutoSwitchStatus](https://github.com/mPhpMaster/AutoSwitchStatus): automatically go invisible when you're not in a call, and back online when you join one.
- [Vencord](https://vencord.dev): the Discord client mod this plugin is built for.

## Support

If FriendsInVoice is useful to you, you can support its development with a donation:

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal&logoColor=white)](https://paypal.me/mfsafadi)

You'll also find a **❤️ Donate** link at the bottom of the Friends in Voice page in Discord.

Thank you! Stars on GitHub, bug reports and ideas help a lot too.

## License

[GPL-3.0-or-later](LICENSE), same as Vencord. You're free to use, study, change and share this plugin; changed versions you share must stay under the same license.
