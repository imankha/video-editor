#!/usr/bin/env bash
# Runs on every container start (postStartCommand, after auth-sync.sh).
#
# Repairs two things the Dev Containers "copy host git config" step gets wrong
# when the host is Windows. Both are idempotent -- safe to re-run every start.
#
# 1) CREDENTIAL HELPER. The host ~/.gitconfig carries a URL-scoped override:
#
#        [credential "https://github.com"]
#            helper =                                          # empty: resets the list
#            helper = !'C:\Program Files\GitHub CLI\gh.exe' auth git-credential
#
#    Git picks the MOST SPECIFIC match, so for github.com URLs that pair
#    REPLACES the generic helper -- here, the VS Code remote-containers helper
#    that actually works. What's left is a Windows .exe that doesn't exist in
#    Linux, so every push/fetch-with-auth dies with:
#        gh.exe: not found / fatal: could not read Username for 'https://github.com'
#    Reads over https still work (no auth needed), so this only bites on WRITES
#    -- which makes it look like a push problem rather than a config problem.
#    Dropping the URL-scoped keys lets the generic VS Code helper apply again.
#
# 2) LINE ENDINGS. The workspace is a bind mount of the host checkout, and Git
#    for Windows checks out CRLF (core.autocrlf=true in ITS system config, which
#    is not copied into the container). Linux git defaults to autocrlf=false and
#    therefore compares CRLF-on-disk against LF blobs -- reporting the ENTIRE
#    repo as modified (901 files, content-identical). Matching the host's
#    setting makes status truthful again. Repo blobs stay LF either way; this
#    only governs the working-tree copy.
#
#    NOTE: the task-runner containers (scripts/task.sh) deliberately set
#    core.autocrlf=false in their OWN clones -- they check out fresh LF trees
#    and are unaffected by this file.
set -euo pipefail

# --- 1) Drop Windows-only credential helpers ---------------------------------
# --unset-all exits 5 when the key is absent; that's the already-clean case.
for host in "https://github.com" "https://gist.github.com"; do
  if git config --global --get-all "credential.${host}.helper" >/dev/null 2>&1; then
    git config --global --unset-all "credential.${host}.helper" || true
    echo "[git-config] removed Windows-only credential helper for ${host}."
  fi
done

# --- 2) Match the host's line-ending convention ------------------------------
if [ "$(git config --global --get core.autocrlf || echo)" != "true" ]; then
  git config --global core.autocrlf true
  echo "[git-config] set core.autocrlf=true (host checks out CRLF)."
fi
