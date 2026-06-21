#!/usr/bin/env bash
# One command -> a permission-free Claude Code session inside the dev container.
#
# WHY: inside the container, ~/.claude/settings.json has
# permissions.defaultMode = bypassPermissions (written by setup.sh), so Claude
# never stops to ask you to approve a command. This script is the frictionless
# way to LAND there: it builds/starts the container if needed and drops you
# straight into a bypassed `claude` session. Run it instead of `claude` on the
# host whenever you want a no-prompts session.
#
# USAGE (from Git Bash / WSL / macOS):
#   .devcontainer-ondemand/claude-docker.sh            # start a bypassed Claude session
#   .devcontainer-ondemand/claude-docker.sh --resume   # any args are forwarded to claude
#
# Requires: Docker running, Node (for npx). The first run builds the image and
# can take several minutes; later runs are fast (container is reused).
set -euo pipefail

# Repo root = parent of this script's dir, regardless of where it's invoked.
# This config dir is intentionally NOT named ".devcontainer" so VS Code does
# not auto-reopen the folder in a container (host is the default). We therefore
# point the devcontainer CLI at the config explicitly via --config below.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/devcontainer.json"
cd "$SCRIPT_DIR/.."

echo "[claude-docker] starting dev container (first run builds the image; be patient)..." >&2
# `up` is idempotent: builds if missing, starts if stopped, no-op if running.
# Progress logs go to stderr (shown live); the result JSON goes to stdout (captured).
UP_JSON="$(npx --yes @devcontainers/cli up --workspace-folder . --config "$CONFIG")"

# Pull containerId / workspace / user out of the result JSON with Node.
read -r CID WORKDIR RUSER < <(printf '%s' "$UP_JSON" | node -e '
  let s = "";
  process.stdin.on("data", d => s += d).on("end", () => {
    // Result JSON may be the last non-empty line; scan from the end.
    const line = s.trim().split("\n").reverse().find(l => l.trim().startsWith("{")) || "{}";
    let o = {}; try { o = JSON.parse(line); } catch (e) {}
    process.stdout.write([o.containerId || "", o.remoteWorkspaceFolder || "/workspaces", o.remoteUser || "vscode"].join(" "));
  });
')

if [ -n "$CID" ]; then
  # docker exec -it guarantees a real TTY, which Claudes interactive UI needs.
  # MSYS_NO_PATHCONV stops Git Bash from rewriting the Unix -w path
  # (/workspaces/...) into a Windows path, which otherwise breaks docker exec
  # with "Cwd must be an absolute path".
  echo "[claude-docker] entering bypassed Claude session (container ${CID:0:12})..." >&2
  exec env MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
    docker exec -it -u "$RUSER" -w "$WORKDIR" "$CID" bash -lc 'exec claude "$@"' _ "$@"
fi

# Fallback: let the devcontainer CLI run it (works, but TTY handling is weaker).
echo "[claude-docker] could not resolve container id; using devcontainer exec fallback..." >&2
exec npx --yes @devcontainers/cli exec --workspace-folder . --config "$CONFIG" claude "$@"
