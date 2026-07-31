#!/usr/bin/env bash
#
# Deploy to production.
#
# Usage:
#   scripts/deploy_production.sh                              # backend + frontend (default)
#   scripts/deploy_production.sh --all                         # same, explicit
#   scripts/deploy_production.sh --frontend-only
#   scripts/deploy_production.sh --backend-only                # refused by default, see T6220 below
#   scripts/deploy_production.sh --backend-only --accept-build-drift
#
set -euo pipefail

FRONTEND_URL="https://app.reelballers.com"
BACKEND_HEALTH_URL="https://reel-ballers-api.fly.dev/api/health"
BACKEND_VERSION_URL="https://reel-ballers-api.fly.dev/api/version"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

deploy_frontend=true
deploy_backend=true
accept_build_drift=false
dry_run=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      deploy_frontend=true
      deploy_backend=true
      ;;
    --frontend-only)
      deploy_frontend=true
      deploy_backend=false
      ;;
    --backend-only)
      deploy_frontend=false
      deploy_backend=true
      ;;
    --accept-build-drift)
      accept_build_drift=true
      ;;
    --dry-run)
      # T6220 QA seam ONLY -- not a supported deploy mode. This script is
      # `set -euo pipefail` and deploys real infrastructure, so the
      # arg-parsing/refusal logic must be provable WITHOUT ever executing the
      # rest of the script. Parses args, prints the resolved intent, exits
      # before any git/prod-touching command runs.
      dry_run=true
      ;;
    *)
      echo "[pre-flight] ERROR: unknown flag: $1"
      echo "Usage: $0 [--all | --frontend-only | --backend-only [--accept-build-drift]]"
      exit 1
      ;;
  esac
  shift
done

# T6220: --backend-only alone leaves the server's advertised build AHEAD of the
# deployed bundle with no matching bundle to load -- the exact state T6210 had
# to defend against (see .claude/knowledge/backend-services.md § Deploy +
# build-number lockstep). Refuse it unless the operator explicitly accepts the
# drift. --frontend-only is the OPPOSITE direction (bundle ahead of server) and
# stays allowed UNCHANGED: appVersion.checkServerVersion only raises the gate
# when serverBuild > clientBuild, so server <= clientBuild can never fire it --
# a bundle-ahead-of-server drift is harmless by construction. Do NOT
# "helpfully" symmetrize this; the two directions are not equivalent.
if ! $deploy_frontend && $deploy_backend && ! $accept_build_drift; then
  echo "[pre-flight] ERROR: --backend-only leaves the server build ahead of the deployed bundle"
  echo "             (build drift; see T6220/T6210). Re-run with --accept-build-drift if intended."
  exit 1
fi

if $dry_run; then
  echo "[dry-run] deploy_frontend=$deploy_frontend deploy_backend=$deploy_backend accept_build_drift=$accept_build_drift"
  exit 0
fi

# ── Pre-flight checks ────────────────────────────────────────────────

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "master" ]]; then
  echo "[pre-flight] ERROR: must be on master (currently on $branch)"
  exit 1
fi

if ! git diff --quiet; then
  echo "[pre-flight] ERROR: working tree has unstaged changes — commit or stash first"
  exit 1
fi

if ! git diff --cached --quiet; then
  echo "[pre-flight] ERROR: working tree has staged changes — commit first"
  exit 1
fi

git fetch origin master --quiet
local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse origin/master)
if [[ "$local_sha" != "$remote_sha" ]]; then
  echo "[pre-flight] ERROR: local master differs from origin/master — run git pull first"
  exit 1
fi

short_sha=$(git rev-parse --short HEAD)
echo "[pre-flight] On master ($short_sha), clean tree, up-to-date with origin ✓"

# ── Run pending schema migrations ────────────────────────────────────

PYTHON="$REPO_ROOT/src/backend/.venv/Scripts/python.exe"
MIGRATE_SCRIPT="$REPO_ROOT/scripts/migrate-schema.py"

if $deploy_backend; then
  if "$PYTHON" "$MIGRATE_SCRIPT" --check 2>/dev/null; then
    echo "[migrate]  Pending migrations found -- running against prod..."
    "$PYTHON" "$MIGRATE_SCRIPT" --env prod
    echo "[migrate]  Clearing pending migrations list..."
    "$PYTHON" "$MIGRATE_SCRIPT" --reset
    git add "$MIGRATE_SCRIPT"
    git commit -m "Clear pending migrations after deploy"
    git push origin master --quiet
    echo "[migrate]  Migrations applied and cleared ✓"
  else
    echo "[migrate]  No pending migrations ✓"
  fi
fi

# ── Helper: verify URL returns 200 ───────────────────────────────────

verify_url() {
  local url="$1"
  local label="$2"
  echo -n "[$label]   Verifying $url ... "
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [[ "$status" == "200" ]]; then
    echo "✓"
  else
    echo "FAILED (HTTP $status)"
    exit 1
  fi
}

# ── Sync secrets from .env.prod ──────────────────────────────────────

if $deploy_backend; then
  echo "[secrets]  Syncing secrets from .env.prod to Fly.io..."
  bash "$REPO_ROOT/scripts/push-secrets.sh" production
fi

# ── Backend deploy ───────────────────────────────────────────────────

if $deploy_backend; then
  echo "[backend]  Deploying to Fly.io (reel-ballers-api)..."
  cd "$REPO_ROOT/src/backend"
  # Tbug40p: monotonic build number = commit count on master (matches the number
  # vite.config.js bakes into the frontend for the same commit).
  app_build=$(git -C "$REPO_ROOT" rev-list --count HEAD)
  fly deploy --config fly.production.toml \
    --build-arg COMMIT_SHA="$local_sha" \
    --build-arg APP_BUILD="$app_build"
  echo "[backend]  Deploy complete, verifying health..."
  verify_url "$BACKEND_HEALTH_URL" "backend"
  cd "$REPO_ROOT"
fi

# ── Frontend deploy ──────────────────────────────────────────────────

if $deploy_frontend; then
  echo "[frontend] Building with production env..."
  cd "$REPO_ROOT/src/frontend"
  npm run build:production
  echo "[frontend] Deploying to Cloudflare Pages (reel-ballers-prod)..."
  npx wrangler pages deploy dist --project-name reel-ballers-prod --branch main
  echo "[frontend] Deploy complete, verifying site..."
  verify_url "$FRONTEND_URL" "frontend"
  cd "$REPO_ROOT"
fi

# ── Tag successful deploy ─────────────────────────────────────────────

date_stamp=$(date +%Y-%m-%d)
if $deploy_backend; then
  tag="deploy/backend/$date_stamp"
  # Append counter if tag already exists (multiple deploys same day)
  if git tag -l "$tag" | grep -q .; then
    n=2
    while git tag -l "${tag}-${n}" | grep -q .; do ((n++)); done
    tag="${tag}-${n}"
  fi
  git tag "$tag"
  git push origin "$tag" --quiet
  echo "[tag]      Created $tag"
fi
if $deploy_frontend; then
  tag="deploy/frontend/$date_stamp"
  if git tag -l "$tag" | grep -q .; then
    n=2
    while git tag -l "${tag}-${n}" | grep -q .; do ((n++)); done
    tag="${tag}-${n}"
  fi
  git tag "$tag"
  git push origin "$tag" --quiet
  echo "[tag]      Created $tag"
fi

# ── Build-number lockstep assertion (T6220) ──────────────────────────
# Only meaningful when BOTH halves just deployed from this run -- an allowed
# --frontend-only or a drift-accepted --backend-only deliberately leaves the
# numbers unequal, so asserting equality there would be asserting the very
# thing the operator just chose to skip.

if $deploy_backend && $deploy_frontend; then
  echo "[verify]   Asserting frontend/backend build lockstep..."
  bash "$REPO_ROOT/scripts/verify-build-lockstep.sh" \
    --frontend-url "$FRONTEND_URL" \
    --backend-url "$BACKEND_VERSION_URL"
elif $deploy_frontend; then
  echo "[verify]   Skipping lockstep assertion because only the frontend was deployed (--frontend-only; harmless drift, bundle-ahead-of-server can never raise the update gate)."
elif $deploy_backend; then
  echo "[verify]   Skipping lockstep assertion because only the backend was deployed (--backend-only --accept-build-drift; drift was explicitly accepted)."
fi

# ── Summary ──────────────────────────────────────────────────────────

if $deploy_backend && $deploy_frontend; then
  echo "[done]     Backend + frontend deployed successfully."
elif $deploy_backend; then
  echo "[done]     Backend deployed successfully."
else
  echo "[done]     Frontend deployed successfully."
fi
