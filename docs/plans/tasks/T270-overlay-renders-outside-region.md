# T270: Overlay Renders Outside Region Bounds

**Status:** TESTING
**Impact:** 4
**Complexity:** 4
**Created:** 2026-03-04
**Updated:** 2026-03-04

## Problem

When a user shrinks a highlight region so it's smaller than the area covered by the tracking/detection points, the overlay effect still renders outside the selected region boundaries. The overlay should be clipped to the region's time range, not extend to wherever detection boxes exist.

## Solution

Ensure the overlay rendering (both frontend preview and backend Modal/local render) clips the highlight effect to the region's `start_time`/`end_time` boundaries. Detection keyframes outside the region bounds should be ignored during rendering.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/OverlayScreen.jsx` - Frontend overlay preview
- `src/frontend/src/hooks/useOverlayState.js` - Region/keyframe state management
- `src/backend/app/modal_functions/video_processing.py` - `render_overlay` Modal function
- `src/backend/app/services/local_processors.py` - `local_overlay` fallback

### Related Tasks
- None

### Technical Notes
- Highlight regions have `start_time` and `end_time` properties defining their temporal bounds
- Detection keyframes are generated at fixed timestamps and may fall outside the region if the user resizes it
- The overlay renderer needs to respect region bounds as a hard clip, not just use keyframe positions
- Both the frontend canvas preview and backend FFmpeg render need to enforce this

## Implementation

### Steps
1. [ ] Reproduce: create region, shrink it smaller than detection points, observe overlay outside bounds
2. [ ] Check frontend preview — does it clip overlay to region bounds?
3. [ ] Check backend render — does Modal/local overlay clip to region bounds?
4. [ ] Add region bounds clipping to both frontend and backend render paths
5. [ ] Test: shrink region → verify overlay only appears within region time range

## Acceptance Criteria

- [ ] Overlay effect only renders within the region's start_time/end_time bounds
- [ ] Detection keyframes outside region bounds are ignored during render
- [ ] Frontend preview matches backend export output
- [ ] Existing full-region overlays are unaffected
