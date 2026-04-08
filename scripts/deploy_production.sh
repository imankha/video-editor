#!/usr/bin/env bash
#
# Deploy to production.
#
# Usage:
#   scripts/deploy_production.sh                # backend + frontend (default)
#   scripts/deploy_production.sh --frontend-only
#   scripts/deploy_production.sh --backend-only
#   scripts/deploy_production.sh --all          # backend first, then frontend
#
set -euo pipefail

FRONTEND_URL="https://app.reelballers.com"
BACKEND_HEALTH_URL="https://reel-ballers-api.fly.dev/api/health"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

deploy_frontend=true
deploy_backend=true

case "${1:-}" in
  --all|"")           deploy_frontend=true;  deploy_backend=true  ;;
  --backend-only)     deploy_frontend=false; deploy_backend=true  ;;
  --all)              deploy_frontend=true;  deploy_backend=true  ;;
  *)
    echo "Unknown flag: $1"
    echo "Usage: $0 [--frontend-only | --backend-only | --all]"
    exit 1
    ;;
esac

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

# ── Backend deploy ───────────────────────────────────────────────────

if $deploy_backend; then
  echo "[backend]  Deploying to Fly.io (reel-ballers-api)..."
  cd "$REPO_ROOT/src/backend"
  fly deploy --config fly.production.toml
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

# ── Summary ──────────────────────────────────────────────────────────

if $deploy_backend && $deploy_frontend; then
  echo "[done]     Backend + frontend deployed successfully."
elif $deploy_backend; then
  echo "[done]     Backend deployed successfully."
else
  echo "[done]     Frontend deployed successfully."
fi
