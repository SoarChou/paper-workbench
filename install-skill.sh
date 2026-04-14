#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_DIR="${HOME}/.codex/skills/paper-workbench"

mkdir -p "${TARGET_DIR}"
cp "${SCRIPT_DIR}/skill/paper-workbench/SKILL.md" "${TARGET_DIR}/SKILL.md"

echo "Installed skill to ${TARGET_DIR}"
echo "You can now say: 用 paper-workbench 处理这个 PDF"

