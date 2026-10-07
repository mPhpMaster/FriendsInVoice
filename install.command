#!/usr/bin/env bash
# Double-click this on a Mac to run the installer in Terminal (the Mac version of install.bat).
cd "$(dirname "$0")" || exit 1
bash ./install.sh "$@"
status=$?
echo
read -r -p "Press Enter to close this window..." _
exit $status
