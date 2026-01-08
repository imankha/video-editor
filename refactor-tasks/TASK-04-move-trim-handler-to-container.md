# Task 04: Move handleTrimSegment to FramingContainer

## Goal
Move the large `handleTrimSegment` function (~200 lines) from App.jsx to FramingContainer.jsx

## Impact
- **Lines removed from App.jsx**: ~200
- **Risk level**: Medium (complex trim logic with keyframe coordination)

## Prerequisites
- Tasks 01-03 completed

## Files to Modify
- `src/frontend/src/App.jsx`
- `src/frontend/src/containers/FramingContainer.jsx`

## Current Location in App.jsx

**Lines**: ~1376-1580 (approximately 200 lines)

The function coordinates:
1. Crop keyframe deletion in trimmed region
2. Highlight keyframe deletion in trimmed region
3. Boundary keyframe updates with furthest keyframe data
4. Segment trim state toggle

## Step-by-Step Instructions

### Step 1: Understand the dependencies

`handleTrimSegment` uses:
- `duration` - from useVideo
- `segments` - from useSegments
- `keyframes`, `framerate` - from useCrop
- `highlightKeyframes`, `highlightFramerate` - from useHighlight
- `clipHasUserEditsRef` - ref in App.jsx
- `deleteKeyframesInRange`, `addOrUpdateKeyframe` - from useCrop
- `deleteHighlightKeyframesInRange`, `addOrUpdateHighlightKeyframe` - from useHighlight
- `toggleTrimSegment` - from useSegments

### Step 2: Add to FramingContainer props

In `FramingContainer.jsx`, add these to the props destructuring:
```jsx
export function FramingContainer({
  // ... existing props ...

  // Additional props for handleTrimSegment
  highlightKeyframes,
  highlightFramerate,
  deleteHighlightKeyframesInRange,
  addOrUpdateHighlightKeyframe,
}) {
```

### Step 3: Move the function to FramingContainer

Move the entire `handleTrimSegment` function from App.jsx to FramingContainer.jsx:

```jsx
// In FramingContainer.jsx

/**
 * Coordinated segment trim handler
 * Ensures keyframes are properly managed when trimming segments:
 * 1. Deletes all crop and highlight keyframes in the trimmed region
 * 2. Updates boundary keyframes with data from the furthest keyframes
 * 3. Toggles the segment trim state
 */
const handleTrimSegment = useCallback((segmentIndex) => {
  if (!duration || segmentIndex < 0 || segmentIndex >= segments.length) return;

  // Mark that user has made an edit
  onUserEdit();

  const segment = segments[segmentIndex];
  const isCurrentlyTrimmed = segment.isTrimmed;

  console.log(`[FramingContainer] Trim segment ${segmentIndex}: ${segment.start.toFixed(2)}s-${segment.end.toFixed(2)}s`);

  // ... rest of the function (copy from App.jsx lines 1376-1580)

}, [duration, segments, keyframes, framerate, highlightKeyframes, highlightFramerate,
    deleteKeyframesInRange, addOrUpdateKeyframe, deleteHighlightKeyframesInRange,
    addOrUpdateHighlightKeyframe, toggleTrimSegment, onUserEdit]);
```

### Step 4: Export the handler from FramingContainer

Add to the return object:
```jsx
return {
  // ... existing returns ...
  handleTrimSegment,
};
```

### Step 5: Update App.jsx

Remove the handleTrimSegment function from App.jsx and destructure it from the framing container:
```jsx
const {
  // ... existing destructuring ...
  handleTrimSegment: framingHandleTrimSegment,
} = framing;
```

### Step 6: Update FramingModeView props

Pass the handler through:
```jsx
<FramingModeView
  // ...
  onSegmentTrim={framingHandleTrimSegment}
  // ...
/>
```

## Key Code Sections to Move

### Crop keyframe handling (lines ~1398-1440)
```jsx
// Find the furthest crop keyframe in the trimmed region
const regionKeyframes = keyframes.filter(kf => {
  const time = kf.frame / framerate;
  return time >= segment.start && time <= segment.end;
});
// ... boundary logic
```

### Highlight keyframe handling (lines ~1445-1490)
```jsx
// Same logic but for highlight keyframes
const highlightRegionKeyframes = highlightKeyframes.filter(kf => {
  const time = kf.frame / highlightFramerate;
  return time >= segment.start && time <= segment.end;
});
// ... boundary logic
```

### Final trim toggle (lines ~1575-1580)
```jsx
// Toggle the segment's trim state
toggleTrimSegment(segmentIndex);
```

## Verification Checklist

- [ ] handleTrimSegment moved to FramingContainer.jsx
- [ ] Function removed from App.jsx
- [ ] All dependencies passed as props
- [ ] Handler returned from FramingContainer
- [ ] Handler passed to FramingModeView
- [ ] No TypeScript/ESLint errors
- [ ] Run: `cd src/frontend && npm test` - all tests pass
- [ ] Run: `cd src/frontend && npx playwright test` - all E2E tests pass
- [ ] Manual test: Trim segments, verify keyframes are handled correctly

## Rollback

```bash
git checkout src/frontend/src/App.jsx
git checkout src/frontend/src/containers/FramingContainer.jsx
```
