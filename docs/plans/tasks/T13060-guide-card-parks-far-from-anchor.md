# T13060: Guide card parks far from its anchor on Focus, Home Clips drafts and the Annotate editor

**Status:** STAGING
**Impact:** 5
**Complexity:** 4
**Tier:** M (frontend guide placement)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-18 ([RESULTS.md section 10](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only, under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk.

## Problem

The placement rule (near the item, on its screen-center side, never covering it) fails in three places: Focus steps 1 and 2 at 1440 and 1024 put the card over the Settings panel, 429 to 989 px from its anchor; Home Clips drafts at all four viewports put the card at the top while the tile is at the bottom (412 to 664 px); and the Annotate editor at all four. See T12590 RESULTS.md section 10.2 for the per-viewport cells.

## Solution

When there is room beside or above the anchor, place the card there before falling back to the top strip. Re-check every section 10.2 cell after the change.

## Context

### Relevant Files
- `src/frontend/src/components/instructions/` (card placement)
- `.claude/knowledge/guidance.md`

### Related Tasks
- Found by T12590 (2026-10-18 re-walk)

## Acceptance Criteria

- [ ] Every section 10.2 placement cell that failed on distance now passes at all four viewports
- [ ] A unit test covers the placement choice for an anchor near the bottom with room above
