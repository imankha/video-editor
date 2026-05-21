# T3050: Multi-Video Blank Video -- No Error Handling on Dual Video Elements

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-20
**Updated:** 2026-05-20

## Problem

Multi-video games (per-half recording) render raw `<video>` elements with zero event handlers. When a presigned URL expires (1h default) or any video loading error occurs, the video silently goes blank -- no error overlay, no retry button, no loading indicator. The user sees a black video area with the clip name banner and sidebar still working. Silent failure with no recovery path.

Single-video games are unaffected because they use `VideoPlayer` with 13 event handlers and route through the streaming proxy (`/api/games/{id}/stream`) which generates fresh URLs per request.

## Root Cause

1. **No event handlers on multi-video `<video>` elements** -- `AnnotateModeView.jsx:323-344` renders two bare `<video>` elements with only `ref`, `className`, `style`, `playsInline`, `preload`. No `onError`, `onLoadedData`, `onWaiting`, `onCanPlay`, or any other handler.

2. **Handlers explicitly blanked** -- `AnnotateScreen.jsx:587`: `handlers={multiVideo ? {} : handlers}`. The useVideo hook's handlers are disconnected in multi-video mode, so the video store (`isLoading`, `error`, `isVideoElementLoading`, etc.) is never updated.

3. **Presigned URLs used directly** -- Multi-video games load video URLs as presigned R2 URLs (`gameData.videos[i].video_url` via `AnnotateContainer.jsx:461-471`), which expire after 1 hour (`expires_in=3600` in `storage.py:1207`). Single-video games use the streaming proxy which generates fresh URLs per request.

4. **Seek-before-load race condition** -- `useMultiVideoScrub.seek()` (line 71-106) sets `inactive.currentTime` and swaps CSS opacity immediately, before the target frame is decoded. No loading state while the frame loads.

### Comparison: Single-Video vs Multi-Video

| Aspect | Single-video | Multi-video |
|--------|-------------|-------------|
| Video URL | Streaming proxy (fresh URLs) | Presigned URLs (expire in 1h) |
| Error handler | Yes (error overlay + retry) | **None** |
| Loading indicator | Yes (spinner + progress) | **None** |
| Buffering indicator | Yes | **None** |
| Event handlers | 13 handlers via useVideo | **0 handlers** |

## Solution

Add error handling, loading states, and URL refresh to the multi-video path so it has feature parity with the single-video path.

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` -- Add event handlers to dual `<video>` elements
- `src/frontend/src/modes/annotate/hooks/useMultiVideoScrub.js` -- Add loading/error state, defer visibility swap until frame ready
- `src/frontend/src/screens/AnnotateScreen.jsx` -- Connect multi-video state to loading/error UI
- `src/frontend/src/containers/AnnotateContainer.jsx` -- URL refresh logic for expired presigned URLs
- `src/frontend/src/components/VideoPlayer.jsx` -- Reference for single-video event handler patterns
- `src/frontend/src/hooks/useVideo.js` -- Reference for error classification and recovery patterns
- `src/backend/app/storage.py` -- Presigned URL generation (`generate_presigned_url`, `expires_in=3600`)

### Related Tasks
- T2750: Unified Multi-Video Experience (introduced the dual video elements)
- T1360: Blob URL Error Recovery (established error recovery patterns for single-video)
- T1410: Video Load Regression (established foreground load patterns)

### Technical Notes
- The `useMultiVideoScrub` hook manages playback independently from `useVideo` -- it has its own seek, play, pause, togglePlay etc. It returns `null` for single-video games (line 232).
- Multi-video detection: `gameData.videos && gameData.videos.length > 1` (AnnotateContainer.jsx:399)
- Virtual time: clips display with offsets added (first video duration added to second video's clip times). The seek function converts virtual time back to actual video index + actual time.
- The two `<video>` elements use CSS opacity (0 or 1) with 80ms transition for instant visual swapping.

## Implementation

### Steps
1. [ ] Add loading/error/ready state to `useMultiVideoScrub` (useState for `isLoading`, `error`, `isReady`)
2. [ ] Add event handlers to both `<video>` elements in `AnnotateModeView.jsx` (onError, onWaiting, onCanPlay, onLoadedData at minimum)
3. [ ] Defer opacity swap in seek() until target video has decoded the frame (listen for `seeked` or `canplay` event before swapping)
4. [ ] Show `VideoLoadingOverlay` during cross-boundary seeks (reuse existing component)
5. [ ] Show error overlay with retry when video load fails (reuse error pattern from VideoPlayer.jsx)
6. [ ] Add URL refresh on error: when presigned URL returns 403/network error, fetch fresh URL from backend and retry
7. [ ] Wire multi-video loading/error state through AnnotateScreen to AnnotateModeView

### Progress Log

**2026-05-20**: Task created from bug report. User observed blank video on a multi-video game (2 halves, 2.4 GB). Clip at 66:38 virtual time (second half). Root cause analysis complete.

## Acceptance Criteria

- [ ] Multi-video games show loading spinner when seeking across video boundaries
- [ ] Multi-video games show error overlay with retry button when video fails to load
- [ ] Expired presigned URLs trigger automatic refresh and retry (no user action needed)
- [ ] Video does not flash black during cross-boundary seeks (frame decoded before swap)
- [ ] Single-video path remains unchanged (no regressions)
