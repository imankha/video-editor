# T2120: Pulse Ring Primitive

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

The current highlight ring is static. For dramatic moments (goals, big saves), a pulsing animation draws the viewer's eye and matches the energy of professional TikTok/IG soccer edits.

## Solution

New "pulse ring" overlay primitive: animated scale + opacity loop that follows the player tracker.

1. **Animation parameters** -- pulse frequency (default ~2 pulses/sec), scale range (1.0-1.3x), opacity range (0.6-1.0), duration (1-2s default)
2. **Frontend preview** -- CSS/Canvas animation in overlay editor showing the pulse in real-time
3. **FFmpeg rendering** -- frame-by-frame scale/opacity interpolation in export pipeline
4. **Keyframe support** -- start/end keyframes for when the pulse activates (e.g., only during the goal moment)

## Context

### Relevant Files
- `src/frontend/src/components/overlay/` -- overlay primitives
- FFmpeg export pipeline (backend)

### Related Tasks
- Depends on: T2100 (composable overlay architecture)
- Related: Existing highlight ring implementation

### Technical Notes
- Pure compositing, no GPU needed
- Animation math: sinusoidal scale/opacity curve per frame
- Must look good at 30fps and 60fps export

## Acceptance Criteria

- [ ] Pulse ring primitive registered in overlay system
- [ ] Configurable frequency, scale range, opacity range, duration
- [ ] Real-time preview in overlay editor
- [ ] FFmpeg export renders pulse animation correctly
- [ ] Follows player tracker like existing highlight ring
