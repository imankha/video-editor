# T355: Permanent Keyframes Not Selectable

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-03-07

## Problem

Permanent keyframes (frame 0 and endFrame) cannot be selected by clicking their diamond markers in the timeline. The click handler fires (seek works — the playhead moves to the keyframe position), but the selection highlight doesn't appear. This means users can't interact with boundary keyframes to edit their crop values.

## Investigation

### What works
- `handleKeyframeClick` in FramingContainer.jsx (line 584) fires and calls `seek(time)` — playhead moves correctly
- CropLayer.jsx line 131: `onClick={() => onKeyframeClick(keyframeTime, index)}` fires for all keyframes including permanent ones
- KeyframeMarker.jsx line 89: `onClick ? 'cursor-pointer' : 'pointer-events-none'` — onClick is always provided

### What doesn't work
- `selectedCropKeyframeIndex` in FramingScreen.jsx uses `findKeyframeIndexNearFrame(keyframes, currentFrame, FRAME_TOLERANCE)` where `FRAME_TOLERANCE = 5`
- After seeking, the selection highlight doesn't appear on permanent keyframes

### Likely causes
1. **Z-index / hit area at timeline edges**: Permanent keyframes sit at position 0% and 100%, where edge padding or container clipping may interfere
2. **Trim undo buttons overlapping**: The trim controls may sit on top of the first/last keyframe diamonds, intercepting clicks
3. **Frame tolerance mismatch**: After seeking to frame 0 or endFrame, `currentFrame` may not match within `FRAME_TOLERANCE` due to rounding or video player frame reporting

## Solution

Investigate the three likely causes and fix whichever is blocking selection. Most likely a positioning/overlap issue at timeline edges.

## Context

### Relevant Files
- `src/frontend/src/screens/FramingScreen.jsx` - `selectedCropKeyframeIndex` computation
- `src/frontend/src/containers/FramingContainer.jsx` - `handleKeyframeClick` handler
- `src/frontend/src/components/timeline/KeyframeMarker.jsx` - Diamond marker click area
- `src/frontend/src/modes/framing/layers/CropLayer.jsx` - Keyframe rendering in timeline
- `src/frontend/src/utils/keyframeUtils.js` - `findKeyframeIndexNearFrame`, `FRAME_TOLERANCE`

### Related Tasks
- T350: Sync Strategy Overhaul (same area of code)
- T340: Keyframe Integrity Guards (permanent keyframe handling)

## Implementation

### Steps
1. [ ] Reproduce the bug — confirm permanent keyframes don't highlight on click
2. [ ] Check if frame tolerance / rounding prevents matching at frame 0 and endFrame
3. [ ] Check if trim undo buttons or other UI elements overlap the diamonds at edges
4. [ ] Check if edge padding pushes markers outside clickable area
5. [ ] Fix the root cause
6. [ ] Verify both permanent keyframes can be selected and their crop values edited

## Acceptance Criteria

- [ ] Clicking frame 0 keyframe diamond selects it (highlight visible)
- [ ] Clicking endFrame keyframe diamond selects it (highlight visible)
- [ ] Selected permanent keyframe's crop values are editable in the crop panel
- [ ] Non-permanent keyframes still selectable (no regression)
