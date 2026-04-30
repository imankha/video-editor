# T2100: Composable Overlay Architecture

**Status:** TODO
**Impact:** 9
**Complexity:** 7
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

The overlay system currently supports a single highlight ellipse per player. To ship pulse rings, glow, arrows, player labels, and screen-anchored overlays, the architecture must support multiple overlay types with a common interface.

## Solution

Refactor the single-ellipse overlay into a composable primitive system:

1. **Overlay primitive base** -- common config interface: type, color, opacity, size scaling, start/end keyframes, tracker binding (player-attached vs screen-anchored)
2. **Primitive registry** -- each overlay type (ring, pulse, glow, arrow, label, badge) registers with shared rendering pipeline
3. **Composition engine** -- stacking order, collision avoidance (label flip), multi-overlay rendering per frame
4. **Backend model** -- extend overlay data schema to store an array of primitives per clip (replaces single ellipse config)
5. **Highlight ring upgrade** -- current ellipse becomes the first registered primitive, gains color picker + opacity slider

### Composition Rules (Stacking Order)
1. Spotlight cone (background dim layer)
2. Player overlay primitives (ring/glow/etc.)
3. Player labels (text tags)
4. Screen-anchored badges (event callouts, score bug)
5. Manual telestration (arrows, circles)

## Context

### Relevant Files
- `src/frontend/src/components/overlay/` -- current overlay UI
- `src/frontend/src/hooks/useOverlay*.js` -- overlay state hooks
- `src/backend/app/routers/overlay.py` -- overlay API endpoints
- `src/backend/app/storage/` -- overlay data persistence
- FFmpeg overlay rendering pipeline (backend export)

### Related Tasks
- Blocks: T2120, T2130, T2140, T2150 (all primitives depend on this architecture)
- Related: T1100 (dead overlay debounce -- already fixed)

### Technical Notes
- Must maintain backward compatibility with existing ellipse data (migration or fallback)
- FFmpeg export pipeline must handle rendering multiple overlay layers per frame
- Frontend preview must composite overlays in real-time (Canvas or CSS-based)
- Follow gesture-based persistence: overlay primitive changes persist via explicit user actions, not reactive effects

## Acceptance Criteria

- [ ] Overlay data model supports array of typed primitives per clip
- [ ] Existing highlight ring works as a registered primitive (no regression)
- [ ] Composition engine renders overlays in correct stacking order
- [ ] Color picker + opacity slider on highlight ring
- [ ] Backend API accepts/returns new overlay format
- [ ] FFmpeg export renders multiple overlay layers
- [ ] Migration handles existing single-ellipse data
