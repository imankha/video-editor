# T1080: Gallery Player Scrub Controls Not Working

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-07
**Updated:** 2026-04-07

## Problem

Scrub controls in the gallery video player are not functional. Users cannot seek/scrub through exported videos in the gallery, making it hard to review specific moments.

## Solution

Investigate and fix the scrub bar interaction in the gallery player component. Likely an event handler or video element ref issue.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GalleryPlayer.jsx` (or similar) - Gallery playback component
- `src/frontend/src/components/shared/VideoPlayer.jsx` - Shared video player (if used)

### Related Tasks
- T64: Gallery Playback Controls (DONE) - Previously added gallery controls
- T980: Clip-Scoped Scrub Bar (Alpha) - Related scrub bar work

### Technical Notes
- Gallery plays exported overlay videos from R2
- Scrub bar should allow seeking to any point in the video

## Implementation

### Steps
1. [ ] Reproduce the issue in gallery player
2. [ ] Identify root cause (event handler, ref, CSS pointer-events, etc.)
3. [ ] Fix scrub interaction
4. [ ] Verify on desktop and mobile

## Acceptance Criteria

- [ ] User can scrub/seek through gallery videos
- [ ] Scrub position updates video playback position
- [ ] Works on both desktop and mobile
