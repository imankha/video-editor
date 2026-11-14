#!/usr/bin/env bash
# Run ONE browser check against a production build of the frontend (vite build + vite preview,
# which proxies /api to the local backend on :8000), logged in as the dev preset, and exit 0
# only if every selected test really ran and passed. For a check with a wall-clock budget: the
# container's vite DEV server takes ~10 s to serve its own index.html under host load (T15410
# ruling), which no 10 s budget survives; a built bundle is what staging serves.
# Usage: bash scripts/check_spec_on_preview_build.sh <spec under src/frontend> <grep>
set -euo pipefail
spec="$1"; grep_re="$2"
port="${PREVIEW_PORT:-4173}"
cd "$(dirname "$0")/../src/frontend"
dist=$(mktemp -d); report=$(mktemp); config=".pw-preview-$$.config.mjs"
cleanup() { [ -n "${preview_pid:-}" ] && kill "$preview_pid" 2>/dev/null || true; rm -rf "$dist" "$config"; }
trap cleanup EXIT
node node_modules/vite/bin/vite.js build --outDir "$dist" --emptyOutDir > /tmp/check-preview-build.log 2>&1 \
  || { tail -20 /tmp/check-preview-build.log; exit 1; }
node node_modules/vite/bin/vite.js preview --outDir "$dist" --port "$port" --strictPort > /tmp/check-preview-serve.log 2>&1 &
preview_pid=$!
for _ in $(seq 60); do curl -fsS -o /dev/null "http://localhost:$port/" && break; sleep 1; done
curl -fsS -o /dev/null "http://localhost:$port/api/health" || { echo "preview :$port or backend :8000 not answering"; exit 1; }
cat > "$config" <<CFG
import base from './playwright.config.js';
export default { ...base, webServer: undefined, use: { ...base.use, baseURL: 'http://localhost:$port' } };
CFG
env -u E2E_BASE_URL -u E2E_API_BASE PLAYWRIGHT_JSON_OUTPUT_NAME="$report" \
  npx playwright test -c "$config" "$spec" --grep "$grep_re" --reporter=json,line || true
python3 - "$report" <<'PY'
import json, sys
stats = json.load(open(sys.argv[1]))["stats"]
print(f"expected={stats.get('expected')} skipped={stats.get('skipped')} unexpected={stats.get('unexpected')} flaky={stats.get('flaky')}")
ok = stats.get("expected", 0) >= 1 and not stats.get("skipped") and not stats.get("unexpected") and not stats.get("flaky")
sys.exit(0 if ok else 1)
PY
