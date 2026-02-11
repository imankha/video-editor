# T57: Stale Tracking Rectangles When Extending Overlay Region

**Status:** TODO
**Impact:** MEDIUM
**Complexity:** MEDIUM
**Created:** 2026-02-11
**Type:** BUG

## Problem

When extending an overlay/highlight region in Overlay mode, the tracking rectangles (green player detection boxes) from the last tracked frame persist and display incorrectly. The boxes don't correspond to the current video frame position.

See: `screenshots/bad_tracking.png`

## Expected Behavior

- Tracking rectangles should only show for frames that have detection data
- When extending a region into untracked territory, boxes should not appear (or should show "no detection" state)
- Each frame should show its own detection data, not stale data from another frame

## Likely Cause

When the highlight region is extended, the player detection overlay may be:
1. Using cached detection data from the last frame that had detections
2. Not checking if current time is within the detection data range
3. Not clearing/updating when region boundaries change

## Files to Investigate

```
src/frontend/src/modes/overlay/PlayerDetectionOverlay.jsx
src/frontend/src/hooks/usePlayerDetection.js (if exists)
src/frontend/src/modes/overlay/OverlayMode.jsx
```

## Acceptance Criteria

- [ ] Tracking rectangles only display for frames with actual detection data
- [ ] Extending a region does not show stale detection boxes
- [ ] Detection boxes update correctly when scrubbing through video
