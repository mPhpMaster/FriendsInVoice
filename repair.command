#!/usr/bin/env bash
# Double-click this on a Mac to run the repair in Terminal (the Mac version of repair.bat).
cd "$(dirname "$0")" || exit 1
bash ./repair.sh "$@"
status=$?
echo
read -r -p "Press Enter to close this window..." _
exit $status
