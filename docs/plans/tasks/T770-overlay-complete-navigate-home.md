# T770: Navigate to Projects Screen After Overlay Export

**Status:** DONE
**Impact:** 5
**Complexity:** 2
**Created:** 2026-03-28
**Updated:** 2026-03-28

## Problem

After overlay export completes, the user stays on the overlay screen with no clear next action. They should be automatically navigated back to the home/projects screen so they can continue working on other clips or download their finished video from the gallery.

## Solution

After the overlay export finishes successfully, navigate the user to the home/projects screen. This should happen after the success state is shown briefly (e.g., 1-2 second delay so the user sees the completion confirmation before being redirected).

## Context

### Relevant Files
- `src/frontend/src/screens/OverlayScreen.jsx` - Overlay screen with export completion handling
- `src/frontend/src/App.jsx` - Navigation/routing logic
- `src/frontend/src/stores/` - Any navigation-related store state

### Related Tasks
- None

## Acceptance Criteria

- [ ] After overlay export completes successfully, user is navigated to home/projects screen
- [ ] Brief success indication shown before navigation (1-2s)
- [ ] Failed exports do NOT trigger navigation (user stays to retry or debug)
- [ ] Navigation works for both Modal (cloud) and local exports
