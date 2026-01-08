# Task 06: Move Copy/Paste Handlers to FramingContainer

## Goal
Move crop and highlight copy/paste handlers from App.jsx to FramingContainer.jsx

## Impact
- **Lines removed from App.jsx**: ~50
- **Risk level**: Low (simple wrapper functions)

## Prerequisites
- Tasks 01-05 completed

## Files to Modify
- `src/frontend/src/App.jsx`
- `src/frontend/src/containers/FramingContainer.jsx`

## Functions to Move

### handleCopyCrop (lines ~1340-1344)
```jsx
const handleCopyCrop = (time = currentTime) => {
  if (videoUrl) {
    copyCropKeyframe(time);
  }
};
```

### handlePasteCrop (lines ~1346-1351)
```jsx
const handlePasteCrop = (time = currentTime) => {
  if (videoUrl && copiedCrop) {
    pasteCropKeyframe(time, duration);
  }
};
```

### handleCopyHighlight (lines ~1354-1358)
```jsx
const handleCopyHighlight = (time = currentTime) => {
  if (videoUrl && isHighlightEnabled) {
    copyHighlightKeyframe(time);
  }
};
```

### handlePasteHighlight (lines ~1360-1365)
```jsx
const handlePasteHighlight = (time = currentTime) => {
  if (videoUrl && copiedHighlight && isHighlightEnabled) {
    pasteHighlightKeyframe(time, duration);
  }
};
```

## Step-by-Step Instructions

### Step 1: Add handlers to FramingContainer

```jsx
// In FramingContainer.jsx

// Crop copy/paste handlers
const handleCopyCrop = useCallback((time = currentTime) => {
  if (videoUrl) {
    copyCropKeyframe(time);
  }
}, [videoUrl, currentTime, copyCropKeyframe]);

const handlePasteCrop = useCallback((time = currentTime) => {
  if (videoUrl && copiedCrop) {
    pasteCropKeyframe(time, duration);
  }
}, [videoUrl, copiedCrop, currentTime, duration, pasteCropKeyframe]);

// Note: Highlight handlers stay in App.jsx or move to OverlayContainer
// since they're used in Overlay mode, not Framing mode
```

### Step 2: Export from FramingContainer

```jsx
return {
  // ... existing returns ...
  handleCopyCrop,
  handlePasteCrop,
};
```

### Step 3: Update App.jsx

Remove the handler definitions and use from container:
```jsx
const {
  // ... existing destructuring ...
  handleCopyCrop: framingHandleCopyCrop,
  handlePasteCrop: framingHandlePasteCrop,
} = framing;
```

### Step 4: Move highlight handlers to OverlayContainer

Since highlight copy/paste is used in Overlay mode:

```jsx
// In OverlayContainer.jsx

const handleCopyHighlight = useCallback((time = currentTime) => {
  if (overlayVideoUrl && highlightRegions.length > 0) {
    // Copy logic for highlight regions
    copyHighlightKeyframe(time);
  }
}, [overlayVideoUrl, currentTime, highlightRegions, copyHighlightKeyframe]);

const handlePasteHighlight = useCallback((time = currentTime) => {
  if (overlayVideoUrl && copiedHighlight && highlightRegions.length > 0) {
    pasteHighlightKeyframe(time, duration);
  }
}, [overlayVideoUrl, copiedHighlight, currentTime, duration, highlightRegions, pasteHighlightKeyframe]);
```

## Note on Keyboard Shortcuts

The copy/paste handlers are also used by `useKeyboardShortcuts`. After this refactor:
- Pass the handlers from containers to the keyboard shortcuts hook
- Or have the keyboard hook access stores directly

Currently `useKeyboardShortcuts` is already extracted, so coordinate the handler references.

## Verification Checklist

- [ ] Crop copy/paste handlers moved to FramingContainer
- [ ] Highlight copy/paste handlers moved to OverlayContainer
- [ ] Handlers removed from App.jsx
- [ ] Keyboard shortcuts still work (Ctrl+C/V)
- [ ] No TypeScript/ESLint errors
- [ ] Run: `cd src/frontend && npm test` - all tests pass
- [ ] Run: `cd src/frontend && npx playwright test` - all E2E tests pass
- [ ] Manual test: Copy crop at keyframe, paste at new position

## Rollback

```bash
git checkout src/frontend/src/App.jsx
git checkout src/frontend/src/containers/FramingContainer.jsx
git checkout src/frontend/src/containers/OverlayContainer.jsx
```
