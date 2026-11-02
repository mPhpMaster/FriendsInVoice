#!/usr/bin/env bash
# FriendsInVoice repair for macOS and Linux: bash repair.sh  (on a Mac you can double-click repair.command).
# The work is done by repair.mjs.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
    echo "Node.js isn't installed. Run install.sh (or install.command) first, or install Node.js 22+ and run this again."
    exit 1
fi
exec node ./repair.mjs "$@"
