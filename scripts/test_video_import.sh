#!/usr/bin/env bash
#
# Test the video import endpoint with real Veo and Trace URLs.
#
# Prerequisites:
#   - Backend running: cd src/backend && uvicorn app.main:app --reload
#   - Dev environment (X-User-ID header enabled)
#
# Usage:
#   bash scripts/test_video_import.sh [base_url]
#   bash scripts/test_video_import.sh http://localhost:8000
#   bash scripts/test_video_import.sh https://reel-ballers-api-staging.fly.dev

set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"

# -- Auth: get a session via test-login (dev/staging only) --
echo "=== Authenticating via test-login ==="
LOGIN_RESP=$(curl -s -c /tmp/rb-cookies.txt \
  -X POST "$BASE_URL/api/auth/test-login" \
  -H "X-Test-Mode: true")
echo "$LOGIN_RESP" | python -m json.tool 2>/dev/null || echo "$LOGIN_RESP"

# Extract user_id from the response
USER_ID=$(echo "$LOGIN_RESP" | python -c "import sys,json; print(json.load(sys.stdin).get('user_id',''))" 2>/dev/null || echo "")
if [ -z "$USER_ID" ]; then
  echo "ERROR: Could not extract user_id from test-login response"
  exit 1
fi
echo "User ID: $USER_ID"

# Get profile_id (first profile for the user)
echo ""
echo "=== Getting profile ==="
PROFILES_RESP=$(curl -s -b /tmp/rb-cookies.txt "$BASE_URL/api/profiles")
PROFILE_ID=$(echo "$PROFILES_RESP" | python -c "
import sys, json
profiles = json.load(sys.stdin)
if isinstance(profiles, list) and profiles:
    print(profiles[0].get('id', ''))
else:
    print('')
" 2>/dev/null || echo "")

if [ -z "$PROFILE_ID" ]; then
  echo "No profile found. Creating one..."
  CREATE_PROF=$(curl -s -b /tmp/rb-cookies.txt \
    -X POST "$BASE_URL/api/profiles" \
    -H "Content-Type: application/json" \
    -d '{"name": "Test Profile"}')
  PROFILE_ID=$(echo "$CREATE_PROF" | python -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
fi
echo "Profile ID: $PROFILE_ID"

# Common headers for authenticated requests
AUTH_HEADERS=(-b /tmp/rb-cookies.txt -H "X-Profile-ID: $PROFILE_ID")

poll_import() {
  local import_id="$1"
  local label="$2"
  local max_polls=120  # 10 minutes at 5s intervals

  echo ""
  echo "--- Polling $label import: $import_id ---"
  for i in $(seq 1 $max_polls); do
    PROG=$(curl -s "${AUTH_HEADERS[@]}" "$BASE_URL/api/games/imports/$import_id/progress")
    STATUS=$(echo "$PROG" | python -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "unknown")
    PCT=$(echo "$PROG" | python -c "import sys,json; print(json.load(sys.stdin).get('progress_pct',0))" 2>/dev/null || echo "0")
    GAME_ID=$(echo "$PROG" | python -c "import sys,json; print(json.load(sys.stdin).get('game_id',''))" 2>/dev/null || echo "")
    ERROR=$(echo "$PROG" | python -c "import sys,json; print(json.load(sys.stdin).get('error','') or '')" 2>/dev/null || echo "")

    echo "  [$i] status=$STATUS progress=${PCT}%"

    if [ "$STATUS" = "complete" ]; then
      echo "  SUCCESS! game_id=$GAME_ID"
      return 0
    elif [ "$STATUS" = "error" ]; then
      echo "  FAILED: $ERROR"
      return 1
    fi

    sleep 5
  done

  echo "  TIMEOUT: import did not complete in time"
  return 1
}

# ============================================================
# Test 1: Veo import
# ============================================================
echo ""
echo "=========================================="
echo "  TEST 1: Veo Link Import"
echo "=========================================="

VEO_URL="https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3/"

echo "POST /api/games/import-url (Veo)"
VEO_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" "${AUTH_HEADERS[@]}" \
  -X POST "$BASE_URL/api/games/import-url" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$VEO_URL\", \"game_type\": \"away\"}")

VEO_HTTP=$(echo "$VEO_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
VEO_BODY=$(echo "$VEO_RESP" | grep -v "HTTP_CODE:")
echo "HTTP $VEO_HTTP"
echo "$VEO_BODY" | python -m json.tool 2>/dev/null || echo "$VEO_BODY"

VEO_IMPORT_ID=$(echo "$VEO_BODY" | python -c "import sys,json; print(json.load(sys.stdin).get('import_id',''))" 2>/dev/null || echo "")

if [ -n "$VEO_IMPORT_ID" ]; then
  poll_import "$VEO_IMPORT_ID" "Veo"
else
  echo "ERROR: No import_id in response"
fi

# ============================================================
# Test 2: Trace import
# ============================================================
echo ""
echo "=========================================="
echo "  TEST 2: Trace Link Import"
echo "=========================================="

TRACE_URL="https://go.traceup.com/traceid/athlete/SD3TRsE6-/watch/10046397/players?mtm_campaign=gg&mtm_keywords=copy"

echo "POST /api/games/import-url (Trace)"
TRACE_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" "${AUTH_HEADERS[@]}" \
  -X POST "$BASE_URL/api/games/import-url" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$TRACE_URL\"}")

TRACE_HTTP=$(echo "$TRACE_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
TRACE_BODY=$(echo "$TRACE_RESP" | grep -v "HTTP_CODE:")
echo "HTTP $TRACE_HTTP"
echo "$TRACE_BODY" | python -m json.tool 2>/dev/null || echo "$TRACE_BODY"

TRACE_IMPORT_ID=$(echo "$TRACE_BODY" | python -c "import sys,json; print(json.load(sys.stdin).get('import_id',''))" 2>/dev/null || echo "")

if [ -n "$TRACE_IMPORT_ID" ]; then
  poll_import "$TRACE_IMPORT_ID" "Trace"
else
  echo "ERROR: No import_id in response"
fi

# ============================================================
# Verify: list games to confirm both appear
# ============================================================
echo ""
echo "=========================================="
echo "  Verifying games list"
echo "=========================================="
GAMES=$(curl -s "${AUTH_HEADERS[@]}" "$BASE_URL/api/games")
echo "$GAMES" | python -c "
import sys, json
games = json.load(sys.stdin)
if isinstance(games, list):
    print(f'Total games: {len(games)}')
    for g in games[-5:]:
        print(f'  id={g.get(\"id\")}  name={g.get(\"name\")}  status={g.get(\"status\")}')
else:
    print(games)
" 2>/dev/null || echo "$GAMES"

echo ""
echo "Done."
