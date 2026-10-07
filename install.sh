#!/usr/bin/env bash
#
# Installs (or uninstalls) the FriendsInVoice Vencord plugin on macOS and Linux.
#
#  - If Vencord (built from source) isn't installed yet, it downloads and builds it, adds the plugin,
#    patches Discord and restarts it.
#  - If Vencord is already installed, it only adds the plugin to it.
#  - If the plugin is already installed, it asks whether to uninstall it (or update it instead).
#
# Custom plugins can't be added to the regular prebuilt Vencord, which is why Vencord is built from source.
#
# Usage:
#   ./install.sh                            # auto-detect everything
#   ./install.sh --vencord-dir ~/Vencord    # use this Vencord source folder
#   ./install.sh --branch ptb               # Discord PTB (or: canary) instead of stable
#   ./install.sh --detect-only              # just show what was found, change nothing
#
# Written for the bash 3.2 that ships with macOS.

set -euo pipefail

# ---- the only plugin-specific lines ----
PLUGIN_NAME="friendsInVoice"   # folder name inside Vencord/src/userplugins
DISPLAY_NAME="FriendsInVoice"  # name shown in Settings -> Vencord -> Plugins
# -----------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$SCRIPT_DIR/$PLUGIN_NAME"

VENCORD_DIR=""
BRANCH="stable"
DETECT_ONLY=0

if [ -t 1 ]; then
    C_INFO=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_OFF=$'\033[0m'
else
    C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_OFF=""
fi
info() { printf '%s%s%s\n' "$C_INFO" "$*" "$C_OFF"; }
ok()   { printf '%s%s%s\n' "$C_OK" "$*" "$C_OFF"; }
warn() { printf '%s%s%s\n' "$C_WARN" "$*" "$C_OFF"; }
die()  { printf '%s%s%s\n' "$C_ERR" "$*" "$C_OFF" >&2; exit 1; }

usage() { sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; }

# ask "question" y|n  -> returns 0 for yes
ask() {
    local question="$1" default="$2" hint answer
    if [ "$default" = "y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
    printf '%s %s ' "$question" "$hint"
    read -r answer </dev/tty || answer=""
    answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    if [ -z "$answer" ]; then [ "$default" = "y" ]; return; fi
    case "$answer" in y*) return 0 ;; *) return 1 ;; esac
}

while [ $# -gt 0 ]; do
    case "$1" in
        --vencord-dir|-VencordDir) [ $# -ge 2 ] || die "$1 needs a folder"; VENCORD_DIR="$2"; shift 2 ;;
        --branch|-Branch)          [ $# -ge 2 ] || die "$1 needs a value"; BRANCH="$2"; shift 2 ;;
        --detect-only|-DetectOnly) DETECT_ONLY=1; shift ;;
        -h|--help)                 usage; exit 0 ;;
        *)                         die "Unknown option: $1 (use --help)" ;;
    esac
done

case "$BRANCH" in stable|ptb|canary) ;; *) die "--branch must be stable, ptb or canary" ;; esac

OS="$(uname -s)"
case "$OS" in Darwin|Linux) ;; *) die "This script is for macOS and Linux. On Windows, use install.bat." ;; esac

# ---------- tools ----------

ensure_brew_in_path() {
    if ! command -v brew >/dev/null 2>&1; then
        for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
            if [ -x "$b" ]; then eval "$("$b" shellenv)"; return; fi
        done
    fi
}

ensure_tools() {
    if ! command -v git >/dev/null 2>&1; then
        if [ "$OS" = "Darwin" ]; then
            info "Git is missing. macOS will now offer to install the Command Line Tools (which include Git)."
            xcode-select --install 2>/dev/null || true
            die "Finish installing the Command Line Tools in the window that opened, then run this installer again."
        fi
        die "Git is missing. Install it with your package manager (for example: sudo apt install git) and run this again."
    fi

    if ! command -v node >/dev/null 2>&1; then
        if [ "$OS" = "Darwin" ]; then
            ensure_brew_in_path
            if ! command -v brew >/dev/null 2>&1; then
                warn "Node.js is needed, and the easiest way to get it on a Mac is Homebrew (https://brew.sh)."
                if ask "Install Homebrew now? (it will ask for your Mac password)" y; then
                    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                    ensure_brew_in_path
                else
                    die "Install Node.js LTS from https://nodejs.org and run this installer again."
                fi
            fi
            info "Installing Node.js..."
            brew install node
        else
            die "Node.js is missing. Install Node.js LTS (https://nodejs.org or your package manager) and run this again."
        fi
        command -v node >/dev/null 2>&1 || die "Node.js could not be installed. Open a new Terminal window and run this again."
    fi

    if ! command -v pnpm >/dev/null 2>&1; then
        info "Installing pnpm..."
        npm install -g pnpm 2>/dev/null || sudo npm install -g pnpm
        hash -r
        command -v pnpm >/dev/null 2>&1 || die "pnpm could not be installed. Open a new Terminal window and run this again."
    fi
}

# ---------- Discord ----------

case "$BRANCH" in
    stable) DISCORD_NAME="Discord";        LINUX_NAMES="discord Discord";              LINUX_CMD="discord" ;;
    ptb)    DISCORD_NAME="Discord PTB";    LINUX_NAMES="discord-ptb DiscordPTB";       LINUX_CMD="discord-ptb" ;;
    canary) DISCORD_NAME="Discord Canary"; LINUX_NAMES="discord-canary DiscordCanary"; LINUX_CMD="discord-canary" ;;
esac

# Prints Discord's "resources" folder (where app.asar lives), or nothing if Discord isn't found.
find_discord_resources() {
    if [ "$OS" = "Darwin" ]; then
        for app in "/Applications/$DISCORD_NAME.app" "$HOME/Applications/$DISCORD_NAME.app"; do
            if [ -d "$app/Contents/Resources" ]; then printf '%s\n' "$app/Contents/Resources"; return 0; fi
        done
        return 0
    fi
    local n dir
    for n in $LINUX_NAMES; do
        for dir in "/usr/share/$n" "/usr/lib/$n" "/opt/$n" "/usr/lib64/$n" "$HOME/.local/share/$n" \
                   "/var/lib/flatpak/app/com.discordapp.$n/current/active/files/$n" \
                   "$HOME/.local/share/flatpak/app/com.discordapp.$n/current/active/files/$n"; do
            if [ -d "$dir/resources" ]; then printf '%s\n' "$dir/resources"; return 0; fi
        done
    done
    return 0
}

# The folder Discord currently loads Vencord from (read from the patched app.asar), or nothing.
patched_vencord_dir() {
    local res="$1" asar
    [ -n "$res" ] || return 0
    asar="$res/app.asar"
    [ -f "$asar" ] || return 0
    LC_ALL=C grep -aoE '/[^"'"'"'`]+/dist/patcher\.js' "$asar" 2>/dev/null | head -n 1 | sed 's#/dist/patcher\.js$##' || true
}

restart_discord() {
    if ! ask "Restart Discord now so the change takes effect?" y; then
        warn "OK. Fully quit Discord and open it again when you're ready."
        return
    fi
    if [ "$OS" = "Darwin" ]; then
        osascript -e "quit app \"$DISCORD_NAME\"" >/dev/null 2>&1 || true
        sleep 3
        open -a "$DISCORD_NAME" || warn "Couldn't start Discord. Open it yourself."
    else
        local n
        for n in $LINUX_NAMES; do pkill -x "$n" 2>/dev/null || true; done
        sleep 2
        if command -v "$LINUX_CMD" >/dev/null 2>&1; then
            nohup "$LINUX_CMD" >/dev/null 2>&1 &
        else
            warn "Couldn't start Discord automatically. Open it yourself."
            return
        fi
    fi
    ok "Discord is starting."
}

# ---------- Vencord ----------

is_vencord_source() {
    [ -n "${1:-}" ] && [ -f "$1/package.json" ] && grep -qE '"name"[[:space:]]*:[[:space:]]*"vencord"' "$1/package.json"
}

build_vencord() {
    (
        cd "$1"
        if [ ! -d node_modules ]; then
            info "Installing Vencord's dependencies (first time only, takes a few minutes)..."
            pnpm install --frozen-lockfile
        fi
        info "Building Vencord..."
        pnpm build
    ) || die "Building Vencord failed (see the messages above)."
}

inject_vencord() {
    info "Patching Discord ($BRANCH) to load Vencord from $1..."
    if ! (cd "$1" && pnpm inject -- -install -branch "$BRANCH"); then
        if [ "$OS" = "Darwin" ]; then
            warn "If macOS blocked it: System Settings -> Privacy & Security -> App Management -> turn on Terminal, then run this again."
        fi
        die "Patching Discord failed."
    fi
}

same_dir() {
    [ -n "${1:-}" ] && [ -n "${2:-}" ] && [ -d "$1" ] && [ -d "$2" ] && \
        [ "$(cd "$1" && pwd -P)" = "$(cd "$2" && pwd -P)" ]
}

# ---------- detect ----------

[ -d "$PLUGIN_SRC" ] || die "Can't find the '$PLUGIN_NAME' folder next to this script. Unzip the whole download and run it from there."

DISCORD_RES="$(find_discord_resources)"
[ -n "$DISCORD_RES" ] || die "Discord ($BRANCH) wasn't found. Install it from https://discord.com/download, open it once, and run this again."

PATCHED_DIR="$(patched_vencord_dir "$DISCORD_RES")"
if [ -z "$VENCORD_DIR" ]; then
    if is_vencord_source "$PATCHED_DIR"; then VENCORD_DIR="$PATCHED_DIR"; else VENCORD_DIR="$HOME/Vencord"; fi
fi

VENCORD_INSTALLED=0; is_vencord_source "$VENCORD_DIR" && VENCORD_INSTALLED=1
PLUGIN_DIR="$VENCORD_DIR/src/userplugins/$PLUGIN_NAME"
PLUGIN_INSTALLED=0; [ "$VENCORD_INSTALLED" = 1 ] && [ -d "$PLUGIN_DIR" ] && PLUGIN_INSTALLED=1
DISCORD_PATCHED=0; same_dir "$PATCHED_DIR" "$VENCORD_DIR" && DISCORD_PATCHED=1

echo
echo "Discord ($BRANCH):        $DISCORD_RES"
if [ "$VENCORD_INSTALLED" = 1 ]; then echo "Vencord source folder:    $VENCORD_DIR (installed)"
else echo "Vencord source folder:    $VENCORD_DIR (not installed yet)"; fi
echo "Discord loads Vencord:    ${PATCHED_DIR:-no (or the prebuilt Vencord)}"
if [ "$PLUGIN_INSTALLED" = 1 ]; then echo "$DISPLAY_NAME installed: yes"; else echo "$DISPLAY_NAME installed: no"; fi
echo

[ "$DETECT_ONLY" = 1 ] && exit 0

# ---------- plugin already installed: uninstall or update ----------

if [ "$PLUGIN_INSTALLED" = 1 ]; then
    if ask "$DISPLAY_NAME is already installed. Do you want to UNINSTALL it?" n; then
        info "Removing the plugin..."
        rm -rf "$PLUGIN_DIR"
        ensure_tools
        build_vencord "$VENCORD_DIR"
        ok "$DISPLAY_NAME was uninstalled. (Vencord itself is still installed.)"
        restart_discord
        exit 0
    fi

    if ! ask "Update it to the version in this folder instead?" y; then
        warn "Nothing changed."
        exit 0
    fi
fi

# ---------- install ----------

ensure_tools

if [ "$VENCORD_INSTALLED" = 0 ]; then
    info "Downloading Vencord to $VENCORD_DIR..."
    git clone https://github.com/Vendicated/Vencord.git "$VENCORD_DIR" || die "Downloading Vencord failed."
fi

info "Adding $DISPLAY_NAME to Vencord..."
mkdir -p "$PLUGIN_DIR"
cp -R "$PLUGIN_SRC/." "$PLUGIN_DIR/"

build_vencord "$VENCORD_DIR"

[ "$DISCORD_PATCHED" = 1 ] || inject_vencord "$VENCORD_DIR"

echo
ok "Done!"
ok "After Discord opens: Settings -> Vencord -> Plugins, search '$DISPLAY_NAME' and turn it on."
ok "(If it was already on, it's updated now.)"
restart_discord
