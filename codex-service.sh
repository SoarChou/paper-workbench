#!/bin/sh
set -eu

ACTION="${1:-status}"

INSTALL_BASE="${PAPER_WORKBENCH_HOME:-$HOME/.paper-workbench}"
PORT="${PAPER_READER_PORT:-8877}"
SERVICE_LABEL="${PAPER_WORKBENCH_SERVICE_LABEL:-com.paperworkbench.server}"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SERVER_DIR="$SCRIPT_DIR/paper-reader-ai-branch"
RUNTIME_DIR="$INSTALL_BASE/runtime"
LOG_DIR="$INSTALL_BASE/logs"
PID_FILE="$RUNTIME_DIR/server.pid"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENT_DIR/$SERVICE_LABEL.plist"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

xml_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

is_darwin() {
  [ "$(uname -s 2>/dev/null || true)" = "Darwin" ]
}

write_plist() {
  mkdir -p "$LAUNCH_AGENT_DIR"
  command_str=$(xml_escape "cd \"$SERVER_DIR\" && PAPER_READER_PORT=\"$PORT\" python3 server.py")
  server_dir_xml=$(xml_escape "$SERVER_DIR")
  out_log_xml=$(xml_escape "$LOG_DIR/launchd.out.log")
  err_log_xml=$(xml_escape "$LOG_DIR/launchd.err.log")
  label_xml=$(xml_escape "$SERVICE_LABEL")

  cat >"$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$label_xml</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/sh</string>
      <string>-lc</string>
      <string>$command_str</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$server_dir_xml</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PAPER_READER_PORT</key>
      <string>$PORT</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$out_log_xml</string>
    <key>StandardErrorPath</key>
    <string>$err_log_xml</string>
  </dict>
</plist>
EOF
}

launchd_bootout() {
  uid_num=$(id -u)
  launchctl bootout "gui/$uid_num/$SERVICE_LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
}

launchd_bootstrap() {
  uid_num=$(id -u)
  launchctl bootstrap "gui/$uid_num" "$PLIST_PATH" >/dev/null 2>&1 || launchctl load -w "$PLIST_PATH" >/dev/null 2>&1 || true
  launchctl enable "gui/$uid_num/$SERVICE_LABEL" >/dev/null 2>&1 || true
}

launchd_kickstart() {
  uid_num=$(id -u)
  launchctl kickstart -k "gui/$uid_num/$SERVICE_LABEL" >/dev/null 2>&1 || launchctl start "$SERVICE_LABEL" >/dev/null 2>&1 || true
}

launchd_status() {
  uid_num=$(id -u)
  if launchctl print "gui/$uid_num/$SERVICE_LABEL" >/tmp/paper-workbench-launchd-status.txt 2>&1; then
    pid_line=$(grep -m 1 'pid = ' /tmp/paper-workbench-launchd-status.txt || true)
    printf 'running (launchd): %s\n' "${pid_line:-pid unknown}"
    rm -f /tmp/paper-workbench-launchd-status.txt
    return 0
  fi
  rm -f /tmp/paper-workbench-launchd-status.txt
  echo "stopped (launchd)"
  return 1
}

start_fallback() {
  if [ -f "$PID_FILE" ]; then
    old_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "${old_pid:-}" ] && kill -0 "$old_pid" 2>/dev/null; then
      echo "already running (pid: $old_pid)"
      echo "URL: http://127.0.0.1:$PORT/web/"
      return 0
    fi
  fi

  stamp=$(date +%Y%m%d-%H%M%S)
  log_file="$LOG_DIR/server-$stamp.log"
  (
    cd "$SERVER_DIR"
    PAPER_READER_PORT="$PORT" nohup python3 server.py >"$log_file" 2>&1 &
    echo $! > "$PID_FILE"
  )
  sleep 1
  pid_now=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -z "${pid_now:-}" ] || ! kill -0 "$pid_now" 2>/dev/null; then
    echo "failed to start (fallback). log: $log_file" >&2
    return 1
  fi
  echo "started (pid: $pid_now)"
  echo "URL: http://127.0.0.1:$PORT/web/"
  echo "Log: $log_file"
}

stop_fallback() {
  if [ ! -f "$PID_FILE" ]; then
    echo "stopped (no pid file)"
    return 0
  fi
  pid_now=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "${pid_now:-}" ] && kill -0 "$pid_now" 2>/dev/null; then
    kill "$pid_now" 2>/dev/null || true
    echo "stopped (pid: $pid_now)"
  else
    echo "stopped (stale pid file)"
  fi
  rm -f "$PID_FILE"
}

status_fallback() {
  if [ ! -f "$PID_FILE" ]; then
    echo "stopped (no pid file)"
    return 1
  fi
  pid_now=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "${pid_now:-}" ] && kill -0 "$pid_now" 2>/dev/null; then
    echo "running (pid: $pid_now)"
    return 0
  fi
  echo "stopped (stale pid: ${pid_now:-unknown})"
  return 1
}

ensure_server_dir() {
  if [ ! -f "$SERVER_DIR/server.py" ]; then
    echo "server.py not found under: $SERVER_DIR" >&2
    exit 1
  fi
}

ensure_server_dir

case "$ACTION" in
  install)
    if is_darwin; then
      write_plist
      launchd_bootout
      launchd_bootstrap
      launchd_kickstart
      launchd_status || true
      echo "URL: http://127.0.0.1:$PORT/web/"
    else
      start_fallback
    fi
    ;;
  start)
    if is_darwin; then
      if [ ! -f "$PLIST_PATH" ]; then
        write_plist
      fi
      launchd_bootstrap
      launchd_kickstart
      launchd_status || true
      echo "URL: http://127.0.0.1:$PORT/web/"
    else
      start_fallback
    fi
    ;;
  stop)
    if is_darwin; then
      launchd_bootout
      echo "stopped (launchd)"
    else
      stop_fallback
    fi
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    if is_darwin; then
      launchd_status
    else
      status_fallback
    fi
    ;;
  uninstall)
    if is_darwin; then
      launchd_bootout
      rm -f "$PLIST_PATH"
      echo "uninstalled launchd service: $SERVICE_LABEL"
    else
      stop_fallback
    fi
    ;;
  *)
    echo "Usage: sh codex-service.sh {install|start|stop|restart|status|uninstall}" >&2
    exit 1
    ;;
esac
