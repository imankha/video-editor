#!/usr/bin/env bash
# T11070: ruff gate for backend files changed on a branch (per-file ratchet).
#
# Run from src/backend (the backend CI job's working directory) with BASE_SHA and
# HEAD_SHA set. The pathspec is anchored with :(top) because git resolves
# pathspecs relative to the CWD; the unanchored 'src/backend/**/*.py' matched
# nothing from src/backend, so the old step linted nothing on every branch.
#
# Rule: a changed file fails if it has MORE ruff findings at HEAD than at the
# merge-base (a file new to the branch starts at 0, so it must be clean). The
# frozen backlog in untouched lines does not fail a branch; the whole-app count
# gate in branch-ci.yml guards the total separately.
set -euo pipefail

: "${BASE_SHA:?BASE_SHA must be set}"
: "${HEAD_SHA:?HEAD_SHA must be set}"

merge_base=$(git merge-base "$BASE_SHA" "$HEAD_SHA")
finding_re='^[^ ]+:[0-9]+:[0-9]+: '
checked=0
failed=0

while IFS= read -r -d '' path; do
  rel=${path#src/backend/}
  checked=$((checked + 1))

  head_out=$(ruff check --output-format=concise "$rel" 2>&1 || true)
  head_n=$(printf '%s\n' "$head_out" | grep -cE "$finding_re" || true)

  if git cat-file -e "$merge_base:$path" 2>/dev/null; then
    base_n=$(git show "$merge_base:$path" |
      ruff check --output-format=concise --stdin-filename "$rel" - 2>&1 |
      grep -cE "$finding_re" || true)
  else
    base_n=0
  fi

  echo "ruff $rel: $base_n at merge-base -> $head_n at head"
  if [ "$head_n" -gt 0 ]; then
    printf '%s\n' "$head_out" | grep -E "$finding_re" || true
  fi
  if [ "$head_n" -gt "$base_n" ]; then
    echo "::error file=$path::ruff findings grew in $rel ($base_n -> $head_n); fix the new ones"
    failed=1
  fi
done < <(git diff --diff-filter=ACMRT --name-only -z "$BASE_SHA...$HEAD_SHA" -- ':(top)src/backend/**/*.py')

echo "ruff changed-files gate: $checked file(s) checked"
exit "$failed"
