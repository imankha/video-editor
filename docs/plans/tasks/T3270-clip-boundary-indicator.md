# T3270: Clip Boundary Visual Indicator in Annotate Mode

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-06-01
**Updated:** 2026-06-01

## Problem

In Annotate mode, when the user hits the clip play button and watches the clip, there is no visual indication of whether the playhead is currently within the clip boundaries (between start and end). Sometimes the playhead keeps going past the end, sometimes it returns to the start, and the user cannot tell from looking at the video area when they are inside vs. outside the clip.

## Solution

Add a clear visual indicator (e.g., a white border or glow around the video player) that appears while the playhead is within the active clip's start/end boundaries. The indicator should be immediately obvious and disappear when the playhead exits the clip range.

## Context

### Relevant Files
- `src/frontend/src/components/annotate/AnnotateContainer.jsx` - Annotate mode container
- `src/frontend/src/components/annotate/VideoPlayer.jsx` - Video player component
- `src/frontend/src/hooks/useMultiVideoScrub.js` - Playback/scrub logic with current time tracking
- `src/frontend/src/stores/clipStore.js` - Active clip state (start/end times)

### Related Tasks
- T980 (Clip-Scoped Scrub Bar) - Related clip playback UX

### Technical Notes
- Need to compare current playhead time against active clip's start/end
- Border/glow should be CSS-driven (conditional class toggle), not a canvas overlay
- Must work in both single-video and multi-video modes
- Should feel responsive (no visible delay when entering/exiting clip bounds)

## Acceptance Criteria

- [ ] White border (or equivalent visual indicator) appears on video player when playhead is within clip boundaries
- [ ] Indicator disappears when playhead moves outside clip boundaries
- [ ] Works when using clip play button
- [ ] Works during manual scrubbing through clip region
- [ ] No performance impact (CSS-only, no re-renders)
