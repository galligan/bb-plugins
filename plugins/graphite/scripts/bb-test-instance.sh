#!/usr/bin/env bash
# Run an isolated BB instance for testing this plugin.
#
#   scripts/bb-test-instance.sh start          # launch and wait for ready
#   scripts/bb-test-instance.sh install        # build + install this plugin into it
#   scripts/bb-test-instance.sh run <args...>  # run a bb command against it
#   scripts/bb-test-instance.sh status
#   scripts/bb-test-instance.sh stop
#   eval "$(scripts/bb-test-instance.sh env)"  # bind this shell to it (bash/zsh)
#
# Never touches the live instance. See .agents/plans/20260918-init/testing-setup.md.
set -euo pipefail

APP_ROOT=${BB_APP_ROOT:-/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app}
APP_BIN=${BB_APP_BIN:-/Applications/bb.app/Contents/MacOS/bb}
DATA_DIR=${BB_TEST_DATA_DIR:-/tmp/bb-graphite-test/data}
SERVER_PORT=${BB_TEST_SERVER_PORT:-19100}
DAEMON_PORT=${BB_TEST_DAEMON_PORT:-27100}
SERVER_URL="http://127.0.0.1:${SERVER_PORT}"
LOG_FILE="$(dirname "$DATA_DIR")/bb-app.log"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { printf 'bb-test-instance: %s\n' "$1" >&2; exit 1; }

# BB's native SQLite binding is built for Electron's ABI, so the app's own binary is
# the runtime, not a system node.
bb_app() {
  ELECTRON_RUN_AS_NODE=1 "$APP_BIN" "$APP_ROOT/dist/bb-app.js" "$@"
}

bb_cli() {
  BB_SERVER_URL="$SERVER_URL" BB_DATA_DIR="$DATA_DIR" \
    ELECTRON_RUN_AS_NODE=1 "$APP_BIN" "$APP_ROOT/dist/bb.js" "$@"
}

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

require_app() {
  [ -x "$APP_BIN" ] || die "no BB app binary at $APP_BIN (set BB_APP_BIN)"
  [ -f "$APP_ROOT/dist/bb-app.js" ] || die "no bb-app entrypoint under $APP_ROOT (set BB_APP_ROOT)"
}

cmd_start() {
  require_app
  if bb_cli plugin list --json >/dev/null 2>&1; then
    printf 'already running on %s\n' "$SERVER_URL"
    cmd_env
    return 0
  fi
  for port in "$SERVER_PORT" "$DAEMON_PORT"; do
    port_busy "$port" && die "port $port is in use; set BB_TEST_SERVER_PORT / BB_TEST_DAEMON_PORT"
  done

  mkdir -p "$(dirname "$LOG_FILE")"
  bb_app --data-dir "$DATA_DIR" \
         --server-port "$SERVER_PORT" \
         --host-daemon-port "$DAEMON_PORT" \
         >"$LOG_FILE" 2>&1 &

  for _ in $(seq 1 40); do
    if bb_cli plugin list --json >/dev/null 2>&1; then
      printf 'ready on %s (data %s, log %s)\n' "$SERVER_URL" "$DATA_DIR" "$LOG_FILE"
      cmd_env
      return 0
    fi
    sleep 0.5
  done
  die "did not become ready in 20s; see $LOG_FILE"
}

cmd_stop() {
  require_app
  bb_app stop --data-dir "$DATA_DIR"
}

cmd_status() {
  require_app
  if bb_cli plugin list --json >/dev/null 2>&1; then
    printf 'running on %s\n' "$SERVER_URL"
    bb_cli plugin list --json |
      python3 -c 'import json,sys; [print("  " + p["id"], p["version"], p["status"]) for p in json.load(sys.stdin)["plugins"] if p["provenance"] != "builtin"]'
  else
    printf 'not running (%s)\n' "$SERVER_URL"
  fi
}

cmd_install() {
  require_app
  (cd "$PLUGIN_DIR" && ELECTRON_RUN_AS_NODE=1 "$APP_BIN" "$APP_ROOT/dist/bb.js" plugin build)
  bb_cli plugin install "$PLUGIN_DIR" --yes
}

cmd_env() {
  printf 'export BB_SERVER_URL=%s\n' "$SERVER_URL"
  printf 'export BB_DATA_DIR=%s\n' "$DATA_DIR"
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  install) cmd_install ;;
  env) cmd_env ;;
  run) shift; require_app; bb_cli "$@" ;;
  *) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
