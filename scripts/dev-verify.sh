#!/usr/bin/env bash
# ============================================================================
# dev-verify.sh -- self-verify a change in the LIVE app from inside a /dotask
#                  container (start the stack + run a Playwright spec as a real
#                  user), so a container worker can do everything the supervisor
#                  used to do for live verification.
# ============================================================================
# Run it from INSIDE a /dotask container (cwd-independent; cd's to repo root):
#   bash scripts/dev-verify.sh e2e/<spec>.spec.js [extra playwright args...]
#
# It:
#   1. starts backend+frontend via .devcontainer/container-stack.sh -- which
#      rewrites the DB host localhost -> host.docker.internal so the app reaches
#      the shared dev Postgres on the host (it does NOT edit .env) -- but only if
#      the stack isn't already answering (idempotent);
#   2. waits (~60s cap) for the frontend and the backend /api/health to answer;
#   3. self-heals the baked chromium if the @playwright/test version drifted;
#   4. runs `npx playwright test <spec> --reporter=line`, passing through extra
#      args, and exits with Playwright's exit code.
#
# Auth: realAuth specs dev-login as a real user via POST /api/auth/dev-login
# (gated to APP_ENV=dev, which the container .env sets). The spec's email must
# exist in this env's Postgres -- seed one with scripts/copy_user_between_envs.py
# if dev-login 404s on the user.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."  # -> /workspace (repo root), like container-stack.sh

[ "$#" -ge 1 ] || { echo "usage: bash scripts/dev-verify.sh e2e/<spec>.spec.js [extra playwright args...]" >&2; exit 2; }
SPEC="$1"; shift

# T4120 D3: verify ALWAYS renders locally (no Modal in-container). Export before
# the stack starts so uvicorn inherits it; python-dotenv won't override an env var
# already set, so .env's MODAL_ENABLED=true is ignored for the verify backend.
# STACK_RELOAD=0 drops uvicorn --reload (the shutdown-hang source) for verify runs.
export MODAL_ENABLED="${MODAL_ENABLED:-false}"
export STACK_RELOAD="${STACK_RELOAD:-0}"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOGDIR="${LOGDIR:-/tmp}"
# Health-wait cap in seconds (raised default: first local ffmpeg render + R2 buffering is slow).
DEV_VERIFY_TIMEOUT="${DEV_VERIFY_TIMEOUT:-120}"

# Reap any stray Playwright/Chromium node workers on exit so an orphaned WebSocket
# can't survive to wedge a reused stack's next shutdown.
reap_orphans() { pkill -f 'playwright.*(chromium|driver)' 2>/dev/null || true; }
trap reap_orphans EXIT

fe_url="http://localhost:$FRONTEND_PORT"
health_url="http://localhost:$BACKEND_PORT/api/health"

stack_up() {
  curl -fsS "$fe_url" >/dev/null 2>&1 && curl -fsS "$health_url" >/dev/null 2>&1
}

# --- 1. start the stack only if it isn't already up (idempotent) -------------
if stack_up; then
  echo "[verify] stack already up (frontend :$FRONTEND_PORT + backend health) -- reusing it"
else
  echo "[verify] starting app stack via container-stack.sh (DB -> host.docker.internal)..."
  bash .devcontainer/container-stack.sh
fi

# --- 2. wait for frontend + backend health (DEV_VERIFY_TIMEOUT cap) -----------
echo "[verify] waiting for $fe_url and $health_url (cap ${DEV_VERIFY_TIMEOUT}s) ..."
attempts=$(( DEV_VERIFY_TIMEOUT / 2 )); [ "$attempts" -lt 1 ] && attempts=1
for i in $(seq 1 "$attempts"); do
  if stack_up; then
    echo "[verify] stack is up."
    break
  fi
  if [ "$i" -eq "$attempts" ]; then
    echo "[verify] FAIL: servers did not come up in ${DEV_VERIFY_TIMEOUT}s." >&2
    echo "[verify] inspect the logs (use reduce_log, do NOT cat): $LOGDIR/backend.log $LOGDIR/frontend.log" >&2
    echo "[verify] a DB connection error in backend.log usually means the host dev Postgres" >&2
    echo "[verify] isn't reachable at host.docker.internal:5432 (must listen on 0.0.0.0)." >&2
    exit 1
  fi
  sleep 2
done

# --- 3. self-heal chromium (only when missing; capped so it can't hang) ------
# The image bakes chromium for the pinned @playwright/test. Re-running
# `playwright install` re-validates over the network and HANGS in a
# network-restricted container (observed: it wedged the whole verify run), so
# skip it when a baked chromium is present and cap it when it isn't.
_pw_browsers="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if ls "$_pw_browsers"/chromium-* >/dev/null 2>&1; then
  echo "[verify] chromium present in $_pw_browsers -> skipping self-heal"
else
  echo "[verify] chromium not found -> installing (capped 120s)..."
  ( cd src/frontend && timeout 120 npx playwright install chromium ) >/dev/null 2>&1 \
    || echo "[verify] WARN: chromium install failed/timed out; relying on any baked browser" >&2
fi

# --- 4. run the spec ---------------------------------------------------------
echo "[verify] running: npx playwright test \"$SPEC\" --reporter=line $*"
set +e
( cd src/frontend && npx playwright test "$SPEC" --reporter=line "$@" )
rc=$?
set -e

if [ "$rc" -eq 0 ]; then
  echo "[verify] PASS: $SPEC"
else
  echo "[verify] FAIL ($rc): $SPEC" >&2
  echo "[verify] if it's an auth/DB error, reduce_log $LOGDIR/backend.log (dev-login needs the" >&2
  echo "[verify] spec's email in this env's Postgres -- seed with scripts/copy_user_between_envs.py)." >&2
fi
exit "$rc"
