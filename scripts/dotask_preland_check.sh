#!/usr/bin/env bash
# T13840: pre-PUSHREADY hygiene. Catches, locally, what Branch CI would otherwise fail ~9 minutes
# after the push (PR #659/#660, 2026-10-28). Run by the worker before PUSHREADY and again by
# `dotask.sh land` (step 1) before it records a tested HEAD.
#
#   bash scripts/dotask_preland_check.sh [<checkout>]      (default: current directory)
#
# Checks, each naming the offending path; exit 1 if any fails:
#   1. git diff --check origin/master...HEAD       (trailing blanks at EOF fail CI's tooling job)
#   2. qa/ holds only evidence files               (ci_policy.QA_EVIDENCE; CI's changes job fails on
#                                                   a code-like copy of a test under qa/)
#   3. ruff on changed backend .py files           (CI's per-file ratchet: new files start at 0)
#   4. eslint on changed frontend files            (when src/frontend/node_modules exists)
#   5. ci_policy route does not raise UnclassifiedPath
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)  # the harness copy: a checkout may predate ci_policy changes
checkout=$(cd "${1:-.}" && pwd)
cd "$checkout" || exit 2
failed=0
fail() { echo "FAIL: $*"; failed=1; }

git rev-parse --verify -q origin/master >/dev/null || { echo "FAIL: no origin/master ref (git fetch origin master)"; exit 2; }
base=$(git merge-base origin/master HEAD) || exit 2
head=$(git rev-parse HEAD)

# 1. whitespace
out=$(git diff --check "origin/master...HEAD" 2>&1) || fail "git diff --check:"$'\n'"$out"

# 2. qa/ evidence-only
allowed=$(python3 -c "import sys; sys.path.insert(0, sys.argv[1]); import ci_policy; print(' '.join(ci_policy.QA_EVIDENCE))" "$here")
while IFS= read -r path; do
  [ -n "$path" ] || continue
  ok=0
  for ext in $allowed; do [[ "$path" == *"$ext" ]] && ok=1; done
  [ "$ok" = 1 ] || fail "$path: only evidence files ($allowed) belong under qa/; keep a red-run test copy outside the repo and point qa/proof.json at the src/ test"
done < <(git diff --no-renames --diff-filter=d --name-only origin/master...HEAD -- 'qa/' 'src/frontend/qa/')

# 3. ruff on changed backend files (new files must be clean; existing ones may not gain findings)
backend=$(git diff --no-renames --diff-filter=d --name-only origin/master...HEAD -- 'src/backend/*.py')
if [ -n "$backend" ]; then
  if ! python3 -m ruff --version >/dev/null 2>&1; then
    fail "ruff is not installed but backend files changed (pip install ruff): $(echo $backend)"
  else
    finding_re='^.+:[0-9]+:[0-9]+: '
    while IFS= read -r path; do
      rel=${path#src/backend/}
      head_n=$( (cd src/backend && python3 -m ruff check --output-format=concise "$rel" 2>&1) | grep -cE "$finding_re")
      if git cat-file -e "$base:$path" 2>/dev/null; then
        base_n=$(git show "$base:$path" | (cd src/backend && python3 -m ruff check --output-format=concise --stdin-filename "$rel" - 2>&1) | grep -cE "$finding_re")
      else
        base_n=0
      fi
      if [ "$head_n" -gt "$base_n" ]; then
        fail "$path: ruff findings $base_n -> $head_n"
        (cd src/backend && python3 -m ruff check --output-format=concise "$rel" 2>&1 | grep -E "$finding_re")
      fi
    done <<< "$backend"
  fi
fi

# 4. eslint on changed frontend files
frontend=$(git diff --no-renames --diff-filter=d --name-only origin/master...HEAD -- 'src/frontend/src/*.js' 'src/frontend/src/*.jsx')
if [ -n "$frontend" ] && [ -d src/frontend/node_modules ]; then
  rels=$(echo "$frontend" | sed 's#^src/frontend/##')
  # shellcheck disable=SC2086
  out=$(cd src/frontend && npx --no-install eslint $rels 2>&1) || fail "eslint:"$'\n'"$out"
fi

# 5. CI routing
route_out=$(mktemp)
if ! err=$(python3 "$here/ci_policy.py" route --root "$checkout" --base "$base" --head "$head" --output "$route_out" 2>&1 >/dev/null); then
  fail "ci_policy route: $err"
fi
rm -f "$route_out"

if [ "$failed" = 0 ]; then echo "preland check: OK ($(git rev-parse --short HEAD))"; exit 0; fi
echo "preland check: FAILED"
exit 1
