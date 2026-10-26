# T13590: The big Annotate button swaps from Mark play to Make highlight under your finger

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Tier:** M (frontend Annotate)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, 390x844 (report bug 22, screenshot `p2-after-click-390.png`).

## Problem

While the game plays, the large primary button is "Mark play". When the playhead enters an existing play's range the same spot becomes "Make portrait highlight". A parent tapping Mark play at that moment opens Frame for the existing play instead of marking a new one.

## Repro steps

1. 390x844, open "Vs Carlsbad QA" (plays at 0:04, 0:26, 0:43, 1:01), press Play from 0:00.
2. As the playhead passes ~0:26, tap the big button where Mark play was.

**Expected:** a new play is marked (or the button does not change while playing).
**Actual (before fix):** Frame opens for Play 2.

## Context

### Relevant Files
- Annotate action row / mode switch on playhead-in-play; `.claude/knowledge/annotate.md`

## Verify the fix (required, before and after)

1. **Before the fix:** reproduce and record that Frame opened; write a test that plays into a play's range and taps the primary action, asserting a play is added; see it fail.
2. **After the fix:** same steps: a play is marked (play count +1) and no navigation.

## Acceptance Criteria

- [ ] Tapping the primary button while playing never navigates away unexpectedly
- [ ] Test fails before, passes after
