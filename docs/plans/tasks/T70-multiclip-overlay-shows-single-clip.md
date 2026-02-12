# T70: Multi-clip Overlay Shows Only Single Clip After Framing Edit

**Status:** TESTING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-02-11
**Updated:** 2026-02-12

## Problem

When editing a multi-clip project that has already been exported:

1. User edits the framing of ONE clip
2. App automatically moves to overlay mode
3. Overlay only shows the single edited clip instead of all clips in the project

Expected: All clips should be visible in overlay mode, not just the one that was edited.

## Root Cause Analysis

The bug was in `FramingScreen.jsx` initialization effect (line 376). The condition:

```javascript
if (!initialLoadDoneRef.current && loadedClips.length > 0 && clips.length === 0)
```

Only loaded clips from `projectDataStore` into `clipStore` when `clipStore` was empty. However, when returning to framing mode from overlay:

1. FramingScreen remounts (gets a fresh `initialLoadDoneRef` with `current = false`)
2. `loadedClips` from `projectDataStore` has all clips
3. BUT `clips` from `clipStore` might still have cached clips from previous visit
4. If `clips.length > 0`, initialization doesn't run
5. The cached `clipStore` data is used, which might be stale or have incorrect clip data

This caused `clipsWithCurrentState` (passed to ExportButtonContainer) to have incomplete/incorrect data, which then built incorrect `clipMetadata` for overlay mode.

## Solution

Modified the initialization effect condition to also verify clipStore clips match projectDataStore clips by comparing backend IDs:

```javascript
const clipStoreIsEmpty = clips.length === 0;
const clipStoreMismatch = clips.length > 0 && loadedClips.length > 0 && (
  clips.length !== loadedClips.length ||
  !clips.every((clip, index) => {
    const loadedClip = loadedClips[index];
    return clip.workingClipId === loadedClip?.id;
  })
);
const needsReload = clipStoreIsEmpty || clipStoreMismatch;
```

This ensures clips are reloaded when returning to framing mode if the clipStore data is stale.

## Files Changed

- `src/frontend/src/screens/FramingScreen.jsx` - Added clipStore sync verification in initialization effect
- `src/frontend/src/containers/ExportButtonContainer.test.js` - Added tests for multi-clip metadata building

## Manual Testing Instructions

### Test 1: Basic Multi-clip Overlay Flow
1. Open a project with 3+ clips that has NOT been exported yet
2. Go to Framing mode
3. Frame all clips (add crop keyframes)
4. Click Export
5. **Verify:** Overlay mode shows working video with all clips
6. **Verify:** Timeline shows full duration (sum of all clips)

### Test 2: Re-edit After Export (Bug Scenario)
1. Use the project from Test 1 (already exported)
2. Switch to Framing mode
3. Select and edit ONE clip's framing
4. Click Export
5. **Verify:** Overlay mode shows ALL clips, not just the edited one
6. **Verify:** Working video contains all clips' content

### Test 3: Mode Switching
1. Open a multi-clip project with working video
2. Go to Overlay mode first (project loads directly to overlay because it has working video)
3. Switch to Framing mode
4. **Verify:** All clips are shown in the clip sidebar
5. Edit one clip, export
6. **Verify:** Overlay shows all clips

### Test 4: Different Clip Counts
1. Create projects with 2, 3, and 5 clips
2. For each: export, go back to framing, edit one clip, export again
3. **Verify:** All clips visible in overlay each time

## Acceptance Criteria

- [x] After editing framing on one clip, overlay shows ALL project clips
- [x] Clip selection state from framing does not incorrectly filter overlay clips
- [x] Works for projects with 2+ clips
- [x] Works for both new exports and re-exports
- [x] Unit tests added for clipMetadata building
