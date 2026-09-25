#!/usr/bin/env bash
# T11070: ruff gate for backend files changed on a branch (per-file ratchet).
#
# Run from src/backend (the backend CI job's working directory) with BASE_SHA and
# HEAD_SHA set. The pathspec is anchored with :(top) because git resolves
# pathspecs relative to the CWD; the unanchored 'src/backend/**/*.py' matched
# nothing from src/backend, so the old step linted nothing on every branch.
# 'src/backend/*.py' (not '**/') so top-level files such as run_tests.py count
# too: without glob magic, '*' in a pathspec also matches '/'.
#
# Rule: a changed file fails if it has MORE ruff findings at HEAD than at the
# merge-base. A renamed or copied file is compared against its OLD path, so a
# pure move never fails. A file new to the branch starts at 0 and must be clean.
# A ruff crash (exit >= 2) fails the step rather than counting as zero findings.
# The frozen backlog in untouched lines does not fail a branch; the whole-app
# count gate in branch-ci.yml guards the total separately.
set -euo pipefail

: "${BASE_SHA:?BASE_SHA must be set}"
: "${HEAD_SHA:?HEAD_SHA must be set}"

merge_base=$(git merge-base "$BASE_SHA" "$HEAD_SHA")
finding_re='^.+:[0-9]+:[0-9]+: '
checked=0
failed=0

# Prints ruff's concise output for one file; the exit status is ruff's own.
ruff_head() { ruff check --output-format=concise "$1" 2>&1; }
ruff_base() { git show "$merge_base:$1" | ruff check --output-format=concise --stdin-filename "$2" - 2>&1; }

check_file() {  # $1 = repo path at HEAD, $2 = repo path at merge-base ('' if new)
  local path=$1 base_path=$2 rel=${1#src/backend/}
  local head_out head_rc=0 head_n base_out base_rc=0 base_n=0
  checked=$((checked + 1))

  head_out=$(ruff_head "$rel") || head_rc=$?
  if [ "$head_rc" -ge 2 ]; then
    printf '%s\n' "$head_out"
    echo "::error file=$path::ruff failed to run on $rel (exit $head_rc)"
    failed=1
    return
  fi
  head_n=$(printf '%s\n' "$head_out" | grep -cE "$finding_re" || true)

  if [ -n "$base_path" ] && git cat-file -e "$merge_base:$base_path" 2>/dev/null; then
    base_out=$(ruff_base "$base_path" "$rel") || base_rc=$?
    if [ "$base_rc" -ge 2 ]; then
      printf '%s\n' "$base_out"
      echo "::error file=$path::ruff failed to run on the merge-base copy of $rel (exit $base_rc)"
      failed=1
      return
    fi
    base_n=$(printf '%s\n' "$base_out" | grep -cE "$finding_re" || true)
  fi

  if [ "$base_path" != "$path" ] && [ -n "$base_path" ]; then
    echo "ruff $rel (from ${base_path#src/backend/}): $base_n at merge-base -> $head_n at head"
  else
    echo "ruff $rel: $base_n at merge-base -> $head_n at head"
  fi
  if [ "$head_n" -gt 0 ]; then
    printf '%s\n' "$head_out" | grep -E "$finding_re" || true
  fi
  if [ "$head_n" -gt "$base_n" ]; then
    echo "::error file=$path::ruff findings grew in $rel ($base_n -> $head_n); fix the new ones"
    failed=1
  fi
}

# --name-status -z: "A|M|T\0path\0" or "R<score>|C<score>\0old\0new\0".
while IFS= read -r -d '' status; do
  case "$status" in
    R*|C*)
      IFS= read -r -d '' old_path
      IFS= read -r -d '' new_path
      check_file "$new_path" "$old_path"
      ;;
    A)
      IFS= read -r -d '' path
      check_file "$path" ""
      ;;
    *)
      IFS= read -r -d '' path
      check_file "$path" "$path"
      ;;
  esac
done < <(git diff --diff-filter=ACMRT --name-status -z "$BASE_SHA...$HEAD_SHA" -- ':(top)src/backend/*.py')

echo "ruff changed-files gate: $checked file(s) checked"
exit "$failed"
