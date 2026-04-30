# T2160: Tracker Re-acquisition & Gap Bridging

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

The overlay system is only as good as the tracker. Current pain points:
1. When a player exits the frame and returns, manually re-selecting is friction
2. If YOLO drops the player for <0.5s (occluded by another player), the overlay disappears abruptly
3. Both issues make overlays look amateur vs the smooth tracking in professional edits

## Solution

### Re-acquisition
Store the player's appearance embedding (jersey color histogram + number OCR if visible) when first selected. On re-entry to frame, auto-suggest "this is the same player" and re-attach the overlay.

1. **Appearance embedding** -- extract jersey color histogram + bbox aspect ratio from initial YOLO selection
2. **Re-entry detection** -- when a new YOLO detection appears that matches the stored embedding above threshold, show auto-suggest
3. **User confirmation** -- "Same player?" prompt with one-click accept/reject. Don't auto-attach without user consent.

### Gap Bridging
When YOLO drops the player for <0.5s (brief occlusion), interpolate the spline through the gap instead of dropping the overlay.

1. **Gap detection** -- identify drops shorter than threshold (default 0.5s / ~15 frames at 30fps)
2. **Spline interpolation** -- connect last-known and first-recovered positions with smooth curve
3. **Confidence indicator** -- slightly reduce overlay opacity during interpolated frames to signal uncertainty

## Context

### Relevant Files
- YOLO detection pipeline
- Spline animation system
- Player tracking state management

### Related Tasks
- Depends on: T2100 (architecture -- primitives need stable tracking)
- Independent of other overlay primitives (can land in parallel)

### Technical Notes
- Appearance embedding doesn't need to be sophisticated. Jersey color histogram (HSV, 3-5 bins) + bbox height/width ratio covers most youth soccer scenarios.
- OCR on jersey number is nice-to-have, not required. Manual confirmation is fine for v1.
- Gap bridging is the higher-impact, lower-complexity improvement of the two. Consider shipping it first.
- Both improvements are backend/pipeline work -- no frontend overlay changes needed beyond the re-acquisition prompt UI.

## Acceptance Criteria

- [ ] Player appearance embedding stored on initial YOLO selection
- [ ] Re-entry auto-suggest when matching player detected after frame exit
- [ ] User confirmation flow for re-acquisition (not auto-attach)
- [ ] Gap bridging interpolates through drops < 0.5s
- [ ] Interpolated frames show reduced opacity
- [ ] No regression in existing manual keyframe override flow
