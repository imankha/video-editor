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

The bug was caused by **two sources of truth** for clip data:

1. `projectDataStore.clips` - Backend format with raw JSON strings
2. `clipStore.clips` - UI format with parsed/transformed data

Data was COPIED from projectDataStore to clipStore in FramingScreen's initialization effect. When returning to framing mode from overlay:

1. FramingScreen remounts
2. clipStore might have stale cached data from previous visit
3. Initialization only ran when clipStore was empty
4. Stale clipStore data was used, causing incorrect clipMetadata

**This is a "bug smell"** - sync issues between two stores indicate an architectural problem. The bandaid fix (sync check) would treat the symptom, not the cause.

## Solution: Single Source of Truth

Refactored to use `projectDataStore` as the **single source of truth**:

1. **Extended projectDataStore** with clip management features (selectedClipId, globalTransition, CRUD operations)
2. **Transform clips on load** in useProjectLoader to UI format (parsed JSON, client IDs)
3. **Updated useClipManager** to use projectDataStore instead of clipStore
4. **Simplified FramingScreen** - no more copying/syncing between stores
5. **Deprecated clipStore** - kept for backwards compatibility

## Files Changed

- `src/frontend/src/stores/projectDataStore.js` - Extended with clip management features
- `src/frontend/src/stores/clipStore.js` - Marked as deprecated
- `src/frontend/src/stores/index.js` - Updated exports
- `src/frontend/src/hooks/useClipManager.js` - Now uses projectDataStore
- `src/frontend/src/hooks/useProjectLoader.js` - Transforms clips to UI format on load
- `src/frontend/src/screens/FramingScreen.jsx` - Simplified initialization, removed sync logic
- `src/frontend/src/App.jsx` - Updated to use projectDataStore only
- `src/frontend/src/containers/ExportButtonContainer.test.js` - Updated tests for single store

## Bug Smells Documentation Added

Added "Bug Smells" guidance to prevent future bandaid fixes:

- `.claude/agents/code-expert.md` - Section 5 for detecting bug smells during audits
- `.claude/workflows/4-implementation.md` - Full Bug Smells section with examples

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
