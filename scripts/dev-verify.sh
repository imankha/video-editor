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

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOGDIR="${LOGDIR:-/tmp}"

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

# --- 2. wait for frontend + backend health (~60s cap) ------------------------
echo "[verify] waiting for $fe_url and $health_url ..."
for i in $(seq 1 30); do
  if stack_up; then
    echo "[verify] stack is up."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[verify] FAIL: servers did not come up in 60s." >&2
    echo "[verify] inspect the logs (use reduce_log, do NOT cat): $LOGDIR/backend.log $LOGDIR/frontend.log" >&2
    echo "[verify] a DB connection error in backend.log usually means the host dev Postgres" >&2
    echo "[verify] isn't reachable at host.docker.internal:5432 (must listen on 0.0.0.0)." >&2
    exit 1
  fi
  sleep 2
done

# --- 3. self-heal chromium (best-effort; no-op when already matching) --------
# The image bakes chromium for the pinned @playwright/test; if it drifts this
# downloads only the matching browser (system libs are baked, so it's fast).
( cd src/frontend && npx playwright install chromium ) >/dev/null 2>&1 || true

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
