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
echo "[stack] backend  -> container :$BACKEND_PORT   (log: $LOGDIR/backend.log)"
( cd src/backend && uvicorn app.main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT" \
    > "$LOGDIR/backend.log" 2>&1 ) &
echo "  pid $!"

# --- frontend ----------------------------------------------------------------
# --host 0.0.0.0 so the published host port can reach it. Vite proxies /api to
# the backend on localhost:$BACKEND_PORT (same container), which is the default.
echo "[stack] frontend -> container :$FRONTEND_PORT  (log: $LOGDIR/frontend.log)"
( cd src/frontend && VITE_API_PORT="$BACKEND_PORT" npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" \
    > "$LOGDIR/frontend.log" 2>&1 ) &
echo "  pid $!"

echo ""
echo "[stack] starting. From the HOST open the OFFSET frontend port the launcher printed."
echo "[stack] tail logs inside the container: tail -f $LOGDIR/backend.log"
