# T2170: Glow & Arrow Primitives

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-04-30
**Updated:** 2026-04-30
**Phase:** 2

## Problem

The highlight ring and pulse ring cover close-up and dramatic moments, but two common scenarios remain unaddressed: subtle continuous player identification (glow) and wide-shot player indication (arrow).

## Solution

### Glow / Aura
Soft radial gradient rendered under the player for subtle continuous identification. Less visually aggressive than rings.
- Radial gradient centered on player bbox
- Configurable color, radius, opacity
- Constant (no animation) or slow pulse option

### Arrow Pointer
Floating arrow above the player for wide shots where the player is small and rings are hard to see.
- Arrow positioned above player bbox, follows tracker
- Configurable color, size, style (solid, outlined)
- Animated entrance (slides in from above)

## Context

### Related Tasks
- Depends on: T2100 (composable overlay architecture)
- Used by: T2190 (extended presets)

## Acceptance Criteria

- [ ] Glow primitive with configurable color, radius, opacity
- [ ] Arrow pointer primitive following player tracker
- [ ] Both render correctly in FFmpeg export
- [ ] Both have real-time preview in overlay editor
