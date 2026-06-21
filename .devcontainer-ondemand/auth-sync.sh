#!/usr/bin/env bash
# Runs on every container start (postStartCommand).
# Copies the host Claude login token into the container so you don't /login,
# and re-asserts the bypass setting in case it was removed.
set -euo pipefail

mkdir -p "$HOME/.claude"

# Reuse host login. The OAuth token lives at ~/.claude/.credentials.json on
# Linux/Windows; we mount the host ~/.claude read-only at /host-claude.
if [ -f /host-claude/.credentials.json ]; then
  cp -f /host-claude/.credentials.json "$HOME/.claude/.credentials.json"
  chmod 600 "$HOME/.claude/.credentials.json" || true
  echo "[auth-sync] reused host Claude login."
else
  echo "[auth-sync] no host credentials found at /host-claude/.credentials.json -- run /login once inside the container."
fi

# Re-assert bypass mode (idempotent).
if [ ! -f "$HOME/.claude/settings.json" ]; then
  cat > "$HOME/.claude/settings.json" <<'JSON'
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
JSON
  echo "[auth-sync] restored bypassPermissions setting."
fi
