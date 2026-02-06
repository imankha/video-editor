# frame-not-time

**Priority:** CRITICAL
**Category:** Frame-Based

## Rule
Always use frame numbers, never time in seconds, for keyframe positions. Convert time to frames using `Math.round(time * framerate)`.

## Rationale
Frame-based keyframes provide:
1. **Precision**: No floating-point rounding errors
2. **Consistency**: Same frame = same position regardless of playback speed
3. **FFmpeg compatibility**: FFmpeg works in frames for seeking
4. **Predictable snapping**: Easy to snap to exact frames

Time-based has problems:
1. Floating-point precision issues (29.999999 vs 30.0)
2. Different framerates = different positions
3. Rounding errors accumulate

## Incorrect Example

```javascript
// BAD: Storing time in seconds
const keyframe = {
  time: 1.5,  // BAD!
  x: 100,
  y: 200
};

// BAD: Using video.currentTime directly
const addKeyframeAtCurrentPosition = () => {
  const newKeyframe = {
    time: videoRef.current.currentTime,  // BAD!
    ...cropState
  };
  setKeyframes([...keyframes, newKeyframe]);
};
```

**Why this is wrong:**
- `currentTime` is a float, can be 1.4999999 or 1.5000001
- Different playback speeds affect time but not frame
- FFmpeg uses frames for precise seeking

## Correct Example

```javascript
// GOOD: Storing frame number
const keyframe = {
  frame: 45,  // GOOD! At 30fps, this is 1.5 seconds
  origin: 'user',
  x: 100,
  y: 200
};

// GOOD: Convert time to frame
const addKeyframeAtCurrentPosition = () => {
  const currentFrame = Math.round(videoRef.current.currentTime * framerate);
  const newKeyframe = {
    frame: currentFrame,
    origin: 'user',
    ...cropState
  };
  setKeyframes([...keyframes, newKeyframe]);
};

// GOOD: Convert frame to time for display
const timeForDisplay = (frame / framerate).toFixed(2);
```

## Conversion Helpers

```javascript
// Frame to time (for display or video seeking)
const frameToTime = (frame, framerate) => frame / framerate;

// Time to frame (for storage)
const timeToFrame = (time, framerate) => Math.round(time * framerate);

// Seek video to frame
const seekToFrame = (videoRef, frame, framerate) => {
  videoRef.current.currentTime = frame / framerate;
};
```

## Additional Context

The `framerate` is stored in:
- Video metadata: `metadata.framerate`
- Keyframe state: `state.framerate`

Common framerates:
- 30 fps (most common)
- 60 fps (gaming footage)
- 24 fps (film)
- 29.97 fps (NTSC)

When framerate is unknown, default to 30 fps.
