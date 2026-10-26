# T13530: Mark play is still cut off at 1440x900 and hidden at 1024x768 on staging (T13170 does not hold)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M (frontend layout)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26 (report bug 30, screenshots `BUG-30-mark-play-below-fold-1440.png`, `BUG-30b-mark-play-below-fold-1024.png`). T13170 is marked STAGING but the staging build (`00da6bf18`) still shows the problem.

## Problem

On Annotate for a game with plays, with the playhead outside any play, the action row (Mark play, Review plays, Share plays, Add footage) starts at y=856 at 1440x900 (bottom at 981) and at 1024x768 only the top ~44 px of Mark play is visible. Mark play is the main control of the screen.

## Repro steps

1. Desktop browser at 1440x900 (then 1024x768), Guidance on, sign in.
2. Home > Games > open "Vs Carlsbad QA" (any game with several plays and two videos).
3. Click an empty spot on the timeline so no play is selected.
4. Without scrolling, look for Mark play. Measure: `[...document.querySelectorAll('button')].find(b=>/Mark play/.test(b.getAttribute('aria-label'))).getBoundingClientRect().bottom` vs `innerHeight`.

**Expected:** Mark play, Review plays and Share plays fully visible (bottom <= innerHeight) at both sizes.
**Actual (before fix):** bottom 981 > 900 at 1440x900; mostly below the fold at 1024x768.

First check whether staging actually contains T13170's commit; if it does, find what still pushes the row down (the "Video 1 of 2" picker row and the two-lane timeline were present here).

## Context

### Relevant Files
- `docs/plans/tasks/T13170-mark-play-below-fold-1440-1024.md` (previous fix)
- Annotate layout components; `.claude/knowledge/annotate.md`

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro on the current build at both sizes and record the measured bottom vs innerHeight; the e2e/layout test must fail on it (use a game with 2 videos and several plays, the geometry that failed here).
2. **After the fix:** same game, same sizes, record bottom <= innerHeight for all three buttons.

## Acceptance Criteria

- [ ] Mark play, Review plays, Share plays fully visible without scrolling at 1440x900 and 1024x768 on a game with 2 videos and 6 plays
- [ ] Layout test with that geometry fails before, passes after
