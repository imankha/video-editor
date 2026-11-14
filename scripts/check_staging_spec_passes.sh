#!/usr/bin/env bash
# Run ONE browser check against staging and exit 0 only if every selected test really ran
# and passed. Playwright counts a self-skipped test as ok; this does not (T16000: T15740's
# check skipped itself on staging, which proved nothing).
# Usage: bash scripts/check_staging_spec_passes.sh <spec under src/frontend> <grep>
set -euo pipefail
spec="$1"; grep_re="$2"
cd "$(dirname "$0")/../src/frontend"
report=$(mktemp)
E2E_BASE_URL="${E2E_BASE_URL:-https://reel-ballers-staging.pages.dev}" \
E2E_API_BASE="${E2E_API_BASE:-https://reel-ballers-api-staging.fly.dev/api}" \
E2E_CHECK_EMAIL="${E2E_CHECK_EMAIL:-e2e-gate@test.local}" \
PLAYWRIGHT_JSON_OUTPUT_NAME="$report" \
  npx playwright test "$spec" --grep "$grep_re" --reporter=json,line || true
python3 - "$report" <<'PY'
import json, sys
stats = json.load(open(sys.argv[1]))["stats"]
print(f"expected={stats.get('expected')} skipped={stats.get('skipped')} unexpected={stats.get('unexpected')} flaky={stats.get('flaky')}")
ok = stats.get("expected", 0) >= 1 and not stats.get("skipped") and not stats.get("unexpected") and not stats.get("flaky")
sys.exit(0 if ok else 1)
PY
