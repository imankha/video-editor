# Epic: Video Proxy Layer -- Virtualize N Video Files Behind a Single Controller

**Priority:** P1
**Impact:** 9 | **Complexity:** 8
**Stack Layers:** Frontend
**Depends On:** T3090 (videoController interface -- in-progress on branch `feature/T3090-video-controller-abstraction`)
**Fixes:** bug p4 (end-of-segments only pauses active video; preload seek race condition)

---

## Problem

Three independent systems each manage dual-video elements with duplicated logic:

1. `useMultiVideoScrub` -- annotate mode scrubbing
2. `useAnnotationPlayback` -- clip playback mode
3. `singleVideoController` in AnnotateScreen -- ad-hoc fallback for single-video

Each reimplements: getVideos(), swapVideos(), pause-all-elements, volume/mute on all elements, virtual-actual time conversion, preloading, error handling. 8 core patterns duplicated across 2 files, plus 5 separate pause-all sites across 4 files.

The design must support N videos in the future (not just 2).

---

## Target Architecture

```
useVideoProxy (the virtualization layer)
  - Owns ALL video element refs (today 2 slots, future N)
  - Handles ping-pong swap, preload, virtual-actual time
  - Exposes: videoController { play, pause, seek, setVolume, setMuted, getCurrentTime, ... }
  - pause() ALWAYS pauses ALL elements
  - seek() waits for seeked events on cross-video transitions

useMultiVideoScrub (annotate scrubbing)
  - Consumes useVideoProxy
  - Adds: step/seek forward/backward, togglePlay, restart, RAF time loop

useAnnotationPlayback (clip playback)
  - Consumes useVideoProxy (separate instance)
  - Adds: clip timeline, segment transitions, enter/exit playback mode
```

---

## Section 1: Current State Audit

### 1.1 Files That Directly Access Video DOM Elements

| File | DOM Operations | Count |
|------|---------------|-------|
| `useMultiVideoScrub.js` | play, pause, currentTime (r/w), playbackRate, volume, muted, src, load | ~25 sites |
| `useAnnotationPlayback.js` | play, pause, currentTime (r/w), playbackRate, src, load, readyState | ~22 sites |
| `useVideo.js` | play, pause, currentTime (r/w), playbackRate, volume, buffered, duration | ~30 sites |
| `PlaybackControls.jsx` | volume, muted | 4 sites |
| `AnnotateScreen.jsx` | play, pause, currentTime, volume, muted (singleVideoController) | 6 sites |
| `AnnotateContainer.jsx` | pause, paused, playbackRate | 3 sites |
| `RecapPlayerModal.jsx` | play, pause, passes raw refs to PlaybackControls | 4 sites |
| `useRecapPlayback.js` | currentTime (r/w), play, pause, playbackRate, readyState | ~10 sites |

### 1.2 Files That Manage Dual-Video State

| Pattern | useMultiVideoScrub | useAnnotationPlayback |
|---------|-------------------|----------------------|
| videoARef / videoBRef | Lines 18-19 | Lines 32-33 |
| activeVideoRef ('A'/'B') | Line 20 | Line 43 |
| getVideos() { active, inactive } | Lines 40-46 | Lines 82-90 |
| swapVideos() | Lines 48-51 | Lines 121-124 |
| Preload next segment | Lines 128-137 (inline) | Lines 95-116 (dedicated) |
| RAF time-update loop | Lines 153-198 | Lines 130-220 |
| Pause-both on cleanup | Lines 339-345 | Lines 328-339 |
| Pause-both on toggle | Lines 223-230 | Lines 352-355 |

**8 core patterns duplicated across 2 files.**

---

## Section 2: useVideoProxy Design

### 2.1 Interface Specification

```javascript
function useVideoProxy({ videos, playbackRate = 1, onRefreshUrls = null })

// Returns:
{
  videoController: {
    play(),
    pause(),                   // pauses ALL elements
    seek(virtualTime),         // handles cross-video boundary with seeked waiting
    setVolume(v),              // applies to ALL elements
    setMuted(m),               // applies to ALL elements
    setPlaybackRate(rate),
    getCurrentTime(),          // virtual time from DOM (never stale)
    isPaused(),
    getActiveElement(),        // for RAF loops
    _renderSlots: [            // for JSX rendering
      { ref, isActive, zIndex },
    ],
  },
  virtualTime,
  totalDuration,
  isPlaying,
  isLoading,
  error,
  activeSlotIndex,
  currentVideoIndex,
  timeline,
  boundaryOffsets,
  clearError(),
  retry(),
  videoHandlers: { onError, onWaiting, onCanPlay },
  isMultiVideo,
}
```

### 2.2 N-Video Pool Management

2 slots (ping-pong). One active (visible, playing), one inactive (hidden, preloaded). For N>2 videos, the proxy changes the inactive slot's `src` when navigating to non-adjacent videos. Pool size can increase later without changing the controller interface.

### 2.3 Single-Video Passthrough

When `videos` is null or length <= 1: creates 1 ref, no timeline, `seek()` sets `currentTime` directly, `getCurrentTime()` reads `currentTime` directly. Same interface, no virtualization.

### 2.4 Cross-Video Seeking (Fixes Bug p4)

```javascript
seek(vt) {
  const result = timeline.virtualToActual(vt);
  if (result.videoIndex !== current) {
    active.pause();
    cancelPendingSwap();
    loadIntoInactiveSlot(targetUrl);
    inactive.currentTime = result.actualTime;
    await waitForSeeked(inactive);  // KEY FIX: wait for seek to complete
    swapSlots();
    pauseOldActive();
    if (wasPlaying) newActive.play();
    preloadAdjacent();
  } else {
    active.currentTime = result.actualTime;
  }
  setVirtualTime(vt);
}
```

---

## Section 3: Task Breakdown

### T3100: Extract useVideoProxy from useMultiVideoScrub

Create `src/frontend/src/hooks/useVideoProxy.js` by extracting video-element management.

**Moves to proxy:** videoARef/videoBRef, getVideos/swapVideos, seek with cross-boundary logic, play/pause (pause-all), setVolume/setMuted, error handling, isLoading, virtualTime, fullTimeline, videoController object, single-video passthrough mode.

**Stays in useMultiVideoScrub:** RAF loop, togglePlay/step/seekForward/seekBackward/restart, isPlaying state.

**Dependencies:** None. **LOC removed from consumers:** ~175 lines.

### T3110: Migrate useMultiVideoScrub to Consume useVideoProxy

Refactor `useMultiVideoScrub` to delegate all video-element management to `useVideoProxy`. Keep only scrub-specific logic (RAF loop, step/seek navigation).

**Dependencies:** T3100

### T3120: Migrate useAnnotationPlayback to Consume useVideoProxy

Refactor `useAnnotationPlayback` to use the proxy. **This structurally fixes bug p4:**
- pause() always pauses all elements (end-of-segments fix)
- seek() waits for seeked events (preload race fix)

Separate proxy instance from useMultiVideoScrub (different timelines, different lifecycle).

**Dependencies:** T3100. **LOC removed:** ~120 lines.

### T3130: Migrate PlaybackControls to Use videoController

Replace raw `videoARef`/`videoBRef` volume/mute pattern with `videoController.setVolume()`/`setMuted()`. Same change we made to AnnotateControls in T3090.

Also fix `RecapPlayerModal.jsx` which passes raw refs to PlaybackControls.

**Dependencies:** T3120

### T3140: Remove singleVideoController from AnnotateScreen

With proxy handling both single and multi-video modes, remove the ad-hoc `singleVideoController` and the `multiVideo?.videoController ?? singleVideoController` ternary.

**Dependencies:** T3110

### T3150: Consolidate effective* Wrappers in AnnotateContainer

Remove `effectiveSeek`, `effectiveTogglePlay`, `effectiveIsPlaying`, etc. (lines 125-133 in AnnotateContainer). The proxy provides a consistent interface for both modes.

**Dependencies:** T3140

---

## Section 4: How the Proxy Fixes Bug p4

1. **pause() always pauses ALL elements** -- current end-of-segments handler only pauses active video. Proxy's pause() iterates all slots.
2. **seek() waits for seeked events** -- current preloadNextSegment sets currentTime without waiting. If src was just loaded, seek is silently dropped. Proxy uses waitForSeeked() promise.
3. **End-of-segments uses controller** -- consumer calls `controller.pause()`, never `active.pause()`.

---

## Section 5: Risks

1. **Separate proxy instances** -- useMultiVideoScrub and useAnnotationPlayback each get their own proxy (different timelines, different lifecycle). They never share video elements.
2. **RAF loop ownership** -- proxy does NOT own the RAF loop. Each consumer owns its mode-specific RAF loop and reads from `controller.getActiveElement()`.
3. **Stable refs** -- proxy uses useRef() for all element refs. `_renderSlots` is useMemo with stable identities.
4. **Memory** -- 2 video elements at ~5MB/min buffer = ~10MB. Negligible. Future N=3 adds ~5MB.
5. **Backward compatibility** -- each task is independently deployable. No broken intermediate states.
6. **Clip timeline vs full video timeline** -- proxy uses full video timeline. Playback hook still owns its clip timeline and calls `controller.seek(virtualTime)` for segment transitions.
