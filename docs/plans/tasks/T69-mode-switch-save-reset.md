# T69: Mode Switch Dialog - Clarify Options

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Created:** 2026-02-11
**Updated:** 2026-02-12

## Problem

When a user has uncommitted changes (framing or overlay) and tries to switch modes, a confirmation dialog appears with "Save" and "Discard" options. The "Save" label is confusing because:

1. All edits are already auto-saved to the backend
2. "Save" actually triggers an export (GPU processing)
3. Users may not realize clicking "Save" will start an expensive export

## Solution

Rename and clarify the dialog options:

| Button | Action |
|--------|--------|
| **Export** | Trigger export now, then switch modes |
| **Discard** | Throw away changes, switch modes |
| **X (close)** | Cancel - stay in current mode, no action taken |

This makes it explicit that:
- "Export" means GPU processing will happen
- "Discard" means changes are lost
- X lets user back out without committing to either

## Context

### Relevant Files
- `src/frontend/src/App.jsx` - Mode switch confirmation dialog and handlers (`handleModeSwitchExport`, `handleModeSwitchDiscard`, `handleModeSwitchCancel`)
- `src/frontend/src/components/shared/ConfirmationDialog.jsx` - Dialog component
- `src/frontend/src/stores/editorStore.js` - Mode switch dialog state

### Current Flow
The dialog is triggered in `App.jsx` when:
- Leaving framing mode with `framingChangedSinceExport && hasOverlayVideo`
- Leaving overlay mode with `overlayChangedSinceExport && selectedProject?.has_final_video`

Current buttons are configured in `App.jsx` around line 373:
```jsx
buttons={[
  { label: 'Discard', onClick: handleModeSwitchDiscard, variant: 'danger' },
  { label: 'Save', onClick: handleModeSwitchExport, variant: 'primary' }
]}
```

## Implementation

### Steps
1. [ ] Change button label from "Save" to "Export" in App.jsx
2. [ ] Ensure ConfirmationDialog has a close X button that calls `onClose`
3. [ ] Verify `handleModeSwitchCancel` (onClose) keeps user in current mode
4. [ ] Update dialog message to clarify what each option does
5. [ ] Test both framing and overlay mode switch scenarios

## Acceptance Criteria

- [ ] Dialog shows "Export" button instead of "Save"
- [ ] Dialog has X close button that cancels the action
- [ ] Clicking X keeps user in current mode with changes intact
- [ ] Dialog message clearly explains the three options
- [ ] Works for both framing→overlay and overlay→framing transitions
