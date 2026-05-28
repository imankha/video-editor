# T3090: Unified Video Controller for Multi-Video Mode

**Status:** TESTING
**Priority:** P1
**Impact:** 7 | **Complexity:** 5
**Stack Layers:** Frontend
**Bugs:** 10p, 11p (duplicate)
**Branch:** `feature/T3090-video-controller-abstraction`

## What Was Done

Sealed the dual-video abstraction by introducing a `videoController` interface. Components no longer touch raw `videoRef`/`videoBRef` -- they call `controller.play()`, `controller.pause()`, `controller.seek()`, etc. The controller routes to the correct video element(s) internally.

### Files Changed

| File | Change |
|------|--------|
| `useMultiVideoScrub.js` | Added `videoController` object (useMemo) wrapping play/pause/seek/setVolume/setMuted/getCurrentTime/isPaused/getActiveElement + `_renderRefs` |
| `AnnotateScreen.jsx` | Built `singleVideoController` fallback (useMemo); selects multi vs single; passes `videoController` to children instead of raw refs |
| `AnnotateModeView.jsx` | Uses `videoController._renderRefs` for `<video>` JSX; passes controller to AnnotateControls and AnnotateFullscreenOverlay |
| `AnnotateControls.jsx` | Removed `applyToAllVideos` band-aid; uses `controller.setVolume()`/`setMuted()` |
| `ClipsSidePanel.jsx` | Pass-through: `videoController` instead of `videoRef` |
| `ClipDetailsEditor.jsx` | Pass-through: `videoController` instead of `videoRef` |
| `ClipScrubRegion.jsx` | Replaced all 6 direct DOM manipulations with controller methods |
| `AnnotateFullscreenOverlay.jsx` | Pass-through: `videoController` instead of `videoRef` |

### What This Fixes

- **Bug 10p:** Volume/mute now applied via `controller.setVolume()`/`setMuted()` which targets ALL video elements
- **Bug 11p:** Clip preview play/seek now goes through `controller.play()`/`controller.seek()` which targets the active element (not always video A)

### What This Does NOT Fix

- **Bug p4:** After playback annotations finish, video continues playing. This is in `useAnnotationPlayback` which has its own dual-video management (separate from `useMultiVideoScrub`). Fixed by the Video Proxy Layer epic (see VIDEO-PROXY-EPIC.md).
- **PlaybackControls** still uses raw `videoARef`/`videoBRef` for volume/mute (separate from the annotate controls path). Fixed by T3130 in the epic.

## Next Steps

This task is Phase 1 of the Video Proxy Layer epic. See `docs/plans/tasks/VIDEO-PROXY-EPIC.md` for the full design and task breakdown (T3100-T3150).
