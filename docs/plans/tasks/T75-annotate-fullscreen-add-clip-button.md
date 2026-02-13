# T75: Annotate Fullscreen Add Clip Button

**Status:** DONE
**Impact:** 5
**Complexity:** 2
**Created:** 2026-02-12
**Updated:** 2026-02-12

## Problem

In Annotate fullscreen mode, pausing the video automatically shows the Add Clip UI overlay. This is intrusive when the user just wants to pause and look at the frame.

## Solution

Replace auto-show on pause with an "Add Clip" button. The overlay should only appear when the user clicks the button.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - The overlay component
- `src/frontend/src/screens/AnnotateScreen.jsx` - Controls fullscreen behavior
- `src/frontend/src/containers/AnnotateContainer.jsx` - Handles pause/overlay logic
- `src/frontend/src/modes/annotate/components/AnnotateControls.jsx` - Control bar with buttons

### Related Tasks
- None

### Technical Notes
- The auto-show behavior was in an effect in AnnotateContainer.jsx that detected play-to-pause transitions
- The Add Clip button was previously hidden in fullscreen mode

## Implementation

### Steps
1. [x] Remove auto-show overlay when pausing in fullscreen mode (AnnotateContainer.jsx)
2. [x] Show Add Clip button in controls when paused in fullscreen (AnnotateControls.jsx)
3. [x] Add keyboard shortcut 'A' to open Add Clip overlay (AnnotateScreen.jsx)
4. [ ] Manual testing

### Progress Log

**2026-02-12:** Implemented all code changes:
- Removed the effect in AnnotateContainer.jsx that auto-showed overlay on pause
- Modified AnnotateControls.jsx to show Add Clip button when in fullscreen AND paused
- Added 'A' keyboard shortcut in AnnotateScreen.jsx to open overlay

## Acceptance Criteria

- [ ] Pausing in fullscreen does NOT auto-show the Add Clip overlay
- [ ] An "Add Clip" button is visible when paused in fullscreen
- [ ] Clicking the button shows the Add Clip overlay
- [ ] Pressing Escape closes the overlay (existing behavior)
- [ ] Keyboard shortcut 'A' opens the overlay
