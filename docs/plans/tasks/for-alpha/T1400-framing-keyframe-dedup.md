# T1400: Prevent Accidental Close Keyframes in Framing

**Status:** TESTING
**Priority:** 3.0 (Alpha feedback — users inadvertently create duplicate keyframes close together)
**Reported:** 2026-04-11
**Source:** Alpha user feedback

## Problem

In Framing mode, users sometimes create two keyframes very close together by accident. This happens when they adjust the crop box, release, then immediately adjust again — each mouse-up creates a new keyframe via `onCropComplete`. The result is two nearly-identical keyframes a few frames apart, which clutters the timeline and creates unexpected interpolation behavior.

## What's Already Implemented (T1660)

The `ADD_KEYFRAME` reducer in `keyframeController.js` (lines 310-363) now enforces dedup at the reducer level — catching ALL keyframe creation paths, not just `handleCropComplete`:

1. **Snap to nearby** (line 316-318): `findKeyframeIndexNearFrame(keyframes, frame, FRAME_TOLERANCE)` — if a keyframe exists within `FRAME_TOLERANCE` (5 frames / ~167ms at 30fps), the existing keyframe is updated instead of creating a new one.

2. **Minimum spacing rejection** (lines 322-324): if no snap target exists but another keyframe is within `MIN_KEYFRAME_SPACING` (10 frames / ~333ms at 30fps), the new keyframe is silently rejected (`return state`).

3. **Boundary absorption** (`ensurePermanentKeyframes`, lines 151-203): when boundaries change (trim/detrim/restore), nearby user keyframes within `MIN_KEYFRAME_SPACING` of frame 0 or endFrame are absorbed into the permanent boundary position.

4. **Middle permanent demotion** (lines 192-202): after boundary changes, old permanent keyframes that ended up in the middle are demoted to `origin: 'user'` so only first/last are permanent.

5. **Boundary deletion allowed** (`REMOVE_KEYFRAME`, lines 365-380): users can delete any keyframe including absorbed boundary permanents, as long as ≥3 keyframes exist. `ensurePermanentKeyframes` reconstitutes boundary permanents from the nearest remaining keyframe.

### Constants (keyframeUtils.js)
- `FRAME_TOLERANCE = 5` (line 65) — snap range for "same keyframe" detection
- `MIN_KEYFRAME_SPACING = 10` (line 74) — minimum distance between keyframes

## Final Fix

Unified `FRAME_TOLERANCE` and `MIN_KEYFRAME_SPACING` to the same value (10 frames). Now `FRAME_TOLERANCE = 10` and `MIN_KEYFRAME_SPACING = FRAME_TOLERANCE`. This means:
- Any keyframe creation within 10 frames of an existing one **snaps to and updates** the existing keyframe
- The silent rejection path (lines 322-324 in the reducer) is effectively dead code — the snap always catches it first
- No UX gap: the user's crop change is always applied, either to a new keyframe or by updating the nearest existing one

## Key Files

- `src/frontend/src/controllers/keyframeController.js` — ADD_KEYFRAME reducer (snap + spacing), REMOVE_KEYFRAME (boundary delete), `ensurePermanentKeyframes` (absorption + demotion)
- `src/frontend/src/utils/keyframeUtils.js` — `FRAME_TOLERANCE`, `MIN_KEYFRAME_SPACING`, `findKeyframeIndexNearFrame`
- `src/frontend/src/containers/FramingContainer.jsx` — `handleCropComplete` (creation path), `handleKeyframeDelete` (deletion with rollback)
- `src/backend/app/routers/clips.py` — `delete_crop_keyframe` action (frame-0 guard + min-2 count)

## Testing

- [x] Add keyframe, move 1-5 frames, adjust crop → updates existing keyframe (FRAME_TOLERANCE snap)
- [x] Add keyframe, move 6-9 frames, adjust crop → silently rejected (MIN_KEYFRAME_SPACING)
- [x] Move 15+ frames, adjust crop → creates new keyframe (beyond threshold)
- [x] Delete keyframe near boundary → allowed, boundary reconstituted from nearest
- [x] Delete boundary permanent when ≥3 exist → allowed, new permanent at boundary
- [x] No silent rejection — snap range covers full MIN_KEYFRAME_SPACING
