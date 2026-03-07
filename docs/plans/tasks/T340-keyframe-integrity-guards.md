# T340: Crop Keyframe Integrity Guards

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-03-06

## Problem

Multiple crop keyframe integrity issues discovered during T330 testing:

### 1. Missing Permanent Start Keyframe
A clip was observed with no permanent keyframe at frame 0. The crop layer showed user keyframes in the middle of the timeline but nothing at the start. Every clip MUST have permanent keyframes at frame 0 (start) and the end frame.

**Likely causes:**
- Keyframe initialization/restore path doesn't enforce the invariant
- Deleting user keyframes near the start somehow corrupts the permanent keyframe
- Clip switching or trim operations lose the start keyframe

### 2. Overlapping Keyframes (No Minimum Spacing)
Two user keyframes were observed only 6 frames apart (frames 79 and 85 at 30fps = 0.2 seconds). At normal timeline zoom, the diamonds overlap making it impossible to distinguish or independently select them.

### 3. Selection Confusion with Close Keyframes
When keyframes are very close together, clicking one may select the wrong one due to `findKeyframeIndexNearFrame` with `FRAME_TOLERANCE = 2`. Users can accidentally delete the wrong keyframe.

## Solution

### Guard 1: Enforce permanent keyframe invariant
- On every keyframe state change (add, remove, restore, trim), verify frame 0 and endFrame have permanent keyframes
- If missing, reconstitute them from the nearest keyframe's data
- Add a `RESTORE_KEYFRAMES` guard that validates and fixes the array before applying

### Guard 2: Minimum keyframe spacing
- Prevent adding a user keyframe within N frames of an existing keyframe (suggest N=5 at 30fps = ~0.17s)
- In `ADD_KEYFRAME` reducer: if a new keyframe would be within N frames of an existing one, snap to the existing keyframe (update instead of add)
- The existing `findKeyframeIndexNearFrame` with `FRAME_TOLERANCE` already does this partially — verify the tolerance is sufficient

### Guard 3: Selection disambiguation
- When `findKeyframeIndexNearFrame` finds multiple candidates within tolerance, prefer the one closest to the target frame
- Consider visual feedback: highlight which keyframe is selected when hovering near overlapping markers

## Key Files

- `src/frontend/src/controllers/keyframeController.js` — Reducer with `ADD_KEYFRAME`, `REMOVE_KEYFRAME`, `RESTORE_KEYFRAMES`, `INITIALIZE`
- `src/frontend/src/utils/keyframeUtils.js` — `findKeyframeAtFrame`, `findKeyframeIndexNearFrame`, `FRAME_TOLERANCE`
- `src/frontend/src/hooks/useKeyframeController.js` — Hook exposing keyframe operations
- `src/frontend/src/modes/framing/hooks/useCrop.js` — Crop-specific keyframe initialization
- `src/frontend/src/modes/framing/layers/CropLayer.jsx` — Keyframe rendering on timeline
- `src/frontend/src/controllers/keyframeController.test.js` — Existing tests

## Acceptance Criteria

- [ ] Every clip always has permanent keyframes at frame 0 and endFrame
- [ ] Cannot add a user keyframe within 5 frames of an existing keyframe (snaps to existing instead)
- [ ] Restoring saved keyframes validates and repairs missing permanent keyframes
- [ ] Existing keyframe controller tests still pass
- [ ] New tests for invariant enforcement and minimum spacing

## Investigation Needed

Before implementation, reproduce the missing start keyframe:
1. Check `RESTORE_KEYFRAMES` reducer — does it validate permanent keyframes exist?
2. Check `useCrop.js` initialization — what happens when saved keyframe data has no frame 0?
3. Check trim operations — does `START_TRIM` / `END_TRIM` ever remove the frame 0 keyframe?
