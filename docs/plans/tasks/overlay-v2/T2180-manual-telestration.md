# T2180: Manual Telestration

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-04-30
**Updated:** 2026-04-30
**Phase:** 2

## Problem

Parents making recruiting clips need to point out specific moments on a frozen frame (positioning, decision-making, technique). Currently there's no way to annotate a still frame.

## Solution

Freeze frame + draw tools for the recruiting use case. Keep surface area small -- this is not Hudl-style full telestration.

1. **Freeze frame** -- pause clip at a timestamp, draw overlays, hold frozen frame for 1-2s, resume playback
2. **Single arrow** -- drag-from-to, animates in during the freeze
3. **Circle** -- drag to position/size, highlights an area
4. **Line** -- straight line between two points
5. **Manual spotlight** -- drag-to-position circle that dims surroundings (separate from tracked player spotlight)

### UX Flow
1. User pauses clip at desired moment
2. Clicks "Draw" to enter telestration mode
3. Selects tool (arrow/circle/line)
4. Draws on frozen frame
5. Sets hold duration (default 1.5s)
6. Resumes playback -- video freezes at that frame, shows drawing, then continues

## Context

### Related Tasks
- Depends on: T2100 (composable overlay architecture)
- Related: T720 (Art Frames -- similar concept, may share implementation)

### Technical Notes
- Runs CPU-side only: FFmpeg freeze frame + `drawtext`/`drawbox` filters. No GPU needed -- keep free.
- Drawing coordinates stored as normalized (0-1) values relative to frame dimensions.
- Each telestration annotation is a distinct overlay primitive with a specific timestamp + hold duration.

## Acceptance Criteria

- [ ] Freeze frame mode in overlay editor
- [ ] Arrow, circle, line drawing tools
- [ ] Manual spotlight tool
- [ ] Configurable hold duration
- [ ] FFmpeg export renders freeze + drawings correctly
- [ ] CPU-only rendering, no credit cost
