# T13030: Highlight ready toast stays until clicked and covers controls and guide anchors

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Tier:** S/M (frontend)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-18 ([RESULTS.md section 10](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only, under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk.

## Problem

The persistent "Highlight ready" View/Dismiss toast covers real controls: the Preview tile at 768 (it blocked a tap), the Add text tile at 1024 and the Play 3 tile at 390. With it showing, Home displayed "Scroll down to continue" over a fully visible game card at 390. Evidence: r2-toast-over-band-768, r2-overlay-pick-0-1024, r2-many-games-390.

## Solution

Auto-dismiss the toast after a short delay, keep it out of the action band and away from the current guide anchor, and exclude it from the scroll-hint visibility calculation.

## Context

### Relevant Files
- `src/frontend/src/` toast component and where the Highlight ready toast is raised
- `src/frontend/src/components/instructions/` (scroll hint)
- `.claude/knowledge/guidance.md`

### Related Tasks
- Found by T12590 (2026-10-18 re-walk)

## Acceptance Criteria

- [ ] The toast never overlaps the action band or the guide anchor at 1440, 1024, 768, 390
- [ ] It dismisses on its own
- [ ] Home shows no scroll hint when every card is visible
