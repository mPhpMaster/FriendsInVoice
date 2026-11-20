#!/bin/bash
# Installs or updates the guard server on a cPanel host. Run as root from the folder holding the uploaded files.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
APP=/home/sarhsoft/apps/friendsinvoice
DOMAIN=friendsinvoice.sarhsoft.com
INCLUDE_DIR=/etc/apache2/conf.d/userdata

mkdir -p "$APP/data"
install -m 644 "$SRC/server.mjs" "$SRC/start.mjs" "$SRC/admin.mjs" "$SRC/adminPage.mjs" "$SRC/site.mjs" "$SRC/hash-password.mjs" "$SRC/package.json" "$APP/"
mkdir -p "$APP/public"
install -m 644 "$SRC"/public/* "$APP/public/"
chown -R sarhsoft:sarhsoft "$APP"
chmod 700 "$APP/data"

# dashboard password: made once, readable only by root. Delete both files and rerun to get a new one.
PASSWORD_FILE=/root/friendsinvoice-admin-password.txt
if [ ! -f /etc/friendsinvoice/admin.env ]; then
    mkdir -p /etc/friendsinvoice
    chmod 700 /etc/friendsinvoice
    umask 077
    /opt/node22/bin/node "$APP/hash-password.mjs" < /dev/null 2> "$PASSWORD_FILE.tmp" > /etc/friendsinvoice/admin.env
    sed 's/^New admin password: //' "$PASSWORD_FILE.tmp" > "$PASSWORD_FILE"
    rm -f "$PASSWORD_FILE.tmp"
    chmod 600 /etc/friendsinvoice/admin.env "$PASSWORD_FILE"
    echo "Admin password saved to $PASSWORD_FILE"
fi

install -m 644 "$SRC/friendsinvoice.service" /etc/systemd/system/friendsinvoice.service
systemctl daemon-reload
systemctl enable friendsinvoice >/dev/null 2>&1
systemctl restart friendsinvoice

for kind in ssl std; do
    mkdir -p "$INCLUDE_DIR/$kind/2_4/sarhsoft/$DOMAIN"
    install -m 644 "$SRC/apache-proxy.conf" "$INCLUDE_DIR/$kind/2_4/sarhsoft/$DOMAIN/proxy.conf"
done
/scripts/rebuildhttpdconf >/dev/null
apachectl -t
/scripts/restartsrv_httpd >/dev/null 2>&1 || apachectl graceful

for i in 1 2 3 4 5; do
    if curl -fsS http://127.0.0.1:3077/health; then echo; break; fi
    sleep 1
done
systemctl is-active friendsinvoice
