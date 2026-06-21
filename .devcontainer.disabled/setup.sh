#!/usr/bin/env bash
# Runs ONCE at container creation (onCreateCommand).
# Installs system deps, the Claude Code CLI, writes the bypass-permissions
# setting into the CONTAINER's ~/.claude, and seeds project deps best-effort.
set -euo pipefail

echo "[devcontainer setup] installing system deps (ffmpeg)..."
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends ffmpeg
sudo rm -rf /var/lib/apt/lists/*

echo "[devcontainer setup] installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code || echo "  (CLI install failed; the VS Code extension still works)"

# --- The whole point: bypass permissions, container-only ---------------------
# This writes to the container's home, NOT the host's. The host ~/.claude is
# only visible read-only at /host-claude and is never modified.
echo "[devcontainer setup] enabling bypassPermissions for in-container Claude..."
mkdir -p "$HOME/.claude"
cat > "$HOME/.claude/settings.json" <<'JSON'
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
JSON

# Reuse host login immediately (auth-sync.sh repeats this on every start).
bash "$(dirname "$0")/auth-sync.sh" || true

# --- Best-effort project deps so tests/builds work in-container --------------
# Frontend is Linux-friendly. Backend uses a Windows .venv on the host that
# will NOT work here; install its deps into the container python instead.
if [ -f src/frontend/package.json ]; then
  echo "[devcontainer setup] installing frontend deps..."
  (cd src/frontend && npm install) || echo "  (frontend npm install failed; run it manually if needed)"
fi

if [ -f src/backend/requirements.txt ]; then
  echo "[devcontainer setup] installing backend deps (best-effort)..."
  pip install -r src/backend/requirements.txt || echo "  (backend deps failed; install manually if you need to run the backend here)"
fi

echo "[devcontainer setup] done."
