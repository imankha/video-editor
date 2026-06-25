#!/usr/bin/env bash
# Idempotent per-`up` bootstrap, run INSIDE a task container as user `dev`.
# Prepares the shared ~/.claude named volume so the in-container Claude is
# permission-free and (if possible) already signed in.
set -euo pipefail

# The shared named volume is root-owned on first mount -- take ownership.
sudo chown -R dev:dev "$HOME/.claude" 2>/dev/null || true
mkdir -p "$HOME/.claude"

# bypassPermissions, container-only (the whole point).
if [ ! -f "$HOME/.claude/settings.json" ]; then
  cat > "$HOME/.claude/settings.json" <<'JSON'
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
JSON
fi

# Seed the host CLI login (host ~/.claude is mounted read-only at /host-claude)
# ONLY if the shared volume has none yet -- never clobber an in-container login.
if [ ! -f "$HOME/.claude/.credentials.json" ] && [ -f /host-claude/.credentials.json ]; then
  cp -f /host-claude/.credentials.json "$HOME/.claude/.credentials.json"
  chmod 600 "$HOME/.claude/.credentials.json" || true
fi

# Migrate a loose ~/.claude.json onto the persisted config dir once.
if [ -f "$HOME/.claude.json" ] && [ ! -f "$HOME/.claude/.claude.json" ]; then
  mv "$HOME/.claude.json" "$HOME/.claude/.claude.json"
fi

# /workspace is a bind mount owned by a different uid than `dev`, so git refuses
# it ("detected dubious ownership"). Mark it safe so the worker can branch/commit.
git config --global --add safe.directory /workspace 2>/dev/null || true
