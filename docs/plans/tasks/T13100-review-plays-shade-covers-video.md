# T13100: Review plays at 1440 shades the whole playing video

**Status:** STAGING
**Impact:** 3
**Complexity:** 2
**Tier:** S (frontend guide shade)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-18 ([RESULTS.md section 10](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only, under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk.

## Problem

On Annotate review plays at 1440, the guide shade covers the whole playing video while the card names a tile below it, so the user loses sight of the video they are reviewing.

## Solution

Cut the shade out around the video during review plays, or shade only the region away from both the video and the named tile.

## Context

### Relevant Files
- `src/frontend/src/components/instructions/` (shade cutouts)
- `.claude/knowledge/guidance.md`

### Related Tasks
- Found by T12590 (2026-10-18 re-walk)

## Acceptance Criteria

- [ ] During review plays at 1440 the playing video is not shaded
- [ ] The named tile stays highlighted
