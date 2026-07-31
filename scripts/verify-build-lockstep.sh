#!/usr/bin/env bash
#
# T6220: Assert the deployed frontend bundle and the deployed backend report the
# SAME monotonic build number. The union path filter (deploy-frontend.yml /
# deploy-backend.yml) and the asymmetric --backend-only gate (deploy_production.sh)
# make drift structurally rare; this script is the assertion that keeps that
# invariant from silently rotting if either one is ever bypassed or edited wrong.
# Wired into deploy-frontend.yml (staging, after both concurrent jobs land) and
# deploy_production.sh (prod, only when both halves were actually deployed
# together). Also runnable standalone by a human against any two URLs.
#
# Usage:
#   verify-build-lockstep.sh --frontend-url <site-root> --backend-url <version-url> \
#       [--interval SECONDS] [--timeout SECONDS]
#
# Example:
#   scripts/verify-build-lockstep.sh \
#     --frontend-url https://reel-ballers-staging.pages.dev \
#     --backend-url  https://reel-ballers-api-staging.fly.dev/api/version
#
#   --frontend-url is the site ROOT; the script fetches "<url>/build.json".
#   --backend-url  is the FULL version endpoint (already includes /api/version).
#
# Both halves deploy concurrently from separate workflows/steps, and Cloudflare
# Pages propagation can lag a few seconds behind a successful `wrangler pages
# deploy`, so this POLLS rather than checking once: every --interval seconds
# (default 10) up to --timeout seconds (default 300 = 5 minutes), succeeding the
# instant the two numbers are equal.
#
# Exit 0: numbers equal. Exit 1: timeout, mismatch, or a fetch failure that never
# resolved within the timeout -- always with a loud message naming both build
# numbers (or the specific failure reason). No silent fallbacks (CLAUDE.md): a
# missing build.json (404), a non-200 response, unparseable JSON, or a
# missing/non-numeric `build` field is a FAILURE, never "assume ok".

set -uo pipefail

INTERVAL=10
TIMEOUT=300
FRONTEND_URL=""
BACKEND_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --frontend-url)
      FRONTEND_URL="${2:-}"
      shift 2
      ;;
    --backend-url)
      BACKEND_URL="${2:-}"
      shift 2
      ;;
    --interval)
      INTERVAL="${2:-}"
      shift 2
      ;;
    --timeout)
      TIMEOUT="${2:-}"
      shift 2
      ;;
    *)
      echo "[verify-build-lockstep] ERROR: unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$FRONTEND_URL" || -z "$BACKEND_URL" ]]; then
  echo "[verify-build-lockstep] ERROR: --frontend-url and --backend-url are both required" >&2
  echo "Usage: $0 --frontend-url <site-root> --backend-url <.../api/version> [--interval S] [--timeout S]" >&2
  exit 1
fi

FRONTEND_BUILD_URL="${FRONTEND_URL%/}/build.json"

# Fetch a URL and print the build number on success, or a line starting with
# "ERROR:" describing exactly what went wrong on failure. Return code mirrors
# success/failure so the caller never has to guess from the string.
fetch_build() {
  local url="$1"
  local tmp http_code curl_status build

  tmp=$(mktemp)
  http_code=$(curl -s -o "$tmp" -w '%{http_code}' --max-time 10 "$url" 2>/dev/null)
  curl_status=$?

  if [[ $curl_status -ne 0 ]]; then
    rm -f "$tmp"
    echo "ERROR: curl failed (exit $curl_status) fetching $url"
    return 1
  fi

  if [[ "$http_code" != "200" ]]; then
    rm -f "$tmp"
    echo "ERROR: HTTP $http_code fetching $url"
    return 1
  fi

  build=$(python3 -c '
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except Exception as e:
    print("__PARSE_ERROR__:invalid JSON (" + str(e) + ")")
    sys.exit(0)
build = data.get("build")
if not isinstance(build, (int, float)) or isinstance(build, bool):
    print("__PARSE_ERROR__:missing or non-numeric build field (got " + repr(build) + ")")
    sys.exit(0)
print(int(build))
' "$tmp")
  rm -f "$tmp"

  if [[ "$build" == __PARSE_ERROR__:* ]]; then
    echo "ERROR: unparseable response from $url (${build#__PARSE_ERROR__:})"
    return 1
  fi

  echo "$build"
  return 0
}

echo "[verify-build-lockstep] Polling every ${INTERVAL}s, up to ${TIMEOUT}s total"
echo "[verify-build-lockstep]   frontend: $FRONTEND_BUILD_URL"
echo "[verify-build-lockstep]   backend:  $BACKEND_URL"

start_time=$(date +%s)
attempt=0
last_frontend="<never succeeded>"
last_backend="<never succeeded>"

while true; do
  attempt=$((attempt + 1))

  frontend_result=$(fetch_build "$FRONTEND_BUILD_URL")
  frontend_status=$?
  backend_result=$(fetch_build "$BACKEND_URL")
  backend_status=$?

  if [[ $frontend_status -eq 0 ]]; then
    last_frontend="$frontend_result"
  fi
  if [[ $backend_status -eq 0 ]]; then
    last_backend="$backend_result"
  fi

  if [[ $frontend_status -eq 0 && $backend_status -eq 0 ]]; then
    if [[ "$frontend_result" == "$backend_result" ]]; then
      echo "[verify-build-lockstep] OK: frontend build $frontend_result == backend build $backend_result (attempt $attempt)"
      exit 0
    fi
    echo "[verify-build-lockstep] attempt $attempt: MISMATCH frontend=$frontend_result backend=$backend_result -- retrying..."
  else
    echo "[verify-build-lockstep] attempt $attempt: fetch failure -- frontend: $frontend_result | backend: $backend_result -- retrying..."
  fi

  now=$(date +%s)
  elapsed=$((now - start_time))
  if [[ $elapsed -ge $TIMEOUT ]]; then
    echo "[verify-build-lockstep] FAILED after ${elapsed}s (timeout ${TIMEOUT}s)." >&2
    echo "[verify-build-lockstep]   frontend build.json  -> $last_frontend" >&2
    echo "[verify-build-lockstep]   backend  /api/version -> $last_backend" >&2
    echo "[verify-build-lockstep] Bundle build and backend build are NOT confirmed equal -- deploy is NOT in lockstep." >&2
    exit 1
  fi

  sleep "$INTERVAL"
done
