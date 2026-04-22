#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -f "${SCRIPT_DIR}/codex-service.sh" ]; then
  exec sh "${SCRIPT_DIR}/codex-service.sh" start
fi

cd "${SCRIPT_DIR}/paper-reader-ai-branch"
exec python3 server.py
