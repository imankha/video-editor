# T2130: Player Label Overlay

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

Viewers watching a clip don't know which player to follow. A name/number label attached to the tracked player solves this immediately and is table stakes for professional-looking youth soccer content.

## Solution

Text tag overlay that follows the player tracker, pulling data from Player Profiles.

1. **Label content** -- name, jersey number, position (optional). Sourced from Player Profile (T2110) or manual entry.
2. **Auto-positioning** -- places above or below player based on available frame space. Flips when near frame edges.
3. **Style presets**:
   - "Minimal" -- small white text, semi-transparent background
   - "Broadcast" -- jersey-number badge with team color background, larger font
4. **Tracking** -- follows the same YOLO + spline tracker as other player-attached overlays
5. **FFmpeg rendering** -- text overlay with background rect, positioned relative to player bbox

## Context

### Relevant Files
- `src/frontend/src/components/overlay/` -- overlay UI
- Player tracking pipeline
- FFmpeg text overlay rendering

### Related Tasks
- Depends on: T2100 (architecture), T2110 (player profiles)
- Blocks: T2150 (presets use player labels)

### Technical Notes
- Collision avoidance: label must not overlap score bug or event badges. Auto-flip handles most cases.
- FFmpeg `drawtext` filter with dynamic positioning per frame based on tracker coordinates.
- Font choice matters for readability at small sizes on mobile. Use bold sans-serif.

## Acceptance Criteria

- [ ] Player label overlay registered as primitive
- [ ] Pulls name/number from Player Profile or manual entry
- [ ] Auto-positions above/below player based on frame space
- [ ] "Minimal" and "broadcast" style presets
- [ ] Follows player tracker
- [ ] FFmpeg export renders label correctly at all frame positions
- [ ] Readable on mobile screen sizes
