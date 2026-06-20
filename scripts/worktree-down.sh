#!/usr/bin/env bash
# ============================================================================
# worktree-down.sh — SAFELY tear down a worktree created by /worktree
# ============================================================================
# The frontend node_modules is a JUNCTION into the shared real node_modules.
# A recursive delete (`rm -rf <WT>` or `git worktree remove --force`) run while
# that junction is LIVE will follow it and wipe the shared node_modules (its
# .bin shims), breaking the main checkout's `npm run dev`. So this script:
#   1. stops the stack, 2. removes the junction (link only), 3. REFUSES to
#   delete the worktree until the junction is verifiably gone, 4. never rm -rf.
#
# Usage: bash scripts/worktree-down.sh <worktree-name>
# ============================================================================
set -euo pipefail

NAME="${1:?usage: worktree-down.sh <worktree-name>}"
WT="/c/work/$NAME"
[ -f "$WT/.worktree-env" ] || { echo "ERROR: $WT/.worktree-env not found" >&2; exit 1; }
# shellcheck disable=SC1090
source "$WT/.worktree-env"
MAIN="${MAIN_REPO:?MAIN_REPO missing in .worktree-env}"
NM="$WT/src/frontend/node_modules"

# 1. Stop the stack on this worktree's offset ports (leave shared Postgres alone).
for port in "${BACKEND_PORT:-}" "${FRONTEND_PORT:-}"; do
  [ -n "$port" ] || continue
  for pid in $(netstat -ano | grep -E ":$port .*LISTENING" | awk '{print $5}' | sort -u); do
    taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true
  done
done

# 2. Remove the node_modules junction (rmdir on a junction deletes ONLY the link).
if [ -e "$NM" ]; then
  MSYS_NO_PATHCONV=1 cmd /c rmdir "$(cygpath -w "$NM")" >/dev/null 2>&1 || true
fi

# 3. GUARD: if a reparse point still exists at node_modules, ABORT before any
#    recursive delete — deleting now would follow the junction and wipe shared deps.
if MSYS_NO_PATHCONV=1 cmd /c fsutil reparsepoint query "$(cygpath -w "$NM")" >/dev/null 2>&1; then
  echo "ABORT: $NM is still a junction; could not remove it." >&2
  echo "Remove it manually (cmd /c rmdir) before deleting the worktree." >&2
  exit 1
fi

# 4. Remove the worktree + branch. NO `rm -rf <WT>` fallback (it would follow any
#    junction). --force here is safe only because step 3 proved the junction is gone.
git -C "$MAIN" worktree remove "$WT" 2>/dev/null || git -C "$MAIN" worktree remove "$WT" --force
git -C "$MAIN" worktree prune
git -C "$MAIN" branch -D "feature/$NAME" 2>/dev/null || true

echo "Torn down '$NAME' (ports ${BACKEND_PORT:-?}/${FRONTEND_PORT:-?}). Shared node_modules untouched."
