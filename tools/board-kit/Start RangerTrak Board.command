#!/bin/bash
# RangerTrak Board kit - double-click launcher (macOS). E-255.
#
# The kit's own launcher, built into rangertrak-board-<version>.zip by tools/board-kit/build.js
# (which also sets LF line endings and the executable bit). Nothing here needs npm or a build:
# rangertrak-board.js carries the Board and its packages, and app/ the built app. Node.js 24 is
# the one thing to install.
#
# cd to this file's own folder; macOS does not guarantee a working directory for a double-click.
cd "$(dirname "$0")"

pause_and_exit() {
  echo ""
  read -p "Press Enter to close this window..."
  exit "$1"
}

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "The RangerTrak Board needs Node.js, and this computer doesn't have it (or it"
  echo "isn't on the PATH)."
  echo ""
  echo "Install the LTS version from https://nodejs.org (it needs the Internet, so do it"
  echo "before you leave for the field), then double-click this file again."
  pause_and_exit 1
fi

NODEVER="${NODE_VERSION_OVERRIDE:-$(node --version)}"
NODEMAJOR="${NODEVER#v}"
NODEMAJOR="${NODEMAJOR%%.*}"
if ! [ "$NODEMAJOR" -ge 24 ] 2>/dev/null; then
  echo ""
  echo "This computer's Node.js is too old (found $NODEVER, need 24 or newer)."
  echo "Install the LTS version from https://nodejs.org, then double-click this file again."
  pause_and_exit 1
fi

if [ ! -f "app/index.html" ]; then
  echo ""
  echo "The app folder is missing from this kit. Unzip the whole kit into one folder,"
  echo "then double-click this file again."
  pause_and_exit 1
fi

node rangertrak-board.js "$@"

echo ""
echo "The Board stopped. Close this window, or double-click this file again to restart it."
pause_and_exit 0
