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

# The frontend node_modules is a separate named volume, root-owned on first mount,
# so `npm install` (run as dev) fails with EACCES. Take ownership when it isn't
# already dev's (instant on the common path; recursive only on a fresh/root volume).
NM=/workspace/src/frontend/node_modules
if [ -d "$NM" ] && [ "$(stat -c %U "$NM" 2>/dev/null)" != dev ]; then
  sudo chown -R dev:dev "$NM" 2>/dev/null || true
fi

# Export the container-corrected DATABASE_URL into the login-shell env so BACKEND
# PYTEST works (conftest.py loads .env verbatim -> localhost -> connection refused;
# python-dotenv never overrides an already-set env var, so this wins everywhere:
# pytest, bare uvicorn, and container-stack.sh alike). We do NOT edit .env.
if [ -f /workspace/.env ] && ! grep -q '^export DATABASE_URL=' "$HOME/.profile" 2>/dev/null; then
  RAW="$(grep -E '^DATABASE_URL=' /workspace/.env | head -1 | cut -d= -f2- | tr -d '\r')"
  if [ -n "$RAW" ]; then
    FIXED="${RAW/@localhost:/@host.docker.internal:}"
    FIXED="${FIXED/@127.0.0.1:/@host.docker.internal:}"
    for rc in "$HOME/.profile" "$HOME/.bashrc"; do
      grep -q '^export DATABASE_URL=' "$rc" 2>/dev/null \
        || echo "export DATABASE_URL=\"$FIXED\"" >> "$rc"
    done
  fi
fi

# Modal token provisioning (T4120 Gap 3, opt-in real-Modal verify). Modal is OFF by
# default in-container; when creds are in the env (or /workspace/.env), write
# ~/.modal.toml so `modal` is authed. Idempotent (never clobber an existing token),
# created 0600 via umask, and the secret VALUES are never logged.
if [ ! -f "$HOME/.modal.toml" ]; then
  MODAL_ID="${MODAL_TOKEN_ID:-}"
  MODAL_SECRET="${MODAL_TOKEN_SECRET:-}"
  if [ -f /workspace/.env ]; then
    [ -z "$MODAL_ID" ] && MODAL_ID="$(grep -E '^MODAL_TOKEN_ID=' /workspace/.env | head -1 | cut -d= -f2- | tr -d '\r')"
    [ -z "$MODAL_SECRET" ] && MODAL_SECRET="$(grep -E '^MODAL_TOKEN_SECRET=' /workspace/.env | head -1 | cut -d= -f2- | tr -d '\r')"
  fi
  if [ -n "$MODAL_ID" ] && [ -n "$MODAL_SECRET" ]; then
    ( umask 177; cat > "$HOME/.modal.toml" <<TOML
[default]
token_id = "$MODAL_ID"
token_secret = "$MODAL_SECRET"
TOML
    )
    chmod 600 "$HOME/.modal.toml" 2>/dev/null || true
  fi
fi

# Lint hooks: the host keeps these in .claude/settings.json, which is gitignored
# (its permissions allowlist holds tokens), so the clone arrives without them.
# Recreate just the hooks wiring here so the in-container Claude gets the same
# eslint/ruff feedback loop. Never clobber an existing project settings file.
if [ ! -f /workspace/.claude/settings.json ]; then
  mkdir -p /workspace/.claude
  cat > /workspace/.claude/settings.json <<'JSON'
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/lint-changed.cjs\"",
            "timeout": 60,
            "statusMessage": "Linting changed file..."
          }
        ]
      }
    ]
  }
}
JSON
fi
# ruff isn't baked into the image; the hook degrades silently without it.
command -v ruff >/dev/null 2>&1 || sudo pip install --quiet ruff 2>/dev/null || true

# T5020: starlette 0.37.2 dropped the httpx-removed `app=` TestClient kwarg, so
# backend endpoint tests collect on the pinned httpx 0.28.1 (same as prod). The
# old `httpx<0.28` pin is gone -- the image is built from requirements, which now
# carry the compatible fastapi/starlette versions.

# Container fact sheet: overrides the repo CLAUDE.md where the host docs are
# wrong INSIDE this container (Windows venv paths, MCP-only tools, ...). Claude
# Code auto-loads CLAUDE.local.md; rewritten on every bootstrap to stay current.
cat > /workspace/CLAUDE.local.md <<'FACTS'
# Container environment (overrides CLAUDE.md where they conflict)

You are in a Linux /dotask task container. Facts that differ from the repo docs:

- **Python**: use `python` (/usr/local/bin/python, system site-packages). There is
  NO `.venv` here — ignore every `.venv/Scripts/python.exe` instruction.
- **Backend tests**: `cd /workspace/src/backend && python -m pytest tests/... -v`
  (pytest is baked into the image). Import check:
  `cd /workspace/src/backend && python -c "from app.main import app"`.
- **DATABASE_URL** is already exported with the correct in-container host
  (host.docker.internal). Do NOT edit `.env` or add rewrites.
- **Live verification**: `bash scripts/dev-verify.sh e2e/<spec>.spec.js` starts the
  stack and runs a Playwright spec authed as a real user. App ports INSIDE the
  container are backend :8000 / frontend :5173 (host offset ports don't concern you).
- **No MCP tools here** (no `reduce_log`): to inspect logs use
  `grep -iE 'error|warn' /tmp/backend.log | tail -50` — never cat a whole log.
- **Modal is OFF by default in-container**; real-Modal verification needs
  `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` provisioned (bootstrap then writes `~/.modal.toml`).
- **Git**: commit with EXPLICIT `git add <paths>` only, never `-A`/`-a`. Never
  commit `package-lock.json` unless you intentionally changed dependencies.
  Do not attempt `gh`/pushing — the supervisor pushes from the host.
FACTS
