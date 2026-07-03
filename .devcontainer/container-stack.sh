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
cd "$(dirname "$0")/.."  # -> /workspace

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOGDIR="${LOGDIR:-/tmp}"

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
echo "[stack] frontend -> container :$FRONTEND_PORT  (log: $LOGDIR/frontend.log)"
( cd src/frontend && VITE_API_PORT="$BACKEND_PORT" npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" \
    > "$LOGDIR/frontend.log" 2>&1 ) &
echo "  pid $!"

echo ""
echo "[stack] starting. From the HOST open the OFFSET frontend port the launcher printed."
echo "[stack] tail logs inside the container: tail -f $LOGDIR/backend.log"
