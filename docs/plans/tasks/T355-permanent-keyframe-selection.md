# T355: Permanent Keyframes Not Selectable

**Status:** DONE
**Impact:** 5
**Complexity:** 3
**Created:** 2026-03-07
**Updated:** 2026-03-07

## Problem

Permanent keyframes (frame 0 and endFrame) cannot be selected by clicking their diamond markers in the timeline. The click handler fires (seek works — the playhead moves to the keyframe position), but the selection highlight doesn't appear. Users can't interact with boundary keyframes to edit their crop values.

This also affects non-30fps videos for ALL keyframes, not just permanent ones.

## Root Cause

**Two issues found:**

### 1. Hardcoded framerate in `useCrop` and `useHighlight` (minor)

Both hooks initialized framerate as `useState(30)` instead of reading from `videoMetadata.framerate`. Fixed by deriving from `videoMetadata?.framerate || 30`. Note: currently all extracted clips are 30fps, so this was latent rather than actively broken.

### 2. Trim clamping breaks time-based keyframe selection (primary cause)

Permanent keyframes exist at the full video boundaries (frame 0 and endFrame=451 for a 15s video), but when the video has trimmed segments, `seek()` clamps to the visible trim range via `clampToVisibleRange()`.

**How this breaks selection:**

1. Video has trim range 1.294s → 11.613s (frames 39 → 348)
2. Permanent end keyframe is at frame 451 (15.033s)
3. User clicks the endFrame diamond → `seek(15.033)` → clamped to 11.613s
4. `selectedCropKeyframeIndex` computes: `currentFrame = Math.round(11.613 * 30) = 348`
5. `findKeyframeIndexNearFrame(keyframes, 348, FRAME_TOLERANCE=5)` → no match (nearest is 275 or 451)
6. No match → selection highlight doesn't appear

Same issue for frame 0 keyframe when trim start > 0: seek clamps to trim start, currentFrame doesn't match frame 0.

## Solution

Extract framerate from `videoMetadata` instead of hardcoding it.

### Approach

Replace `useState(30)` with a value derived from `videoMetadata.framerate` in both hooks. Since `videoMetadata` may arrive asynchronously (after video loads), handle the initial null case with a default of 30.

## Context

### Relevant Files

**Fix 1 — Framerate (2 files):**
- `src/frontend/src/modes/framing/hooks/useCrop.js:65` — `useState(30)` → `videoMetadata?.framerate || 30`
- `src/frontend/src/modes/overlay/hooks/useHighlight.js:21` — same fix

**Fix 2 — Trim clamping (1 file):**
- `src/frontend/src/screens/FramingScreen.jsx` — Added `clickedKeyframeIndexRef` that tracks direct keyframe clicks. `selectedCropKeyframeIndex` uses this as fallback when `findKeyframeIndexNearFrame` fails (i.e., when seek was clamped by trim). Ref is cleared on playback start and when a time-based match succeeds.

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
