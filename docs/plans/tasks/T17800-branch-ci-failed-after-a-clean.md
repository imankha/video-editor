# T17800: Branch CI failed after a clean verdict

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-19
**Updated:** 2026-11-19

## Problem

Found by the /dotask verifier on group g-t17780-3 at f72acee1f, which judged it unrelated to that branch. Impact and complexity are unscored defaults.

**Steps:** python3 scripts/test_ci_policy.py on f72acee1f and on an origin/master (1f84a1d23) worktree

**Expected:** 38 tests pass; every tracked path is classified

**Actual:** Both revisions fail test_every_tracked_path_is_classified with unclassified ['work/qa18-runtime.mjs']. That file comes from 08f036efc 'plan updates', which is already on origin/master, and git log origin/master..HEAD -- work/ is empty, so this branch does not touch it. The fix belongs on master (remove the scratch file or add a rule for work/).

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.

## Resolution (2026-11-19)

Fixed on master without a task branch: bef7b52c1 deleted the stray `work/qa18-runtime.mjs` (added by 08f036efc), and `scripts/ci_policy.py` on master also lists it in KNOWN_STRAYS (via PR #839). `python scripts/test_ci_policy.py` on origin/master 7f0328136 exits 0, which is this task's acceptance step. Nothing left to do; owner Resolves on the board.
