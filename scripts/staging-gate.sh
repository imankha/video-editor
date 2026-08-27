#!/usr/bin/env bash
# T7800: Staging Gate v2 runner — the pre-manual-test runbook step.
#
# Runs the @staging-gate e2e subset against STAGING as three concurrent Playwright
# processes (lanes), each with its own account env (specs read E2E_REAL_EMAIL /
# E2E_REAL_PROFILE at import time, so per-PROCESS env is the account seam —
# Playwright projects cannot set per-project env):
#
#   lane A (@gate-a)  imankh          — ALL heavy writes (export pipeline, publish, shares)
#   lane B (@gate-b)  second account  — browsing + light writes
#   lane C (@gate-c)  second account  — mocked public viewers + slow reads
#
# Lanes A vs B/C use DIFFERENT accounts: concurrent write sessions on one account
# cause stale_baseline R2 CAS freezes. See src/frontend/e2e/STAGING-GATE.md.
#
# PRE-REQ (runbook step 0, idempotent — see FIXTURE-CONTRACT.md § Seeding):
#   both fixture accounts seeded, which also resets drift from prior gate runs and
#   guarantees the export spec a framed draft (its fast 2-6 min path):
#     cd src/backend && .venv/Scripts/python.exe ../../scripts/copy_user_between_envs.py \
#         --email imankh@gmail.com --from dev --to staging --dest-machines-stopped
#     ... and again with:  --to-email "$GATE2_EMAIL"
#   (then restart the staging machines — see memory: restart staging after reset)
#
# Usage: bash scripts/staging-gate.sh
# Env overrides: E2E_BASE_URL, E2E_API_BASE, GATE1_EMAIL/GATE1_PROFILE (lane A),
#                GATE2_EMAIL/GATE2_PROFILE (lanes B+C).
set -u

BASE_URL="${E2E_BASE_URL:-https://reel-ballers-staging.pages.dev}"
API_BASE="${E2E_API_BASE:-https://reel-ballers-api-staging.fly.dev/api}"
GATE1_EMAIL="${GATE1_EMAIL:-imankh@gmail.com}"
GATE1_PROFILE="${GATE1_PROFILE:-9fa7378c}"
# The alias clone mirrors imankh's data, so its profile GUID is the same.
GATE2_EMAIL="${GATE2_EMAIL:-e2e-gate@test.local}"
GATE2_PROFILE="${GATE2_PROFILE:-9fa7378c}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$REPO_ROOT/src/frontend"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "=== Staging Gate v2 (T7800) ==="
echo "target:   $BASE_URL"
echo "api:      $API_BASE"
echo "lane A:   $GATE1_EMAIL ($GATE1_PROFILE)"
echo "lanes BC: $GATE2_EMAIL ($GATE2_PROFILE)"
echo

# --- 1. Warm the API (staging cold start is ~145s) --------------------------------
echo "[gate] warming $API_BASE/health (staging cold start can take ~145s)..."
warm_ok=0
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Test-Mode: true' "$API_BASE/health" || true)"
  if [ "$code" = "200" ]; then warm_ok=1; break; fi
  sleep 5
done
if [ "$warm_ok" != "1" ]; then
  echo "[gate] FATAL: $API_BASE/health never returned 200 (last=$code). Staging API is down."
  exit 1
fi
echo "[gate] API warm."

# --- 2. Verify both fixture accounts exist (dev-login probe) ----------------------
for acct in "$GATE1_EMAIL" "$GATE2_EMAIL"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/auth/dev-login" \
    -H 'Content-Type: application/json' -H 'X-Test-Mode: true' \
    -d "{\"email\": \"$acct\"}" || true)"
  # A 5xx can be the staging PG stale-pool blip — one retry.
  if [ "${code:0:1}" = "5" ]; then
    sleep 3
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/auth/dev-login" \
      -H 'Content-Type: application/json' -H 'X-Test-Mode: true' \
      -d "{\"email\": \"$acct\"}" || true)"
  fi
  if [ "$code" != "200" ]; then
    echo "[gate] FATAL: dev-login for $acct returned $code — seed it first (FIXTURE-CONTRACT.md § Seeding)."
    exit 1
  fi
  echo "[gate] fixture account OK: $acct"
done
echo

# --- 3. Launch the three lanes concurrently ---------------------------------------
cd "$FRONTEND"
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
run_lane c "$GATE2_EMAIL" "$GATE2_PROFILE" & pid_c=$!

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
  echo "  lane $lane: $verdict   log: src/frontend/test-results/gate-$lane-$STAMP.log   report: src/frontend/test-results/gate-$lane-$STAMP/html"
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
