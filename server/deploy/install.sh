#!/bin/bash
# Installs or updates the guard server on a cPanel host. Run as root from the folder holding the uploaded files.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
APP=/home/sarhsoft/apps/friendsinvoice
DOMAIN=friendsinvoice.sarhsoft.com
INCLUDE_DIR=/etc/apache2/conf.d/userdata

mkdir -p "$APP/data"
install -m 644 "$SRC/server.mjs" "$SRC/start.mjs" "$SRC/package.json" "$APP/"
chown -R sarhsoft:sarhsoft "$APP"
chmod 700 "$APP/data"

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
