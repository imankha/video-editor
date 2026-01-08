# Task 05: Move clipsWithCurrentState to FramingContainer

## Goal
Move the `clipsWithCurrentState` useMemo (~90 lines) from App.jsx to FramingContainer.jsx

## Impact
- **Lines removed from App.jsx**: ~90
- **Risk level**: Low (derived state, no side effects)

## Prerequisites
- Tasks 01-04 completed

## Files to Modify
- `src/frontend/src/App.jsx`
- `src/frontend/src/containers/FramingContainer.jsx`

## Current Location in App.jsx

**Lines**: ~686-777

This useMemo:
1. Merges current clip's live keyframe state before export
2. Converts frame-based keyframes to time-based
3. Generates default keyframes for clips without saved state

## Step-by-Step Instructions

### Step 1: Identify dependencies

`clipsWithCurrentState` uses:
- `clips`, `selectedClipId`, `hasClips` - from useClipManager
- `getKeyframesForExport` - from useCrop
- `segmentBoundaries`, `segmentSpeeds`, `trimRange` - from useSegments
- `globalAspectRatio` - from useClipManager

All of these are already available in FramingContainer.

### Step 2: Move to FramingContainer

Copy the entire useMemo from App.jsx to FramingContainer.jsx:

```jsx
// In FramingContainer.jsx, after other useMemo definitions

/**
 * Clips with current clip's live state merged.
 * Since clip state (keyframes, segments) is managed in useCrop/useSegments hooks,
 * we need to merge the current clip's live state before export.
 */
const clipsWithCurrentState = useMemo(() => {
  if (!hasClips || !clips || !selectedClipId) return clips;

  // Helper to convert frame-based keyframes to time-based for export
  const convertKeyframesToTime = (keyframes, clipFramerate) => {
    if (!keyframes || !Array.isArray(keyframes)) return [];
    return keyframes.map(kf => {
      if (kf.time !== undefined) return kf;
      const time = kf.frame / clipFramerate;
      const { frame, ...rest } = kf;
      return { time, ...rest };
    });
  };

  // Helper to calculate default crop for a given aspect ratio
  const calculateDefaultCrop = (sourceWidth, sourceHeight, targetAspectRatio) => {
    if (!sourceWidth || !sourceHeight) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const [ratioW, ratioH] = targetAspectRatio.split(':').map(Number);
    const targetRatio = ratioW / ratioH;
    const videoRatio = sourceWidth / sourceHeight;

    let cropWidth, cropHeight;
    if (videoRatio > targetRatio) {
      cropHeight = sourceHeight;
      cropWidth = cropHeight * targetRatio;
    } else {
      cropWidth = sourceWidth;
      cropHeight = cropWidth / targetRatio;
    }

    const x = (sourceWidth - cropWidth) / 2;
    const y = (sourceHeight - cropHeight) / 2;

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(cropWidth),
      height: Math.round(cropHeight)
    };
  };

  const currentClipExportKeyframes = getKeyframesForExport();

  return clips.map(clip => {
    if (clip.id === selectedClipId) {
      return {
        ...clip,
        cropKeyframes: currentClipExportKeyframes,
        segments: {
          boundaries: segmentBoundaries,
          segmentSpeeds: segmentSpeeds,
          trimRange: trimRange
        },
        trimRange: trimRange
      };
    }

    let convertedKeyframes = convertKeyframesToTime(clip.cropKeyframes, clip.framerate || 30);

    if (convertedKeyframes.length === 0 && clip.sourceWidth && clip.sourceHeight && clip.duration) {
      const defaultCrop = calculateDefaultCrop(clip.sourceWidth, clip.sourceHeight, globalAspectRatio);
      convertedKeyframes = [
        { time: 0, ...defaultCrop },
        { time: clip.duration, ...defaultCrop }
      ];
    }

    return {
      ...clip,
      cropKeyframes: convertedKeyframes
    };
  });
}, [clips, selectedClipId, getKeyframesForExport, segmentBoundaries, segmentSpeeds, trimRange, hasClips, globalAspectRatio]);
```

### Step 3: Export from FramingContainer

Add to the return object:
```jsx
return {
  // ... existing returns ...
  clipsWithCurrentState,
};
```

### Step 4: Update App.jsx

Remove the `clipsWithCurrentState` useMemo from App.jsx and use the one from FramingContainer:

```jsx
const {
  // ... existing destructuring ...
  clipsWithCurrentState: framingClipsWithCurrentState,
} = framing;

// Then use framingClipsWithCurrentState instead of clipsWithCurrentState
```

### Step 5: Update FramingModeView

The `clipsWithCurrentState` is already being passed to ExportButton via FramingModeView.
Ensure it's correctly passed through:

```jsx
<FramingModeView
  // ...
  clipsWithCurrentState={framingClipsWithCurrentState}
  // ...
/>
```

## Verification Checklist

- [ ] clipsWithCurrentState moved to FramingContainer.jsx
- [ ] useMemo removed from App.jsx
- [ ] Returned from FramingContainer
- [ ] Used correctly in FramingModeView/ExportButton
- [ ] No TypeScript/ESLint errors
- [ ] Run: `cd src/frontend && npm test` - all tests pass
- [ ] Run: `cd src/frontend && npx playwright test` - all E2E tests pass
- [ ] Manual test: Add multiple clips, export, verify all clips included correctly

## Rollback

```bash
git checkout src/frontend/src/App.jsx
git checkout src/frontend/src/containers/FramingContainer.jsx
```
