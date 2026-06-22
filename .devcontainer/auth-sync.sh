#!/usr/bin/env bash
# Runs on every container start (postStartCommand).
#
# ~/.claude is a PERSISTED named volume, so a sign-in done inside the container
# survives rebuilds. This script only SEEDS the host's CLI token into that
# volume when it is still empty -- it never overwrites an existing token, so it
# can't clobber an in-container sign-in.
#
# NOTE: the VS Code Claude Code *extension* authenticates with its own sign-in
# flow and does not rely on this seeded file. If the extension panel shows
# "Language model unavailable", open it and click Sign in (or run `claude` ->
# /login in the terminal) once; the volume keeps that login thereafter.
set -euo pipefail

mkdir -p "$HOME/.claude"

# Seed the CLI login from the host ONLY if the container has none yet.
if [ -f "$HOME/.claude/.credentials.json" ]; then
  echo "[auth-sync] container already has credentials; leaving them untouched."
elif [ -f /host-claude/.credentials.json ]; then
  cp -f /host-claude/.credentials.json "$HOME/.claude/.credentials.json"
  chmod 600 "$HOME/.claude/.credentials.json" || true
  echo "[auth-sync] seeded host Claude CLI login (extension panel still uses its own sign-in)."
else
  echo "[auth-sync] no host credentials found at /host-claude/.credentials.json -- run /login once inside the container."
fi

# Migrate a legacy ~/.claude.json onto the persisted config dir. With
# CLAUDE_CONFIG_DIR=~/.claude (set in devcontainer.json) Claude keeps
# .claude.json INSIDE the volume; older containers had it loose in $HOME.
# Move it once so MCP approvals / onboarding / trust survive rebuilds.
if [ -f "$HOME/.claude.json" ] && [ ! -f "$HOME/.claude/.claude.json" ]; then
  mv "$HOME/.claude.json" "$HOME/.claude/.claude.json"
  echo "[auth-sync] migrated ~/.claude.json onto the persisted config volume."
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
