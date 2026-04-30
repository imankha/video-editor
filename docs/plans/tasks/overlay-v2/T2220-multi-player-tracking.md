# T2220: Multi-Player Tracking

**Status:** TODO
**Impact:** 6
**Complexity:** 7
**Created:** 2026-04-30
**Updated:** 2026-04-30
**Phase:** 3

## Problem

Some clips feature two key players (e.g., the assist and the goal scorer). Currently only one player can be tracked and overlaid. Highlighting both tells a richer story.

## Solution

Support 2+ simultaneous player tracks, each with independent overlay primitives.

1. **Multi-selection** -- allow selecting multiple YOLO detections, each gets its own tracker
2. **Independent overlays** -- each tracked player has its own set of overlay primitives (can mix types)
3. **Label differentiation** -- different player labels with different profiles/colors
4. **Composition** -- multiple player overlays follow the same stacking rules, ordered by track creation time

## Context

### Related Tasks
- Depends on: T2100 (architecture), T2160 (re-acquisition helps manage multiple tracks)

### Technical Notes
- Defer until demand is clear. Single-player tracking covers the vast majority of use cases.
- Main complexity: YOLO identity persistence across frames for multiple players simultaneously.
- UI complexity: managing multiple overlay configs without overwhelming the user.

## Acceptance Criteria

- [ ] Select and track 2+ players simultaneously
- [ ] Each player has independent overlay primitives
- [ ] Player labels differentiate between tracked players
- [ ] FFmpeg export renders all tracked players' overlays
- [ ] No regression in single-player tracking performance
