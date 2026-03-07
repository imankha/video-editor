# T355: Permanent Keyframes Not Selectable

**Status:** TESTING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-03-07
**Updated:** 2026-03-07

## Problem

Permanent keyframes (frame 0 and endFrame) cannot be selected by clicking their diamond markers in the timeline. The click handler fires (seek works — the playhead moves to the keyframe position), but the selection highlight doesn't appear. Users can't interact with boundary keyframes to edit their crop values.

This also affects non-30fps videos for ALL keyframes, not just permanent ones.

## Root Cause

**Hardcoded framerate in `useCrop` and `useHighlight`.**

Both hooks initialize framerate as `useState(30)` instead of reading from `videoMetadata.framerate`:

```javascript
// useCrop.js:65
const [framerate] = useState(30); // Default framerate - TODO: extract from video

// useHighlight.js:21
const [framerate] = useState(30);
```

Meanwhile, `videoMetadata` is passed to both hooks and DOES contain the real framerate (extracted at FramingScreen.jsx:191).

### How this breaks selection

1. User loads a 60fps video
2. `useCrop` uses hardcoded `framerate = 30`
3. Permanent endFrame keyframe is stored at frame 600 (10s × 60fps)
4. User clicks the endFrame diamond → `seek(10)` → video currentTime = 10s
5. `selectedCropKeyframeIndex` computes: `currentFrame = Math.round(10 * 30) = 300`
6. `findKeyframeIndexNearFrame(keyframes, 300, FRAME_TOLERANCE=5)` looks for frame 300
7. Actual keyframe is at frame 600 → distance = 300, far exceeds FRAME_TOLERANCE=5
8. No match → selection highlight doesn't appear

For 30fps videos the bug is masked because the hardcoded value happens to be correct.

### Impact beyond permanent keyframes

This is actually a broader framerate bug. On non-30fps videos:
- ALL keyframe selection is broken (not just permanent ones)
- Keyframe positions in the timeline may be rendered incorrectly
- Frame calculations for trim ranges, segment boundaries are wrong
- Crop interpolation at specific frames may use wrong values

## Solution

Extract framerate from `videoMetadata` instead of hardcoding it.

### Approach

Replace `useState(30)` with a value derived from `videoMetadata.framerate` in both hooks. Since `videoMetadata` may arrive asynchronously (after video loads), handle the initial null case with a default of 30.

## Context

### Relevant Files

**Primary fix (2 files):**
- `src/frontend/src/modes/framing/hooks/useCrop.js:65` — `useState(30)` → use `videoMetadata.framerate`
- `src/frontend/src/modes/overlay/hooks/useHighlight.js:21` — same fix

**Dependent code (verify correctness after fix):**
- `src/frontend/src/screens/FramingScreen.jsx:643` — `selectedCropKeyframeIndex` computation uses `framerate` from useCrop
- `src/frontend/src/screens/OverlayScreen.jsx:278` — same for highlight keyframes
- `src/frontend/src/modes/framing/layers/CropLayer.jsx:92-99` — boundary frame calculations
- `src/frontend/src/modes/overlay/layers/HighlightLayer.jsx:192-199` — same
- `src/frontend/src/controllers/keyframeController.js` — `useKeyframeController` receives framerate

**Reference:**
- `src/frontend/src/utils/keyframeUtils.js:33-44` — `findKeyframeIndexNearFrame` (works correctly, just needs correct framerate input)

### Related Tasks
- T340: Keyframe Integrity Guards (permanent keyframe handling)
- T350: Sync Strategy Overhaul (same codebase area)

### Technical Notes

- `videoMetadata` is passed as the first argument to both `useCrop(videoMetadata, ...)` and `useHighlight(videoMetadata, ...)`
- `videoMetadata.framerate` is populated via `extractVideoMetadataFromUrl()` at FramingScreen.jsx:186-191
- The metadata may be `null` initially before video loads — need to handle this gracefully
- `framerate` is used throughout: keyframe frame calculations, interpolation, timeline positioning, endFrame computation
- Changing framerate after initialization may require re-running `ensurePermanentKeyframes` since endFrame depends on it

## Implementation

### Steps
1. [ ] In `useCrop.js`: Replace `useState(30)` with a derived value from `videoMetadata?.framerate || 30`
2. [ ] In `useHighlight.js`: Same fix
3. [ ] Verify keyframe controller receives updated framerate when metadata loads
4. [ ] Verify `ensurePermanentKeyframes` recalculates endFrame when framerate changes
5. [ ] Test: Select permanent keyframes on a 60fps video
6. [ ] Test: Select user keyframes on a 60fps video
7. [ ] Test: 30fps video still works (regression check)

## Acceptance Criteria

- [ ] Clicking frame 0 keyframe diamond selects it (highlight visible) on any framerate video
- [ ] Clicking endFrame keyframe diamond selects it (highlight visible) on any framerate video
- [ ] Selected permanent keyframe's crop values are editable in the crop panel
- [ ] Non-permanent keyframes still selectable (no regression)
- [ ] 30fps videos work identically to before (regression check)
- [ ] 60fps videos have correct keyframe positions and selection
