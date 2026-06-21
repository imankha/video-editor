#!/usr/bin/env bash
# Runs ONCE at container creation (onCreateCommand).
# Installs ffmpeg, writes the bypass-permissions setting into the CONTAINER's
# ~/.claude, seeds the host CLI login, and installs frontend deps.
#
# Keep this FAST and ROBUST: onCreateCommand failing aborts the whole build.
# The Claude Code CLI is installed by the claude-code devcontainer feature
# (don't `npm install -g` it here -- that hits EACCES on the global node dir).
# Backend deps are intentionally NOT installed (heavy ML wheels like basicsr
# compile for minutes and can destabilize Docker; the backend's Windows .venv
# isn't used here anyway). Install them by hand if you ever need them:
#     pip install -r src/backend/requirements.txt
set -euo pipefail

echo "[devcontainer setup] installing system deps (ffmpeg)..."
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends ffmpeg
sudo rm -rf /var/lib/apt/lists/*

# --- The whole point: bypass permissions, container-only ---------------------
# This writes to the container's home, NOT the host's. The host ~/.claude is
# only visible read-only at /host-claude and is never modified.
#
# ~/.claude is a PERSISTED named volume (see devcontainer.json). On first
# creation a named volume is owned by root, so take ownership before writing.
echo "[devcontainer setup] enabling bypassPermissions for in-container Claude..."
sudo mkdir -p "$HOME/.claude"
sudo chown -R "$(id -u):$(id -g)" "$HOME/.claude"
cat > "$HOME/.claude/settings.json" <<'JSON'
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
JSON

# Reuse host login immediately (auth-sync.sh repeats this on every start).
bash "$(dirname "$0")/auth-sync.sh" || true

# --- Frontend deps (Linux-friendly, fast) ------------------------------------
# Backend deps are deliberately skipped here -- see the header note.
if [ -f src/frontend/package.json ]; then
  echo "[devcontainer setup] installing frontend deps..."
  (cd src/frontend && npm install) || echo "  (frontend npm install failed; run it manually if needed)"
fi

echo "[devcontainer setup] done."
