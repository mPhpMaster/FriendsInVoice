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

quit_discord() {
    [ "$OS" = "Darwin" ] || return 0
    osascript -e "quit app \"$DISCORD_NAME\"" >/dev/null 2>&1 || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        pgrep -x "$DISCORD_NAME" >/dev/null 2>&1 || return 0
        sleep 1
    done
    pkill -x "$DISCORD_NAME" >/dev/null 2>&1 || true
    sleep 2
}

run_vencord_installer() {
    # call Vencord's installer directly: going through "pnpm inject" adds an extra "--" with pnpm 12+,
    # which makes the installer ignore -branch and ask which Discord to patch
    (cd "$1" && node scripts/runInstaller.mjs -- -install -branch "$BRANCH")
}

# true if Discord now loads Vencord from the given folder
discord_uses() {
    same_dir "$(patched_vencord_dir "$DISCORD_RES")" "$1"
}

inject_vencord() {
    info "Patching Discord ($BRANCH) to load Vencord from $1..."
    if [ "$OS" = "Darwin" ]; then
        info "Closing Discord first..."
        quit_discord
    fi

    # Vencord's installer can report success even when macOS silently blocked the change,
    # so check where Discord actually loads Vencord from afterwards
    run_vencord_installer "$1" || true
    discord_uses "$1" && return 0

    if [ "$OS" = "Darwin" ]; then
        warn "macOS blocked Terminal from updating Discord."
        open "x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles" >/dev/null 2>&1 || true
        warn "In the Settings window that just opened (Privacy & Security -> App Management):"
        warn "  1. Turn ON \"Terminal\" (or the terminal app you're using)."
        warn "  2. If it isn't in the list, click +, open Applications -> Utilities and choose Terminal."
        printf 'Press Enter when it is turned on... '
        read -r _ </dev/tty || true

        quit_discord
        run_vencord_installer "$1" || true
        discord_uses "$1" && return 0

        die "Discord still loads the old Vencord. macOS applies the new permission only after Terminal restarts:
  1. Quit Terminal (Cmd+Q) and open it again.
  2. Run this installer again (answer N to uninstall, then Y to update)."
    fi

    die "Patching Discord didn't take effect: Discord still loads Vencord from '$(patched_vencord_dir "$DISCORD_RES")'.
If Discord is installed system-wide, run Vencord's installer with sudo, then run this installer again:
  cd \"$1\" && sudo node scripts/runInstaller.mjs -- -install -branch $BRANCH"
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
mkdir -p "$(dirname "$PLUGIN_DIR")"
# Stage outside src/userplugins so the build cannot load a second copy of the plugin.
INSTALL_WORK="$(mktemp -d "$VENCORD_DIR/.friends-in-voice-install.XXXXXX")"
cp -R "$PLUGIN_SRC" "$INSTALL_WORK/new"
if [ -d "$PLUGIN_DIR" ]; then mv "$PLUGIN_DIR" "$INSTALL_WORK/previous"; fi
if ! mv "$INSTALL_WORK/new" "$PLUGIN_DIR"; then
    if [ -d "$INSTALL_WORK/previous" ]; then mv "$INSTALL_WORK/previous" "$PLUGIN_DIR"; fi
    die "Could not install plugin source. Backup: $INSTALL_WORK"
fi
if ! (build_vencord "$VENCORD_DIR"); then
    mv "$PLUGIN_DIR" "$INSTALL_WORK/failed"
    if [ -d "$INSTALL_WORK/previous" ]; then
        mv "$INSTALL_WORK/previous" "$PLUGIN_DIR"
        (build_vencord "$VENCORD_DIR") || warn "The previous source was restored but rebuilding it failed. Backup: $INSTALL_WORK"
    fi
    die "Installation failed; previous plugin source was restored when available. Backup: $INSTALL_WORK"
fi
ok "Backup of the previous plugin, if any: $INSTALL_WORK/previous"

[ "$DISCORD_PATCHED" = 1 ] || inject_vencord "$VENCORD_DIR"

echo
ok "Done!"
ok "After Discord opens: Settings -> Vencord -> Plugins, search '$DISPLAY_NAME' and turn it on."
ok "(If it was already on, it's updated now.)"
restart_discord
