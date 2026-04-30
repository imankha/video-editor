# T2200: Outline Trace Primitive

**Status:** TODO
**Impact:** 5
**Complexity:** 7
**Created:** 2026-04-30
**Updated:** 2026-04-30
**Phase:** 3

## Problem

Premium-feel player isolation effect -- edge-detecting the player silhouette and drawing an outline. Looks great in professional edits but computationally expensive.

## Solution

Edge detection on player bounding box, draw outline per frame. Options:
- Canny edge detection on player bbox crop
- Contour extraction from segmentation mask
- Configurable line color, thickness, glow

## Context

### Related Tasks
- Depends on: T2100 (composable overlay architecture)

### Technical Notes
- Computationally expensive per frame. May require GPU (Modal) or accept slower CPU export.
- Consider using a simpler bbox-outline approximation for v1 of this primitive.
- Deferred from Phase 1 per spec guidance.

## Acceptance Criteria

- [ ] Outline trace primitive following player tracker
- [ ] Configurable color, thickness, glow
- [ ] Acceptable performance for typical clip lengths (10-30s)
- [ ] FFmpeg export renders outline correctly
