# T69: Mode Switch "Save" Should Reset Instead of Auto-Export

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-02-11
**Updated:** 2026-02-11

## Problem

When a user has already framed and overlayed a project, then makes changes to framing and tries to leave framing mode:

1. App correctly shows confirmation dialog asking to "save or discard"
2. If user clicks "save" and leaves, the app tries to automatically frame (auto-export)

This auto-export behavior is confusing and potentially wasteful (GPU time). The user may just want to preserve their intent to re-frame, not immediately trigger an export.

## Solution

When user clicks "save" in the mode switch confirmation dialog:

1. **Do NOT auto-export/auto-frame**
2. Instead, reset the project to the state it would have been before framing:
   - Remove existing overlay data (working_video)
   - Remove existing framing data (or mark as needing re-export)
3. User will manually frame and overlay when ready

This gives the user control over when exports happen rather than triggering expensive GPU operations automatically.

## Context

### Relevant Files
- `src/frontend/src/App.jsx` - Mode switch confirmation dialog and handlers
- `src/frontend/src/components/ConfirmationDialog.jsx` - Dialog component
- `src/frontend/src/stores/editorStore.js` - Mode switch dialog state
- `src/backend/app/routers/projects.py` - May need endpoint to reset project state

### Technical Notes
- The confirmation dialog is triggered when leaving framing mode with uncommitted changes
- Currently "save" triggers some form of auto-export
- Need to understand the current "save" flow before implementing the reset behavior

## Implementation

### Steps
1. [ ] Trace the current "save" button flow in mode switch dialog
2. [ ] Understand what "save" currently does (auto-export?)
3. [ ] Implement reset behavior instead:
   - Clear working_video if exists
   - Mark framing as needing re-export
4. [ ] Update confirmation dialog messaging if needed
5. [ ] Test the flow end-to-end

## Acceptance Criteria

- [ ] Clicking "save" when leaving framing does NOT trigger auto-export
- [ ] Existing overlay data is removed/reset
- [ ] User must manually trigger framing export
- [ ] User must manually trigger overlay export after framing
- [ ] Dialog messaging is clear about what will happen
