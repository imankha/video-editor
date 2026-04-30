# T2210: Spotlight Cone Primitive

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-04-30
**Updated:** 2026-04-30
**Phase:** 3

## Problem

High-drama moments (the 2 seconds leading up to a goal) benefit from darkening/desaturating everything outside the player region. Creates a cinematic spotlight effect.

## Solution

Background dim layer centered on player position:
- Darken + desaturate everything outside an elliptical region around the player
- Configurable: dim opacity (default 0.6), desaturation level, region size
- Typically used for 1-3 seconds, not entire clip
- Entrance/exit animation (dim fades in over 0.5s)

## Context

### Related Tasks
- Depends on: T2100 (composable overlay architecture)
- Used by: T2150 ("Goal" preset -- Phase 1 uses a simpler approximation until this lands)

### Technical Notes
- FFmpeg vignette + desaturate filters with per-frame mask positioning
- Renders as the bottom layer in composition stack (under all other overlays)
- Deferred from Phase 1 per spec guidance

## Acceptance Criteria

- [ ] Spotlight cone primitive with configurable dim, desaturation, region size
- [ ] Entrance/exit fade animation
- [ ] Correct composition (bottom of stacking order)
- [ ] FFmpeg export renders correctly
- [ ] "Goal" preset updated to use real spotlight cone
