#!/bin/sh
set -eu

SOURCE_INPUT="${1:-.}"
INSTALL_BASE="${PAPER_WORKBENCH_HOME:-$HOME/.paper-workbench}"
PORT="${PAPER_READER_PORT:-8877}"

WORK_DIR="$INSTALL_BASE/runtime"
CACHE_DIR="$INSTALL_BASE/cache"
LOG_DIR="$INSTALL_BASE/logs"
CONFIG_DIR="$INSTALL_BASE/config"
APP_DIR="$WORK_DIR/paper-workbench"
SOURCE_FILE="$CONFIG_DIR/install-source.txt"
VERSION_FILE="$CONFIG_DIR/installed-version.txt"

mkdir -p "$WORK_DIR" "$CACHE_DIR" "$LOG_DIR" "$CONFIG_DIR"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need_cmd python3
need_cmd sh

is_url() {
  case "$1" in
    http://*|https://*) return 0 ;;
    *) return 1 ;;
  esac
}

cleanup_target() {
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR"
}

resolve_repo_root() {
  candidate="$1"

  if [ -f "$candidate/install-skill.sh" ] && [ -d "$candidate/paper-reader-ai-branch" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  nested=$(find "$candidate" -mindepth 1 -maxdepth 3 -type f -name 'install-skill.sh' 2>/dev/null | head -n 1 || true)
  if [ -n "$nested" ]; then
    dirname "$nested"
    return 0
  fi

  return 1
}

install_from_local_dir() {
  src_dir="$1"
  cleanup_target
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude '.git' --exclude '__pycache__' --exclude '.DS_Store' "$src_dir/" "$APP_DIR/"
  else
    cp -R "$src_dir/." "$APP_DIR/"
  fi
}

install_from_zip() {
  zip_path="$1"
  need_cmd unzip
  cleanup_target
  unzip -q "$zip_path" -d "$APP_DIR"

  repo_root=$(resolve_repo_root "$APP_DIR" || true)
  if [ -n "${repo_root:-}" ]; then
    if [ "$repo_root" != "$APP_DIR" ]; then
      tmp="$CACHE_DIR/.tmp-move-$$"
      rm -rf "$tmp"
      mkdir -p "$tmp"
      cp -R "$repo_root/." "$tmp/"
      rm -rf "$APP_DIR"
      mkdir -p "$APP_DIR"
      cp -R "$tmp/." "$APP_DIR/"
      rm -rf "$tmp"
    fi
    return 0
  fi

  echo "Cannot find paper-workbench repo root in zip: $zip_path" >&2
  exit 1
}

install_from_git_url() {
  git_url="$1"
  need_cmd git
  cleanup_target
  git clone --depth 1 "$git_url" "$APP_DIR"
}

install_from_zip_url() {
  zip_url="$1"
  need_cmd curl
  local_zip="$CACHE_DIR/paper-workbench.zip"
  rm -f "$local_zip"
  curl -L --fail --silent --show-error "$zip_url" -o "$local_zip"
  install_from_zip "$local_zip"
}

source_type=""
SOURCE_RECORD="$SOURCE_INPUT"
if [ -d "$SOURCE_INPUT" ]; then
  source_type="dir"
elif [ -f "$SOURCE_INPUT" ]; then
  case "$SOURCE_INPUT" in
    *.zip) source_type="zip" ;;
    *)
      echo "Unsupported local file: $SOURCE_INPUT (expect .zip)" >&2
      exit 1
      ;;
  esac
elif is_url "$SOURCE_INPUT"; then
  case "$SOURCE_INPUT" in
    *.zip) source_type="zip_url" ;;
    *) source_type="git_url" ;;
  esac
else
  echo "Invalid source: $SOURCE_INPUT" >&2
  echo "Usage: sh codex-auto-install.sh <repo_dir | zip_path | zip_url | github_url>" >&2
  exit 1
fi

if [ "$source_type" = "dir" ] || [ "$source_type" = "zip" ]; then
  SOURCE_RECORD=$(CDPATH= cd -- "$(dirname -- "$SOURCE_INPUT")" && pwd)/$(basename -- "$SOURCE_INPUT")
fi

case "$source_type" in
  dir)
    install_from_local_dir "$SOURCE_INPUT"
    ;;
  zip)
    install_from_zip "$SOURCE_INPUT"
    ;;
  zip_url)
    install_from_zip_url "$SOURCE_INPUT"
    ;;
  git_url)
    install_from_git_url "$SOURCE_INPUT"
    ;;
  *)
    echo "Unhandled source type: $source_type" >&2
    exit 1
    ;;
esac

REPO_ROOT=$(resolve_repo_root "$APP_DIR" || true)
if [ -z "$REPO_ROOT" ]; then
  echo "Installed files found, but repo root not recognized." >&2
  exit 1
fi

if [ ! -f "$REPO_ROOT/install-skill.sh" ] || [ ! -f "$REPO_ROOT/start-paper-workbench.sh" ]; then
  echo "Required scripts missing under: $REPO_ROOT" >&2
  exit 1
fi

printf '%s\n' "$SOURCE_RECORD" > "$SOURCE_FILE"
if [ -f "$REPO_ROOT/VERSION" ]; then
  cp "$REPO_ROOT/VERSION" "$VERSION_FILE"
else
  : > "$VERSION_FILE"
fi

sh "$REPO_ROOT/install-skill.sh"

if [ "${PAPER_WORKBENCH_NO_START:-0}" = "1" ]; then
  echo "✅ Paper Workbench installed"
  echo "- Repo: $REPO_ROOT"
  echo "- Start manually: sh \"$REPO_ROOT/start-paper-workbench.sh\""
  exit 0
fi

PID_FILE="$WORK_DIR/server.pid"
if [ -f "$PID_FILE" ]; then
  old_pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "${old_pid:-}" ] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" 2>/dev/null || true
    sleep 1
  fi
fi

stamp=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/server-$stamp.log"
(
  cd "$REPO_ROOT/paper-reader-ai-branch"
  PAPER_READER_PORT="$PORT" nohup python3 server.py >"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
)

sleep 1
new_pid=$(cat "$PID_FILE" 2>/dev/null || true)
if [ -z "${new_pid:-}" ] || ! kill -0 "$new_pid" 2>/dev/null; then
  echo "Service failed to start. Check log: $LOG_FILE" >&2
  exit 1
fi

echo "✅ Paper Workbench installed and started"
echo "- Repo: $REPO_ROOT"
if [ -s "$VERSION_FILE" ]; then
  echo "- Version: $(cat "$VERSION_FILE")"
fi
echo "- URL:  http://127.0.0.1:$PORT/web/"
echo "- PID:  $new_pid"
echo "- Log:  $LOG_FILE"
