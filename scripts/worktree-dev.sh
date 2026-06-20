#!/usr/bin/env bash
# ============================================================================
# worktree-dev.sh — start the full dev stack for an isolated git worktree
# ============================================================================
# Each parallel worktree runs backend + frontend on OFFSET ports so two (or
# more) checkouts never collide. Both talk to the SHARED dev Postgres on 5432.
#
# Reads .worktree-env (written by the /worktree skill) from the worktree root:
#   WT_OFFSET, BACKEND_PORT, FRONTEND_PORT, VITE_API_PORT, WT_PYTHON, MAIN_REPO
#
# Usage (from a worktree root created by /worktree):
#   bash scripts/worktree-dev.sh
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .worktree-env ]; then
  echo "ERROR: .worktree-env not found in $ROOT" >&2
  echo "Run this from a worktree created by the /worktree skill (it writes .worktree-env)." >&2
  exit 1
fi
# shellcheck disable=SC1091
source .worktree-env

: "${BACKEND_PORT:?missing in .worktree-env}"
: "${FRONTEND_PORT:?missing in .worktree-env}"
: "${VITE_API_PORT:?missing in .worktree-env}"
PYTHON="${WT_PYTHON:-src/backend/.venv/Scripts/python.exe}"
LOGDIR="/tmp"
TAG="wt-${WT_OFFSET:-x}"

# 1. Ensure the SHARED dev Postgres (port 5432) is up. Started from the MAIN
#    checkout's compose so all worktrees attach to the one container.
if [ -n "${MAIN_REPO:-}" ] && [ -f "$MAIN_REPO/docker-compose.yml" ]; then
  docker compose -f "$MAIN_REPO/docker-compose.yml" up -d >/dev/null 2>&1 \
    || echo "WARN: could not auto-start shared Postgres; is Docker Desktop running?" >&2
fi

# 2. Backend on the offset port. cwd = src/backend so imports resolve to THIS
#    worktree's code (cwd wins on sys.path); venv is REUSED from MAIN, never copied.
echo "Backend  -> http://localhost:$BACKEND_PORT   (log: $LOGDIR/$TAG-backend.log)"
( cd src/backend && "$PYTHON" -m uvicorn app.main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT" \
    > "$LOGDIR/$TAG-backend.log" 2>&1 ) &
echo "  pid $!"

# 3. Frontend on the offset port. VITE_API_PORT points Vite's proxy at THIS
#    worktree's backend so /api, /storage, /ws route correctly.
echo "Frontend -> http://localhost:$FRONTEND_PORT  (proxy -> :$VITE_API_PORT, log: $LOGDIR/$TAG-frontend.log)"
( cd src/frontend && VITE_API_PORT="$VITE_API_PORT" npm run dev -- --port "$FRONTEND_PORT" \
    > "$LOGDIR/$TAG-frontend.log" 2>&1 ) &
echo "  pid $!"

echo ""
echo "Stack starting for offset ${WT_OFFSET:-x}. Open: http://localhost:$FRONTEND_PORT"
echo "Tail logs: reduce_log({ file: \"$LOGDIR/$TAG-backend.log\", tail: 200 })"
