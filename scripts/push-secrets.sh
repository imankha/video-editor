#!/usr/bin/env bash
#
# Push secrets from .env files to Fly.io.
#
# Single source of truth: the root .env.staging / .env.prod files contain all
# backend env vars. This script reads them and pushes to Fly.io secrets.
#
# Usage:
#   scripts/push-secrets.sh staging       # push .env.staging → reel-ballers-api-staging
#   scripts/push-secrets.sh production    # push .env.prod    → reel-ballers-api
#   scripts/push-secrets.sh staging --dry-run   # show what would be pushed
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Variables managed in fly.*.toml [env] — skip these (toml is their source of truth)
TOML_VARS="APP_ENV ENV DEBUG CLEAR_PENDING_JOBS_ON_STARTUP MODAL_ENABLED CORS_ORIGINS"

env_name="${1:-}"
dry_run=false
[[ "${2:-}" == "--dry-run" ]] && dry_run=true

case "$env_name" in
  staging)
    env_file="$REPO_ROOT/.env.staging"
    fly_app="reel-ballers-api-staging"
    ;;
  production|prod)
    env_file="$REPO_ROOT/.env.prod"
    fly_app="reel-ballers-api"
    ;;
  *)
    echo "Usage: $0 <staging|production> [--dry-run]"
    echo ""
    echo "Pushes secrets from .env files to Fly.io."
    echo "Source of truth: .env.staging / .env.prod"
    exit 1
    ;;
esac

if [[ ! -f "$env_file" ]]; then
  echo "ERROR: $env_file not found"
  exit 1
fi

echo "[secrets] Reading $env_file for $fly_app"

secrets_args=()
skipped=()

while IFS= read -r line; do
  # Skip empty lines and comments
  [[ -z "$line" || "$line" == \#* ]] && continue

  key="${line%%=*}"
  value="${line#*=}"

  # Skip variables managed in fly.toml
  skip=false
  for toml_var in $TOML_VARS; do
    if [[ "$key" == "$toml_var" ]]; then
      skip=true
      break
    fi
  done

  if $skip; then
    skipped+=("$key")
    continue
  fi

  secrets_args+=("$key=$value")
done < "$env_file"

if [[ ${#skipped[@]} -gt 0 ]]; then
  echo "[secrets] Skipped (managed in fly.toml): ${skipped[*]}"
fi

echo "[secrets] Pushing ${#secrets_args[@]} secrets to $fly_app:"
for arg in "${secrets_args[@]}"; do
  key="${arg%%=*}"
  echo "  - $key"
done

if $dry_run; then
  echo "[secrets] DRY RUN — no changes made"
  exit 0
fi

flyctl secrets set "${secrets_args[@]}" --app "$fly_app" --stage
echo "[secrets] Staged. Deploying secrets..."
if ! flyctl secrets deploy --app "$fly_app" 2>/dev/null; then
  echo "[secrets] No running machines — secrets will apply on next deploy or machine start"
fi
echo "[secrets] Done — ${#secrets_args[@]} secrets pushed to $fly_app ✓"
