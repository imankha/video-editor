# T60: Consolidate Video Controls

**Status:** TODO
**Impact:** MEDIUM
**Complexity:** MEDIUM
**Created:** 2026-02-11
**Updated:** 2026-02-11

## Problem

Video controls are duplicated across different modes/screens. The forward/backward seek behavior is inconsistent or missing. Users expect standard keyboard shortcuts to navigate video.

## Solution

Consolidate video playback controls into a reusable component/hook:
- Forward arrow: move playhead 5 seconds forward
- Backward arrow: move playhead 5 seconds back
- Reuse controls consistently across Annotate, Framing, Overlay, and Gallery

## Context

### Relevant Files
- `src/frontend/src/components/VideoPlayer.jsx` - Main video player component
- `src/frontend/src/hooks/useVideo.js` - Video playback hook
- `src/frontend/src/modes/AnnotateModeView.jsx`
- `src/frontend/src/modes/FramingModeView.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/screens/GalleryScreen.jsx`

### Technical Notes
- Keyboard event handling needs to be consistent
- Should work with both arrow keys and on-screen buttons
- Need to handle edge cases (near start/end of video)

## Implementation

### Steps
1. [ ] Audit current video control implementations across all modes
2. [ ] Create consolidated video controls component/hook
3. [ ] Implement 5-second seek forward/backward
4. [ ] Replace duplicated controls with shared component
5. [ ] Test across all modes

## Acceptance Criteria

- [ ] Forward arrow moves playhead 5s forward
- [ ] Backward arrow moves playhead 5s backward
- [ ] Controls work consistently in Annotate, Framing, Overlay modes
- [ ] Controls work in Gallery
- [ ] Edge cases handled (can't seek past start/end)
