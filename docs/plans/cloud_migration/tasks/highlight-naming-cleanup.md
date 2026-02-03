# Highlight Keyframes Naming Cleanup

## Problem Statement

The codebase has two parallel highlight systems with confusingly similar names:

1. **`useHighlight`** - Original single-highlight system
   - Returns: `highlightKeyframes`, `highlightFramerate`
   - Purpose: Single highlight overlay with keyframe-based animation
   - Source: `src/frontend/src/hooks/useHighlight.js`

2. **`useHighlightRegions`** - Multi-region system
   - Returns: `highlightRegionKeyframes`, `highlightRegionsFramerate`
   - Purpose: Multiple highlight regions with boundaries and per-region keyframes
   - Source: `src/frontend/src/hooks/useHighlightRegions.js`

## Bug Encountered

In `OverlayScreen.jsx`, the keyframe selection logic was incorrectly using `highlightKeyframes` (from `useHighlight`) instead of `highlightRegionKeyframes` (from `useHighlightRegions`). This caused keyframes to not enlarge when the playhead was near them because:

- `highlightKeyframes` was empty (0 keyframes)
- `highlightRegionKeyframes` had the actual keyframes (12 in test case)
- The `RegionLayer` component renders `highlightRegionKeyframes`, so selection must match

## Files Affected

### Hooks (source of naming confusion)
- `src/frontend/src/hooks/useHighlight.js` - Original single-highlight hook
- `src/frontend/src/hooks/useHighlightRegions.js` - Multi-region highlight hook

### Components using these hooks
- `src/frontend/src/screens/OverlayScreen.jsx` - Uses both hooks
- `src/frontend/src/screens/FramingScreen.jsx` - Uses useHighlight for cropKeyframes parallel
- `src/frontend/src/modes/overlay/OverlayMode.jsx` - Receives props from either system
- `src/frontend/src/components/timeline/RegionLayer.jsx` - Renders keyframes
- `src/frontend/src/modes/OverlayModeView.jsx` - Pass-through for props

## Recommended Solutions

### Option A: Rename for Clarity (Recommended)
Rename variables to make the distinction explicit:

```javascript
// useHighlight.js - rename exports
highlightKeyframes → singleHighlightKeyframes
highlightFramerate → singleHighlightFramerate

// useHighlightRegions.js - keep as-is or shorten
highlightRegionKeyframes → regionKeyframes
highlightRegionsFramerate → regionFramerate
```

### Option B: Consolidate Hooks
Merge the two systems if `useHighlight` is legacy:
- Determine if `useHighlight` is still needed
- If not, migrate all usage to `useHighlightRegions`
- Remove `useHighlight` entirely

### Option C: TypeScript Typing
Add TypeScript types to catch mismatches at compile time:

```typescript
interface SingleHighlightState {
  keyframes: SingleHighlightKeyframe[];
  framerate: number;
}

interface RegionHighlightState {
  regionKeyframes: RegionKeyframe[];
  regionFramerate: number;
}
```

## Testing Requirements

### Unit Tests
1. Test `useHighlight` returns correct keyframe structure
2. Test `useHighlightRegions` returns correct keyframe structure
3. Test `findKeyframeIndexNearFrame` with both keyframe types

### Integration Tests
1. Verify `OverlayScreen` passes correct keyframes to `RegionLayer`
2. Verify keyframe selection works with tolerance (FRAME_TOLERANCE = 2 frames)
3. Test keyframe selection with empty keyframes array
4. Test keyframe selection with single keyframe
5. Test keyframe selection with multiple keyframes

### Manual E2E Tests
1. Load video in Overlay mode
2. Add highlight region
3. Move highlight to create keyframes
4. Scrub playhead near keyframe
5. Verify keyframe visually enlarges (scale-150) when selected
6. Verify keyframe returns to normal size (scale-100) when playhead moves away

### Regression Tests
1. Ensure `FramingScreen` keyframe selection still works (uses separate `selectedCropKeyframeIndex`)
2. Ensure highlight overlay rendering still works during playback
3. Ensure export includes correct highlight regions and keyframes

## Related Code Patterns

The same pattern exists for crop keyframes in Framing mode:
- `useCrop.js` → `cropKeyframes`, `framerate`
- `FramingScreen.jsx` → `selectedCropKeyframeIndex` calculation

The Framing implementation is correct and can be used as reference.

## Priority

Medium - This is a maintainability issue that has already caused one bug. Should be addressed before adding more highlight-related features.

## Definition of Done

- [ ] Naming is consistent and unambiguous
- [ ] All usages updated to use correct variables
- [ ] Unit tests added for keyframe selection
- [ ] Manual testing confirms keyframe enlargement works
- [ ] No TypeScript/lint errors (if types added)
