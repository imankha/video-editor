# T70: Multi-clip Overlay Shows Only Single Clip After Framing Edit

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-02-11
**Updated:** 2026-02-11

## Problem

When editing a multi-clip project that has already been exported:

1. User edits the framing of ONE clip
2. App automatically moves to overlay mode
3. Overlay only shows the single edited clip instead of all clips in the project

Expected: All clips should be visible in overlay mode, not just the one that was edited.

## Solution

When transitioning from framing to overlay after editing a clip, ensure the overlay view loads ALL clips for the project, not just the clip that was being edited.

## Context

### Relevant Files
- `src/frontend/src/screens/OverlayScreen.jsx` - Overlay screen that loads clips
- `src/frontend/src/hooks/useOverlayState.js` - State management for overlay
- `src/frontend/src/App.jsx` - Mode transition logic
- `src/backend/app/routers/clips.py` - Clip fetching endpoints

### Technical Notes
- This may be a state issue where the "selected clip" from framing is being used to filter overlay clips
- Or the overlay screen initialization is incorrectly scoped to the edited clip
- Need to trace what happens during the framing→overlay transition

## Implementation

### Steps
1. [ ] Reproduce the bug with a multi-clip project
2. [ ] Trace the framing→overlay transition to find where clip filtering happens
3. [ ] Ensure overlay loads all project clips regardless of which clip was just framed
4. [ ] Test with various multi-clip scenarios

## Acceptance Criteria

- [ ] After editing framing on one clip, overlay shows ALL project clips
- [ ] Clip selection state from framing does not incorrectly filter overlay clips
- [ ] Works for projects with 2+ clips
- [ ] Works for both new exports and re-exports
