#!/usr/bin/env bash
# T7800: Staging Gate v2 runner — the pre-manual-test runbook step.
#
# Runs the @staging-gate e2e subset against STAGING as three concurrent Playwright
# processes (lanes), each with its own account env (specs read E2E_REAL_EMAIL /
# E2E_REAL_PROFILE at import time, so per-PROCESS env is the account seam —
# Playwright projects cannot set per-project env):
#
#   lane A (@gate-a)  account 1 (imankh, unaliased)          — ALL heavy writes (export pipeline, publish, shares)
#   lane B (@gate-b)  account 2 (arshia+stg, prod alias)     — browsing + light writes
#   lane C (@gate-c)  account 3 (bknoto+stg, prod alias)     — mocked public viewers + slow reads
#
# EVERY lane gets its OWN account: concurrent write sessions on one account cause
# stale_baseline R2 CAS freezes, and even the B/C pairing (light writes + server
# compose) is only provably safe when staging runs a single machine — a second
# machine gives each session its own profile.sqlite copy and the CAS loser
# freezes. Each account is one seed command (--to-email), so no lane shares.
# See src/frontend/e2e/STAGING-GATE.md.
#
# PRE-REQ (runbook step 0, idempotent — see FIXTURE-CONTRACT.md § Seeding):
#   all three fixture accounts seeded, which also resets drift from prior gate
#   runs and guarantees the export spec a framed draft (its fast 2-6 min path).
#   2026-08-31: lanes B/C moved off imankh-clone aliases onto real paying-user
#   accounts copied down from PROD (google_id nulled so they can't OAuth-login as
#   the real user) — copy each straight from prod, not re-derived from dev:
#     cd src/backend && .venv/Scripts/python.exe ../../scripts/copy_user_between_envs.py \
#         --email imankh@gmail.com --from dev --to staging --dest-machines-stopped
#     ... and for lanes B/C, copy the SOURCE prod account with --to-email "$GATE2_EMAIL" /
#         "$GATE3_EMAIL" respectively (see copy_user_between_envs.py --from prod usage)
#   (then restart the staging machines — see memory: restart staging after reset)
#
# Usage: bash scripts/staging-gate.sh
# Env overrides: E2E_BASE_URL, E2E_API_BASE, GATE1_EMAIL/GATE1_PROFILE (lane A),
#                GATE2_EMAIL/GATE2_PROFILE (lane B), GATE3_EMAIL/GATE3_PROFILE (lane C).
set -u

BASE_URL="${E2E_BASE_URL:-https://reel-ballers-staging.pages.dev}"
API_BASE="${E2E_API_BASE:-https://reel-ballers-api-staging.fly.dev/api}"
GATE1_EMAIL="${GATE1_EMAIL:-imankh@gmail.com}"
GATE1_PROFILE="${GATE1_PROFILE:-9fa7378c}"
# 2026-08-31: e2e-gate@test.local / e2e-gate2@test.local were deleted as stale/duplicate
# dev+staging accounts; lanes B/C now use real paying-user data copied down from prod
# (google_id nulled, each aliased under its own +stg address) instead of imankh clones.
GATE2_EMAIL="${GATE2_EMAIL:-arshia+stg@test.local}"
GATE2_PROFILE="${GATE2_PROFILE:-b95eb93b}"
GATE3_EMAIL="${GATE3_EMAIL:-bknoto+stg@test.local}"
GATE3_PROFILE="${GATE3_PROFILE:-e1e28f91}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$REPO_ROOT/src/frontend"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "=== Staging Gate v2 (T7800) ==="
echo "target:  $BASE_URL"
echo "api:     $API_BASE"
echo "lane A:  $GATE1_EMAIL ($GATE1_PROFILE)"
echo "lane B:  $GATE2_EMAIL ($GATE2_PROFILE)"
echo "lane C:  $GATE3_EMAIL ($GATE3_PROFILE)"
echo

# --- 1. Warm the API (staging cold start is ~145s) --------------------------------
echo "[gate] warming $API_BASE/health (staging cold start can take ~145s)..."
warm_ok=0
for _ in $(seq 1 60); do
  code="$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' -H 'X-Test-Mode: true' "$API_BASE/health" || true)"
  if [ "$code" = "200" ]; then warm_ok=1; break; fi
  sleep 5
done
if [ "$warm_ok" != "1" ]; then
  echo "[gate] FATAL: $API_BASE/health never returned 200 (last=${code:-none}). Staging API is down."
  exit 1
fi
echo "[gate] API warm."

# --- 2. Verify all three fixture accounts exist (dev-login probe) -----------------
for acct in "$GATE1_EMAIL" "$GATE2_EMAIL" "$GATE3_EMAIL"; do
  code="$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' -X POST "$API_BASE/auth/dev-login" \
    -H 'Content-Type: application/json' -H 'X-Test-Mode: true' \
    -d "{\"email\": \"$acct\"}" || true)"
  # A 5xx can be the staging PG stale-pool blip — one retry.
  if [ "${code:0:1}" = "5" ]; then
    sleep 3
    code="$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' -X POST "$API_BASE/auth/dev-login" \
      -H 'Content-Type: application/json' -H 'X-Test-Mode: true' \
      -d "{\"email\": \"$acct\"}" || true)"
  fi
  if [ "${code:-none}" != "200" ]; then
    echo "[gate] FATAL: dev-login for $acct returned ${code:-none} — seed it first (FIXTURE-CONTRACT.md § Seeding)."
    exit 1
  fi
  echo "[gate] fixture account OK: $acct"
done
echo

# --- 3. Launch the three lanes concurrently ---------------------------------------
cd "$FRONTEND" || exit 1
run_lane() { # $1=lane letter  $2=email  $3=profile
  E2E_BASE_URL="$BASE_URL" \
  E2E_API_BASE="$API_BASE" \
  E2E_REAL_EMAIL="$2" \
  E2E_REAL_PROFILE="$3" \
  E2E_PROFILE_ID="$3" \
  E2E_RESULTS_DIR="test-results/gate-$1-$STAMP" \
  npx playwright test --grep "@gate-$1" --reporter=line \
    > "test-results/gate-$1-$STAMP.log" 2>&1
}
mkdir -p test-results
start=$(date +%s)
echo "[gate] launching lanes (logs: test-results/gate-{a,b,c}-$STAMP.log)..."
run_lane a "$GATE1_EMAIL" "$GATE1_PROFILE" & pid_a=$!
run_lane b "$GATE2_EMAIL" "$GATE2_PROFILE" & pid_b=$!
run_lane c "$GATE3_EMAIL" "$GATE3_PROFILE" & pid_c=$!

wait "$pid_a"; rc_a=$?
wait "$pid_b"; rc_b=$?
wait "$pid_c"; rc_c=$?
elapsed=$(( $(date +%s) - start ))

# --- 4. Aggregate verdict ---------------------------------------------------------
echo
echo "=== Staging Gate verdict ($((elapsed / 60))m $((elapsed % 60))s wall clock) ==="
overall=0
for lane in a b c; do
  rc_var="rc_$lane"; rc="${!rc_var}"
  if [ "$rc" = "0" ]; then verdict="GREEN"; else verdict="RED (exit $rc)"; overall=1; fi
  # NOTE: --reporter=line REPLACES the config reporters (html/json never run —
  # deliberate: three background lanes must not each open an html report server),
  # so the artifacts dir (traces/screenshots of failures) is the drill-down, not
  # an html report.
  echo "  lane $lane: $verdict   log: src/frontend/test-results/gate-$lane-$STAMP.log   failure artifacts: src/frontend/test-results/gate-$lane-$STAMP/artifacts"
  # Surface loud skips + failures without dumping whole logs.
  grep -E "\[SKIP\]|Error:|failed" "test-results/gate-$lane-$STAMP.log" | head -12 | sed 's/^/    /' || true
done
echo
if [ "$overall" = "0" ]; then
  echo "[gate] GREEN — staging is ready for manual testing."
else
  echo "[gate] RED — inspect the failing lane's log/report before manual testing."
fi
exit "$overall"
