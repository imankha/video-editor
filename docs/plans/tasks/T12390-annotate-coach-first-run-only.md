# T12390: Annotate coach guidance should stop after the first play

**Status:** STAGING (PR #591 merged)
**Impact:** 3
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-10
**Updated:** 2026-10-10
**Found by:** [T12320](T12320-restore-frontend-unit-tests-green.md) item 6

## Problem

`docs/designs/instruction-coach-system.md` says the Annotate coach guidance disappears after the first play. It no longer does: it shows on every visit. The test "the helper is not shown once the game has plays" passes vacuously because `mark-play-helper` never exists, so it guards nothing.

## Solution

Decide the intended behavior against the design doc and the guidance-on-by-default rule (T12300: guidance stays on until the user turns it off). Then either (a) make the coach first-run only per the design doc, or (b) amend the design doc to match the current always-on behavior. Replace the vacuous test with one that asserts the chosen behavior through the real coach element.

## Context

### Relevant Files (REQUIRED)

- `docs/designs/instruction-coach-system.md`
- `src/frontend/src/modes/AnnotateModeView.firstRunDisclosure.test.jsx` and the coach model used by AnnotateModeView

### Related Tasks

- T12300 (guidance preference persists) may conflict with option (a); settle that first. Likely judged in the T12310 walkthrough.

## Implementation

### Steps

1. [ ] Rule on (a) vs (b), citing T12300
2. [ ] Failing test through the real coach element, then implement
3. [ ] Commit with subject starting `T12390:`

## Acceptance Criteria

- [ ] Behavior and design doc agree
- [ ] No test passes vacuously on a nonexistent element
