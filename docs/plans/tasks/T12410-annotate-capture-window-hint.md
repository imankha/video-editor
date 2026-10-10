# T12410: Annotate capture-window hint ("6 seconds before, 2 after") (decision)

**Status:** TODO (blocked on a ruling from the T12310 walkthrough)
**Impact:** 4
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-10
**Updated:** 2026-10-10
**Found by:** [T12320](T12320-restore-frontend-unit-tests-green.md) item 3

## Problem

The capture-window hint is gone. `ANNOTATE.MARK_PLAY_HELPER` is dead code and the coach watch body is empty. `docs/designs/instruction-coach-system.md` says the hint should move to a supporting line or a Why? disclosure. The firstRunDisclosure test that guarded the numbers was rewritten.

## Solution

Ruling needed: **restore** as a supporting line or Why? disclosure (users learn what a mark captures, more copy) or **drop** (cleaner, but the capture window is hidden; delete the dead string and amend the design doc). Judged during [T12310](staging-qa-2026-10-08/T12310-re-run-staging-walkthrough.md): does a first-time user understand what a mark captures without it? Copy must not claim the app frames or tracks automatically.

## Context

### Relevant Files (REQUIRED)

- `ANNOTATE.MARK_PLAY_HELPER` in the copy constants
- `docs/designs/instruction-coach-system.md`
- `src/frontend/src/modes/AnnotateModeView.firstRunDisclosure.test.jsx`

## Implementation

### Steps

1. [ ] Get the ruling from T12310
2. [ ] Restore with a failing test first, or delete the dead string and amend the design doc
3. [ ] Commit with subject starting `T12410:`

## Acceptance Criteria

- [ ] Ruling recorded in this file
- [ ] No dead `MARK_PLAY_HELPER` string remains, and the design doc matches behavior
