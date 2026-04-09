# T1250: Live Video Update During Annotate Scrub

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-09
**Updated:** 2026-04-09

## Problem

When scrubbing either bar in Annotate mode (the main timeline and the clip scrub region), the video should update in real time as the user drags — showing each frame as the scrub position changes. Currently the video does not visually update during the scrub.

## Investigation Notes

The code paths appear to call `video.currentTime` during drag:
- `TimelineBase.jsx` calls `onSeek(sourceTime)` on mousemove during drag (line ~133)
- `ClipScrubRegion.jsx` calls `onSeekRef.current(clamped)` on handle drag (lines 166, 173)
- `PlaybackControls.jsx` clip scrub bar calls `onSeekWithinSegment(actualTime)` on mousemove (line 172)
- `useVideo.js` `seek()` sets `videoRef.current.currentTime` directly (line 288)
- `useAnnotationPlayback.js` `seekWithinSegment()` sets `active.currentTime` directly (line 496)

The wiring looks correct, so the root cause needs investigation:
- Is the `onSeek` prop actually connected to `useVideo.seek()` in the Annotate screen's non-playback mode?
- Is the video element throttling rapid `currentTime` assignments (browser-level frame decode bottleneck)?
- Is there a React state update blocking the render (the `isSeeking` flag in useVideo may suppress timeUpdate events)?
- Are there two different video elements (one visible, one hidden) and seeks go to the wrong one?

## Solution

Diagnose and fix. The video element must show the frame corresponding to the scrub position during the drag gesture, not just after release.

## Context

### Relevant Files
- `src/frontend/src/hooks/useVideo.js:277` — `seek()` function, sets `video.currentTime`
- `src/frontend/src/components/timeline/TimelineBase.jsx:130` — mousemove handler during drag
- `src/frontend/src/modes/annotate/components/ClipScrubRegion.jsx:163` — handle drag, calls `onSeek`
- `src/frontend/src/modes/annotate/components/PlaybackControls.jsx:170` — clip scrub bar mousemove
- `src/frontend/src/modes/annotate/hooks/useAnnotationPlayback.js:485` — `seekWithinSegment`
- `src/frontend/src/screens/AnnotateScreen.jsx:383` — wires `onSeek={seek}` to AnnotateMode

### Related Tasks
- T980 (Clip-Scoped Scrub Bar) — DONE, added the clip scrub bar in playback mode

## Implementation

### Steps
1. [ ] Reproduce: scrub both bars in Annotate mode, confirm video frame doesn't update during drag
2. [ ] Add console.log in `useVideo.seek()` to verify it's being called during drag
3. [ ] Check if `video.currentTime` is actually changing (log the value)
4. [ ] If currentTime changes but frame doesn't render — investigate browser decode throttling, consider `requestVideoFrameCallback` or reducing seek rate
5. [ ] If currentTime doesn't change — trace the onSeek prop chain to find the disconnect
6. [ ] Fix the root cause
7. [ ] Verify both bars (main timeline + clip scrub region) update video during drag

## Acceptance Criteria

- [ ] Dragging the main timeline scrub bar updates the video frame in real time
- [ ] Dragging the clip scrub region handles updates the video frame in real time
- [ ] No jank or stutter — seeks are smooth (throttle to ~15fps if needed)
- [ ] Works on both desktop and mobile (touch drag)
