# T15950: 1.5x ETA accuracy half of AC3 is unaddressed and untested

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-10
**Updated:** 2026-11-10

## Problem

Found by the /dotask verifier on group g-t15510-2 at 67b981f86, which judged it unrelated to that branch. Impact and complexity are unscored defaults.

**Steps:** Sharpen a highlight whose per-frame rate is measured from a short, unrepresentative early window right after frames start flowing (model-load ends, then only 1-2 frame samples arrive before the first estimate is shown) -- the task's own repro: estimate read at 76-78s elapsed shows 'About 3 minutes'/'About 4 minutes' against ~86s actually left (1.6-2.8x), correcting only once more samples accumulate past ~85s.

**Expected:** Shown estimate stays within 1.5x of actual remaining time from the first estimate shown.

**Actual:** calculateETA has no bound relating its output to the true remaining time; for any estimate taken within FRAME_RATE_WINDOW_MS (20s) of the current rate-measurement anchor, the fix's reset condition is false and the code computes the exact same unbounded average as pre-fix master. Confirmed empirically on this HEAD: a 4-frames-in-14s anchor window with 160 total frames yields 'About 10 minutes' (570s) against an 86s actual remaining -- a 6.6x overshoot -- via calculateETA directly. Master has the identical core formula (no anchor-reset exists at all on master), so the same unbounded first-window overshoot is present there too, unrelated to this branch's change.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
