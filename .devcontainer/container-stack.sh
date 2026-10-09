#!/usr/bin/env bash
# Starts the full app stack INSIDE a task sandbox container.
#
# Run it from inside a task container (cwd = /workspace):
#   bash .devcontainer/container-stack.sh
# or from the host via the launcher:
#   bash scripts/task.sh stack <id>
#
# The container's internal ports are FIXED (8000 backend / 5173 frontend);
# `scripts/task` publishes them to the per-task OFFSET host ports, so two task
# containers never collide on the host even though both use 8000/5173 inside.
#
# DB: the app's .env points DATABASE_URL at localhost:5432, but inside the
# container "localhost" is the container itself. We rewrite the host to
# host.docker.internal so the app reaches the shared dev Postgres on the
# Windows host (the launcher wires --add-host=host.docker.internal). We do NOT
# edit .env -- we export an override; python-dotenv's load_dotenv() does not
# override an already-set env var, so this wins.
set -euo pipefail
cd "${STACK_ROOT:-$(dirname "$0")/..}"  # -> /workspace (task.sh runs a /tmp copy with STACK_ROOT set)

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOGDIR="${LOGDIR:-/tmp}"

# --- stop a previous stack -----------------------------------------------------
# Every start is a restart, so the servers hold the current working tree (a long-lived Vite in
# this container has served stale modules: project_container_vite_stale_bind_mount_edits). The
# image has no ps/pkill, so match /proc/*/cmdline. `--stop` stops and exits (task.sh runs it
# synchronously before a detached start, so a health wait can't hit the old servers).
# A stack process is identified by argv[0] AND its arguments, never a bare substring: a shell
# whose command text merely mentions "npm run dev" must survive.
cmdline_of() { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null; }
is_stack_process() {  # <pid> <cmdline>
  local base="${2%% *}" ppid; base="${base##*/}"
  case "$base" in
    python*|uvicorn*)
      case "$2" in
        *"uvicorn app.main:app"*) return 0 ;;
        *"spawn_main"*)  # uvicorn --reload's worker: only when its parent is our uvicorn
          ppid="$(awk '/^PPid:/ {print $2}' "/proc/$1/status" 2>/dev/null)"
          case "$(cmdline_of "$ppid")" in *"uvicorn app.main:app"*) return 0 ;; esac ;;
      esac ;;
    node) case "$2" in *"node_modules/.bin/vite"*) return 0 ;; esac ;;
    npm) case "$2" in *"npm run dev"*) return 0 ;; esac ;;
  esac
  return 1
}
# PID 1 is `sleep infinity` (no init), so a killed child can linger as a zombie: count it as gone.
alive_pid() { [ -d "/proc/$1" ] && ! grep -q '^State:[[:space:]]*Z' "/proc/$1/status" 2>/dev/null; }
stop_stack() {
  local p pid cmd pids=""
  for p in /proc/[0-9]*; do
    pid="${p#/proc/}"; [ "$pid" = "$$" ] && continue
    cmd="$(cmdline_of "$pid")" || continue
    is_stack_process "$pid" "$cmd" && pids="$pids $pid"
  done
  # Fresh logs: task.sh's wait fast-fails on a startup failure it finds in backend.log.
  : > "$LOGDIR/backend.log" 2>/dev/null || true
  : > "$LOGDIR/frontend.log" 2>/dev/null || true
  [ -n "$pids" ] || return 0
  echo "[stack] stopping previous stack (pids:$pids)"
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 20); do
    local alive=""
    for pid in $pids; do alive_pid "$pid" && alive=1; done
    [ -z "$alive" ] && return 0
    sleep 0.5
  done
  kill -9 $pids 2>/dev/null || true
}
stop_stack
[ "${1:-}" = "--stop" ] && exit 0

# --- Modal default -------------------------------------------------------------
# In-container there is no ~/.modal.toml unless tokens were provisioned, so a
# stack started with .env's MODAL_ENABLED=true would crash exports. Default OFF
# (local ffmpeg render path) unless the caller set it or provided tokens.
if [ -z "${MODAL_ENABLED:-}" ]; then
  if [ -n "${MODAL_TOKEN_ID:-}" ]; then export MODAL_ENABLED=true; else export MODAL_ENABLED=false; fi
  echo "[stack] MODAL_ENABLED=$MODAL_ENABLED (container default; set MODAL_TOKEN_ID/MODAL_ENABLED to override)"
fi

# --- DB host rewrite ---------------------------------------------------------
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  RAW="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"
  RAW="${RAW//$'\r'/}"   # .env is copied from the Windows host with CRLF endings;
                         # strip the trailing CR or the DB name becomes "..._dev\r".
  if [ -n "$RAW" ]; then
    export DATABASE_URL="${RAW/@localhost:/@host.docker.internal:}"
    export DATABASE_URL="${DATABASE_URL/@127.0.0.1:/@host.docker.internal:}"
    echo "[stack] DATABASE_URL -> host.docker.internal (was localhost)"
  fi
fi

# --- backend -----------------------------------------------------------------
# STACK_RELOAD=1 (default) keeps uvicorn --reload for interactive dev. dev-verify
# exports STACK_RELOAD=0: --reload + an orphaned Playwright WebSocket is the known
# shutdown-hang source, and a verify stack has no code-edit loop to need reload.
# --timeout-graceful-shutdown 5 caps how long a stuck connection can wedge exit.
STACK_RELOAD="${STACK_RELOAD:-1}"
reload_flag=""; [ "$STACK_RELOAD" = "1" ] && reload_flag="--reload"
echo "[stack] backend  -> container :$BACKEND_PORT   (reload=$STACK_RELOAD, log: $LOGDIR/backend.log)"
( cd src/backend && uvicorn app.main:app $reload_flag --timeout-graceful-shutdown 5 \
    --host 0.0.0.0 --port "$BACKEND_PORT" \
    > "$LOGDIR/backend.log" 2>&1 ) &
echo "  pid $!"

# --- frontend ----------------------------------------------------------------
# Gate on the deps install task.sh kicked off in the background (`npm ci` writes
# node_modules/.ready when done) -- starting vite mid-install crashes confusingly.
if [ ! -f src/frontend/node_modules/.ready ] && [ ! -x src/frontend/node_modules/.bin/vite ]; then
  echo "[stack] frontend deps still installing (npm ci in background); waiting up to 180s..."
  for i in $(seq 1 90); do
    { [ -f src/frontend/node_modules/.ready ] || [ -x src/frontend/node_modules/.bin/vite ]; } && break
    sleep 2
  done
fi

# --host 0.0.0.0 so the published host port can reach it. Vite proxies /api to
# the backend on localhost:$BACKEND_PORT (same container), which is the default.
# --strictPort: a busy port must fail loudly, not move Vite to an unpublished port.
echo "[stack] frontend -> container :$FRONTEND_PORT  (log: $LOGDIR/frontend.log)"
( cd src/frontend && VITE_API_PORT="$BACKEND_PORT" npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" --strictPort \
    > "$LOGDIR/frontend.log" 2>&1 ) &
echo "  pid $!"

echo ""
echo "[stack] starting. From the HOST open the OFFSET frontend port the launcher printed."
echo "[stack] tail logs inside the container: tail -f $LOGDIR/backend.log"
