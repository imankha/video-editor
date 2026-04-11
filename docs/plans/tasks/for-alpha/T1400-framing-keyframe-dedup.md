# T1400: Prevent Accidental Close Keyframes in Framing

**Status:** TODO
**Priority:** 3.0 (Alpha feedback — users inadvertently create duplicate keyframes close together)
**Reported:** 2026-04-11
**Source:** Alpha user feedback

## Problem

In Framing mode, users sometimes create two keyframes very close together by accident. This happens when they adjust the crop box, release, then immediately adjust again — each mouse-up creates a new keyframe via `onCropComplete`. The result is two nearly-identical keyframes a few frames apart, which clutters the timeline and creates unexpected interpolation behavior.

## Current State

There is already a `MIN_KEYFRAME_SPACING = 10` constant in `keyframeUtils.js` (line 74), defined as "10 frames = 333ms at 30fps". However, this constant is only used for **visual spacing of diamond icons on the timeline** — it is NOT enforced when creating keyframes.

The creation path:
1. User releases crop drag → `CropOverlay.jsx:handlePointerUp` (line 326)
2. Calls `onCropComplete()` → `FramingContainer.jsx:handleCropComplete` (line 293)
3. Calls `addOrUpdateKeyframe(currentTime, cropData)` → `useKeyframeController.js`
4. Dispatches `actions.addKeyframe(frame, data, origin)`

At step 4, if a keyframe already exists at the exact same frame, it updates it. But if the user is 2-3 frames away (barely moved the playhead), a **new** keyframe is created.

## Fix

In `handleCropComplete` (FramingContainer.jsx line 293), before calling `addOrUpdateKeyframe`, check if a user keyframe already exists within `MIN_KEYFRAME_SPACING` frames. If so, **update that nearby keyframe** instead of creating a new one.

```javascript
const handleCropComplete = useCallback((cropData) => {
  const frame = Math.round(currentTime * framerate);
  
  // Snap to nearby keyframe if within MIN_KEYFRAME_SPACING
  const nearbyKeyframe = keyframes.find(kf => 
    kf.origin === 'user' && Math.abs(kf.frame - frame) <= MIN_KEYFRAME_SPACING
  );
  const targetTime = nearbyKeyframe 
    ? nearbyKeyframe.frame / framerate 
    : currentTime;
  
  addOrUpdateKeyframe(targetTime, cropData, duration);
  // ... rest unchanged
}, [...]);
```

This reuses the existing `MIN_KEYFRAME_SPACING` constant for its intended purpose — preventing keyframes too close together.

## Files

- `src/frontend/src/containers/FramingContainer.jsx` — `handleCropComplete` (line 293)
- `src/frontend/src/utils/keyframeUtils.js` — `MIN_KEYFRAME_SPACING` constant (line 74)

## Testing

- In Framing, add a keyframe, move 1-2 frames forward, adjust crop again → should update the existing keyframe, not create a new one
- Move 15+ frames forward, adjust crop → should create a new keyframe (beyond threshold)
- Verify permanent keyframes (frame 0, last frame) are not affected by snapping
