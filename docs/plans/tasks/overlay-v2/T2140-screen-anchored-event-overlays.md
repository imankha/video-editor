# T2140: Screen-Anchored Event Overlays

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

Clips lack context. A viewer doesn't know the score, what just happened, or who's playing. Screen-anchored overlays (score bug, event badges) tell the story without the parent needing to add voiceover or captions.

## Solution

Timestamp-triggered overlays anchored to screen positions (not player tracking).

### Overlay Types

| Overlay | Anchor | Behavior |
|---------|--------|----------|
| Score bug | Top-left or top-right | "HOME 2 - 1 AWAY" persistent badge |
| Event badge | Center, brief | "GOAL" / "ASSIST" / "SAVE" with 1.5s entrance animation |
| Match metadata | Bottom strip | "vs Strikers FC - Sep 14" -- opening 2s of clip |
| Time of play | Top corner | "73'" |
| Custom text | User-positioned | Free text, draggable |

1. **Timestamp triggers** -- each overlay has start_time and duration
2. **Entrance animations** -- event badge slides/fades in, holds, fades out
3. **Templates** -- pre-designed visual styles (parents don't want to design from scratch)
4. **Corner allocation** -- score bug and event badge default to opposite corners to avoid overlap

## Context

### Relevant Files
- `src/frontend/src/components/overlay/` -- overlay UI
- FFmpeg export pipeline

### Related Tasks
- Depends on: T2100 (architecture)
- Blocks: T2150 (presets wire up event overlays)

### Technical Notes
- Pure compositing, no credit cost. Same pricing as current overlay export.
- CPU-side FFmpeg rendering only.
- Event badge animation: scale from 0->1 + opacity fade, hold 1.5s, fade out. Simple keyframe math.
- Score bug could optionally pull from a future "match data" feature, but for v1 it's manual text entry.

## Acceptance Criteria

- [ ] Score bug overlay with configurable team names and score
- [ ] Event badge with entrance/exit animation ("GOAL", "ASSIST", "SAVE")
- [ ] Match metadata strip
- [ ] Time of play display
- [ ] Custom text overlay with drag positioning
- [ ] All overlays timestamp-triggered with start_time + duration
- [ ] Corner allocation avoids overlap between overlays
- [ ] FFmpeg export renders all screen-anchored overlays
