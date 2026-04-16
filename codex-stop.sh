#!/bin/sh
set -eu

INSTALL_BASE="${PAPER_WORKBENCH_HOME:-$HOME/.paper-workbench}"
PID_FILE="$INSTALL_BASE/runtime/server.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No running Paper Workbench PID file found: $PID_FILE"
  exit 0
fi

pid=$(cat "$PID_FILE" 2>/dev/null || true)
if [ -z "${pid:-}" ]; then
  rm -f "$PID_FILE"
  echo "PID file was empty; cleaned."
  exit 0
fi

if kill -0 "$pid" 2>/dev/null; then
  kill "$pid" 2>/dev/null || true
  echo "Stopped Paper Workbench (PID: $pid)"
else
  echo "Process not running (stale PID: $pid)"
fi

rm -f "$PID_FILE"
