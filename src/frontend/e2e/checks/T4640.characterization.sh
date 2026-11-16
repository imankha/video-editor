#!/usr/bin/env bash
# T4640:C2 - characterization tests written before the change pass unchanged after it.
#
# The characterization cases (tests/test_t4640_share_flow.py::TestBothEndpointsShareTheSameCases)
# landed in the same commit as the refactor, so "written before" is proven the way the Landing
# Policy allows: the SAME test file, byte for byte, passes against the pre-change production
# revision (the T4640 commit's parent, in an isolated worktree) and against HEAD.
#   1. the test file at HEAD is unchanged since the T4640 commit (it was not edited to fit);
#   2. TestBothEndpointsShareTheSameCases passes on the parent of the T4640 commit;
#   3. it passes on HEAD, together with the pre-existing share tests the branch never touched.
# TestOneSharedFlow (the structural C1 test) is excluded from step 2: it fails on the base by design.
#
# Run from the repo root: bash src/frontend/e2e/checks/T4640.characterization.sh [base-ref]
set -euo pipefail
BASE_REF=${1:-origin/master}
git rev-parse --verify -q "$BASE_REF" >/dev/null || BASE_REF=master
TEST=src/backend/tests/test_t4640_share_flow.py
CASES=TestBothEndpointsShareTheSameCases

CHANGE=$(git log --reverse --format='%H %s' "$BASE_REF..HEAD" | grep -m1 ' T4640: One share flow for games$' | cut -d' ' -f1 || true)
[ -n "$CHANGE" ] || { echo "FAIL: no 'T4640: One share flow for games' commit on $BASE_REF..HEAD"; exit 1; }
PRE=$(git rev-parse "$CHANGE^")

if ! git diff --quiet "$CHANGE" HEAD -- "$TEST"; then
  echo "FAIL: $TEST was edited after $CHANGE"; exit 1
fi
if git cat-file -e "$PRE:$TEST" 2>/dev/null; then
  echo "FAIL: $TEST already exists at $PRE; expected it to arrive with $CHANGE"; exit 1
fi

WT=$(mktemp -d /tmp/t4640-pre.XXXXXX)
trap 'git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"' EXIT
git worktree add -q --detach "$WT" "$PRE"
cp "$TEST" "$WT/$TEST"
grep -q 'share_game_flow' "$WT/src/backend/app/routers/games.py" \
  && { echo "FAIL: $PRE already has the shared flow; it is not the pre-change revision"; exit 1; }

echo "== pre-change revision $PRE: $CASES"
(cd "$WT/src/backend" && python3 -m pytest "tests/test_t4640_share_flow.py::$CASES" -q -p no:cacheprovider) \
  || { echo "FAIL: characterization cases do not pass on the pre-change revision $PRE"; exit 1; }

echo "== HEAD $(git rev-parse --short HEAD): $CASES + untouched share tests"
(cd src/backend && python3 -m pytest "tests/test_t4640_share_flow.py::$CASES" \
  tests/test_share_playback.py tests/test_t5270_warm_recap_poster.py -q -p no:cacheprovider) \
  || { echo "FAIL: characterization cases do not pass on HEAD"; exit 1; }
for t in src/backend/tests/test_share_playback.py src/backend/tests/test_t5270_warm_recap_poster.py; do
  git diff --quiet "$BASE_REF" HEAD -- "$t" || { echo "FAIL: $t was edited on this branch"; exit 1; }
done
echo "PASS: the same characterization file passes on $PRE (pre-change) and HEAD"
