#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_DIR="${HOME}/.codex/skills/paper-workbench"
SOURCE_DIR="${SCRIPT_DIR}/skill/paper-workbench"

rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "${SOURCE_DIR}/" "${TARGET_DIR}/"
else
  cp -R "${SOURCE_DIR}/." "${TARGET_DIR}/"
fi

echo "Installed skill to ${TARGET_DIR}"
echo "You can now say: 用 paper-workbench 处理这个 PDF"
