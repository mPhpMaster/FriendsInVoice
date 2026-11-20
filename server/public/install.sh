#!/usr/bin/env bash
# Friends in Voice web installer for macOS and Linux.
#   curl -fsSL https://friendsinvoice.sarhsoft.com/install.sh | bash
# Downloads the newest release from GitHub into a temporary folder and runs its install.sh,
# which adds the plugin to Vencord (and builds Vencord first if it isn't installed).
set -euo pipefail

echo "Friends in Voice installer"
url="$(curl -fsSL -H 'User-Agent: FriendsInVoice-installer' https://api.github.com/repos/mPhpMaster/FriendsInVoice/releases/latest \
    | grep -o '"browser_download_url": *"[^"]*FriendsInVoice-v[^"]*\.zip"' | head -n 1 | sed 's/.*"\(https[^"]*\)"/\1/')"
if [ -z "$url" ]; then echo "The newest release has no installer package. Try again later." >&2; exit 1; fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
echo "Downloading ${url##*/}..."
curl -fsSL "$url" -o "$work/release.zip"
unzip -q "$work/release.zip" -d "$work/release"
# the installer asks questions, so give it the terminal even when this script came through a pipe
if [ -t 0 ]; then bash "$work/release/install.sh" "$@"; else bash "$work/release/install.sh" "$@" < /dev/tty; fi
