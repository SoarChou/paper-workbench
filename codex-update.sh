#!/bin/sh
set -eu

INSTALL_BASE="${PAPER_WORKBENCH_HOME:-$HOME/.paper-workbench}"
WORK_DIR="$INSTALL_BASE/runtime"
CACHE_DIR="$INSTALL_BASE/cache"
CONFIG_DIR="$INSTALL_BASE/config"
APP_DIR="$WORK_DIR/paper-workbench"
SOURCE_FILE="$CONFIG_DIR/install-source.txt"
VERSION_FILE="$CONFIG_DIR/installed-version.txt"

DEFAULT_SOURCE="${PAPER_WORKBENCH_DEFAULT_SOURCE:-https://github.com/SoarChou/paper-workbench.git}"

mkdir -p "$WORK_DIR" "$CACHE_DIR" "$CONFIG_DIR"

SOURCE_INPUT="${1:-}"
if [ -z "$SOURCE_INPUT" ] && [ -s "$SOURCE_FILE" ]; then
  SOURCE_INPUT="$(cat "$SOURCE_FILE")"
fi
if [ -z "$SOURCE_INPUT" ]; then
  SOURCE_INPUT="$DEFAULT_SOURCE"
fi

case "$SOURCE_INPUT" in
  --github)
    SOURCE_INPUT="$DEFAULT_SOURCE"
    ;;
  --release)
    SOURCE_INPUT="https://github.com/SoarChou/paper-workbench/releases/latest/download/paper-workbench-product-20260416-auto-install.zip"
    ;;
esac

is_url() {
  case "$1" in
    http://*|https://*) return 0 ;;
    *) return 1 ;;
  esac
}

if ! is_url "$SOURCE_INPUT" && [ ! -e "$SOURCE_INPUT" ]; then
  echo "Remembered source not found: $SOURCE_INPUT"
  SOURCE_INPUT="$DEFAULT_SOURCE"
  echo "Fallback source: $SOURCE_INPUT"
fi

INSTALLER_SOURCE=""
if [ -x "$APP_DIR/codex-auto-install.sh" ]; then
  INSTALLER_SOURCE="$APP_DIR/codex-auto-install.sh"
elif [ -x "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/codex-auto-install.sh" ]; then
  INSTALLER_SOURCE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/codex-auto-install.sh"
else
  echo "Cannot find codex-auto-install.sh. Please reinstall once first." >&2
  exit 1
fi

TMP_INSTALLER="$CACHE_DIR/.codex-auto-install-$$.sh"
cp "$INSTALLER_SOURCE" "$TMP_INSTALLER"
chmod +x "$TMP_INSTALLER"

echo "Updating Paper Workbench from: $SOURCE_INPUT"
PAPER_WORKBENCH_HOME="$INSTALL_BASE" PAPER_READER_PORT="${PAPER_READER_PORT:-8877}" sh "$TMP_INSTALLER" "$SOURCE_INPUT"
rm -f "$TMP_INSTALLER"

if [ -s "$VERSION_FILE" ]; then
  echo "Current version: $(cat "$VERSION_FILE")"
fi
echo "Update complete."
