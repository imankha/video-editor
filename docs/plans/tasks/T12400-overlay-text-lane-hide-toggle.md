# T12400: Overlay Text lane can be hidden once shown (decision)

**Status:** TODO
**Impact:** 3
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-10
**Updated:** 2026-10-11
**Found by:** [T12320](T12320-restore-frontend-unit-tests-green.md) item 2

## Problem

3662653a0 deleted the Text lane disclosure toggle. Once the Text lane is shown via "Add text" it cannot be hidden again. The textLaneDisclosure tests were rewritten around "Add text".

## Solution

Ruling needed: **restore a hide toggle** (user control back, extra UI after a deliberate unification) or **leave as is** (consistent, lane takes permanent space). Judged during [T12310](staging-qa-2026-10-08/T12310-re-run-staging-walkthrough.md). If "leave as is", mark this OBSOLETE.

## Ruling (2026-10-11, T12310 re-run, user agreed)

Restore a minimal version, not a user toggle: auto-collapse the Text lane when it holds no text (also after the last text is deleted). "Add text" stays the single entry point. Evidence: [RESULTS.md](../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 6a (rr-111, rr-113, rr-116). The phone "Add text" sheet wording is a separate task (T12500).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/OverlayModeView.textLaneDisclosure.test.jsx`
- Overlay Text lane in `src/frontend/src/modes/OverlayModeView.jsx`

## Implementation

### Steps

1. [x] Ruling from T12310: auto-collapse the empty Text lane (no toggle)
2. [ ] Failing test first (lane absent with no text, also after deleting the last text), then the collapse
3. [ ] Commit with subject starting `T12400:`

## Acceptance Criteria

- [x] Ruling recorded in this file
- [ ] The Text lane is hidden whenever it holds no text, including after the last text is deleted, covered by a test

## Evidence screenshots

Kept in `staging-qa-2026-10-08/re-run/screens/T12400/` (delete that folder when this task is archived):

- [rr-111-overlay-timeline-no-text-1440.jpg](staging-qa-2026-10-08/re-run/screens/T12400/rr-111-overlay-timeline-no-text-1440.jpg)
- [rr-112-overlay-timeline-with-text-lane-1440.jpg](staging-qa-2026-10-08/re-run/screens/T12400/rr-112-overlay-timeline-with-text-lane-1440.jpg)
- [rr-113-overlay-after-delete-text-region-1440.jpg](staging-qa-2026-10-08/re-run/screens/T12400/rr-113-overlay-after-delete-text-region-1440.jpg)
- [rr-114-m390-overlay-timeline-no-text.jpg](staging-qa-2026-10-08/re-run/screens/T12400/rr-114-m390-overlay-timeline-no-text.jpg)
- [rr-116-m390-overlay-timeline-with-text-lane.jpg](staging-qa-2026-10-08/re-run/screens/T12400/rr-116-m390-overlay-timeline-with-text-lane.jpg)
