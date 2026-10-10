# T12400: Overlay Text lane can be hidden once shown (decision)

**Status:** TODO (blocked on a ruling from the T12310 walkthrough)
**Impact:** 3
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-10
**Updated:** 2026-10-10
**Found by:** [T12320](T12320-restore-frontend-unit-tests-green.md) item 2

## Problem

3662653a0 deleted the Text lane disclosure toggle. Once the Text lane is shown via "Add text" it cannot be hidden again. The textLaneDisclosure tests were rewritten around "Add text".

## Solution

Ruling needed: **restore a hide toggle** (user control back, extra UI after a deliberate unification) or **leave as is** (consistent, lane takes permanent space). Judged during [T12310](staging-qa-2026-10-08/T12310-re-run-staging-walkthrough.md). If "leave as is", mark this OBSOLETE.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/OverlayModeView.textLaneDisclosure.test.jsx`
- Overlay Text lane in `src/frontend/src/modes/OverlayModeView.jsx`

## Implementation

### Steps

1. [ ] Get the ruling from T12310
2. [ ] If restore: failing test first, then the toggle
3. [ ] Commit with subject starting `T12400:`

## Acceptance Criteria

- [ ] Ruling recorded in this file
- [ ] If restored, the lane can be hidden and shown again, covered by a test
