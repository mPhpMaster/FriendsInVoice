# FriendsInVoice for BetterDiscord

This is a separately installable BetterDiscord port of the Vencord plugin. The Vencord source and release ZIP remain unchanged.

## Install

Copy [FriendsInVoice.plugin.js](FriendsInVoice.plugin.js) into the BetterDiscord plugins folder, then enable **FriendsInVoice** in BetterDiscord's Plugins settings. The usual folders are:

| System | Plugin folder |
| --- | --- |
| Windows | `%appdata%\BetterDiscord\plugins` |
| macOS | `~/Library/Application Support/BetterDiscord/plugins` |
| Linux | `~/.config/BetterDiscord/plugins` |

Click the floating **Friends In Voice** button in Discord to open the dashboard. The plugin's BetterDiscord settings panel also has an **Open FriendsInVoice** button.

## Features

| Feature | BetterDiscord behavior |
| --- | --- |
| In Voice | Lists voice rooms containing visible friends or watched people, with members, mute/deafen/stream indicators, and a Join button. Discord controls which rooms are visible and whether joining is allowed. |
| Hide from In Voice | Right-click a user → **Hide from In Voice** to keep them out of the In Voice tab; rooms you see for other people show "🙈 N hidden". Unhide them from the right-click menu or the **Show** button in the Hidden list at the bottom of In Voice. |
| My List, Alerts, Run Away | Right-click user actions and dashboard lists. Online and voice alerts poll Discord stores every five seconds after a 15-second startup quiet period. Run Away offers a **Go invisible** button when Discord's status setting is available. |
| Log | The **Log** tab lists when friends, My list people or people in your room join, leave or move between voice rooms, plus friend requests, new and lost friends, and servers you're no longer in. Filter by Friends, My list, My room, Me or Friends & servers, then pick a server, a person, or a date and time range. Click a person to DM them, a room to open it, a server to go to it; right-click opens Discord's own menu when that room or server is in the sidebar, otherwise a short menu. Saved per account, last 5,000 events, 50 per page. Discord can't tell an unfriend from a block, so both show as "no longer your friend". |
| Personal Guards | Uses the same v2 P-256 ECDH and AES-GCM message format as the Vencord plugin. Keys remain nonextractable in IndexedDB. The owner chooses permissions, the guardian manually sends a public-key DM, and the owner manually sends an encrypted access DM. Commands are encrypted, checked against sender, key, permission, replay, freshness, and shared voice, then executed on the owner's client with Undo and temporary block controls. |
| Smart replies | Built-in English/Arabic rule suggestions are in the **Smart replies** dashboard tab for the latest incoming DM. Clicking one inserts a draft. Optional Claude replies send up to eight recent DM lines to Anthropic only after clicking **Smarter replies**. |
| Updates | Checks GitHub's latest release for a newer `FriendsInVoice.plugin.js` asset and opens its release page. Installing the new file is manual. |

The BetterDiscord dashboard keeps suggestions in its own tab because BetterDiscord does not offer Vencord's `MessageAccessories` API. Vencord's **Stay in voice** and **Never idle** source patches are not included. Discord's internal store and composer methods may change; unavailable methods fail with a visible error rather than sending a message or applying a guard action.

My list, the alert and Run Away lists, Hidden, Personal Guards and the Log are kept per Discord account in that Discord's own storage, so a second Discord logged into another account (or switching accounts) has its own. The first account that opens after updating keeps the lists you had before; other accounts start empty. Other options are shared by every account.

BetterDiscord stores settings separately from Vencord. Recreate your lists and permissions when moving between mods. Public-key messages can use the same protocol across the two versions, but a fresh guardian key exchange and encrypted grant is the safest setup when switching clients. The BetterDiscord port has been build and mock-client tested; it has not yet been run in a live BetterDiscord client or through a two-account voice session.

## Build from source

From this folder, run `pnpm install`, then `pnpm build` and `pnpm test`. The single-file artifact is `FriendsInVoice.plugin.js`. Source files are kept under `src/`; the build bundles the shared guard protocol and smart reply rules from `../friendsInVoice/`.
