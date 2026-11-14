#!/usr/bin/env bash
# T16120:C1 - every check T16120 judged (T16040:C2, T16050:C2/C3/C4, T16060:C2/C3) passes
# on master's production code and fails on each deliberately broken copy the task file names.
#
# Builds a throwaway worktree of the base (master: the PR #746 code, which T16120 did not
# change), drops in HEAD's strengthened tests and check commands, runs every named test
# green, then applies one mutant at a time and requires the named test to fail on it.
# Run from the repo root: bash src/frontend/e2e/checks/T16120.mutants.sh [base-ref] [tests-rev]
# (tests-rev defaults to HEAD; pass 33dcb6041^ to see the pre-T16120 tests miss the mutants)
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
BASE=${1:-origin/master}
TESTS_REV=${2:-HEAD}
TMP=$(mktemp -d)
WT="$TMP/wt"
cleanup() { git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

git -C "$ROOT" worktree add --detach "$WT" "$BASE" >/dev/null 2>&1
FE="$WT/src/frontend"
ln -s "$ROOT/src/frontend/node_modules" "$FE/node_modules"
# HEAD's strengthened tests and check commands; production code stays at the base.
for f in src/frontend/src/screens/__tests__/focusScreenClipsFetchRetry.test.jsx \
         src/frontend/src/utils/loadTrace.test.js \
         src/frontend/e2e/checks/T16050.checks.json; do
  git -C "$ROOT" show "$TESTS_REV:$f" > "$WT/$f"
done
C4_CMD=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['criteria']['T16050:C4']['command'])" \
  "$FE/e2e/checks/T16050.checks.json")

FAIL=0
# A -t pattern that matches no test exits 0, so a green run must also report a passed test.
vt() {
  (cd "$FE" && NO_COLOR=1 npx vitest run "$@" >"$TMP/run.log" 2>&1) || return 1
  grep -qE 'Tests +[0-9]+ passed' "$TMP/run.log" || { echo "  (no test matched: $*)"; return 1; }
}
c4() { (cd "$WT" && bash -c "$C4_CMD"); }

# mutate <file under src/frontend> <python-literal old> <python-literal new>
mutate() {
  python3 - "$FE/$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
if src.count(old) != 1:
    sys.exit(f"mutant target not found exactly once in {path}: {old!r}")
open(path, 'w').write(src.replace(old, new))
PY
}
restore() { git -C "$WT" checkout -- "src/frontend/$1"; }

expect_green() { # name, then a command
  local name=$1; shift
  if "$@"; then echo "GREEN ok   $name"; else echo "GREEN FAIL $name"; tail -30 "$TMP/run.log" 2>/dev/null; FAIL=1; fi
}
expect_red() { # name, file, old, new, then a command
  local name=$1 file=$2 old=$3 new=$4; shift 4
  mutate "$file" "$old" "$new"
  if "$@"; then echo "RED FAIL   $name: passed on the broken copy"; FAIL=1; else echo "RED ok     $name"; fi
  restore "$file"
}

T40=(src/screens/__tests__/focusScreenClipsFetchRetry.test.jsx -t 'T16040:C2')
T50C2=(src/utils/loadTrace.test.js -t 'T16050:C2')
T50C3=(src/screens/__tests__/focusScreenLoadTrace.test.jsx -t 'C3')
T60C2=(src/utils/coldBackendTracker.test.js src/utils/apiFetch.test.js -t 'T16060:C2')
T60C3=(src/utils/coldBackendTracker.test.js src/utils/apiFetch.test.js -t 'T16060:C3')

expect_green 'T16040:C2' vt "${T40[@]}"
expect_green 'T16050:C2' vt "${T50C2[@]}"
expect_green 'T16050:C3' vt "${T50C3[@]}"
expect_green 'T16050:C4' c4
expect_green 'T16060:C2' vt "${T60C2[@]}"
expect_green 'T16060:C3' vt "${T60C3[@]}"

expect_red 'T16040:C2 error names neither project nor missing input' src/screens/FocusScreen.jsx \
  ": project=\${projectId} missing=\${clips.length === 0 ? 'clips' : 'videoUrl'}" '' vt "${T40[@]}"
expect_red 'T16050:C2 warns after 1s' src/utils/loadTrace.js \
  'const STUCK_MS = 10000;' 'const STUCK_MS = 1000;' vt "${T50C2[@]}"
expect_red 'T16050:C3 settles empty plays without naming them' src/screens/FocusScreen.jsx \
  "trace.settled({ emptyNeed: 'plays' });" 'trace.settled();' vt "${T50C3[@]}"
expect_red 'T16050:C4 waiting line uses console.log' src/utils/loadTrace.js \
  'console.info(`${PREFIX} ${screen} waiting for' 'console.log(`${PREFIX} ${screen} waiting for' c4
expect_red 'T16060:C2 note ignores the cold window' src/utils/coldBackendTracker.js \
  $'  if (IS_PRODUCTION_BACKEND || backendColdUntil === null) return null;\n  if (requestStartedAt > backendColdUntil) return null;' \
  '  if (IS_PRODUCTION_BACKEND) return null;' vt "${T60C2[@]}"
expect_red 'T16060:C3 production gate always false' src/utils/coldBackendTracker.js \
  'const IS_PRODUCTION_BACKEND = API_BASE === PRODUCTION_API_BASE;' 'const IS_PRODUCTION_BACKEND = false;' vt "${T60C3[@]}"

exit $FAIL
