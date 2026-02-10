# T53: Fix Tracking Marker Navigation

**Status:** DONE
**Impact:** HIGH
**Complexity:** LOW
**Created:** 2026-02-09
**Updated:** 2026-02-10

## Problem

When clicking a green player tracking marker on the timeline, the video navigates to a frame that doesn't show the tracking boxes. The marker should guarantee navigation to the exact frame with detection data.

**Example:**
- User clicks green marker
- Video seeks to frame 46.1666 (no tracking visible)
- Actual tracked frame is at 46.23 (tracking boxes visible)

This is confusing because the green marker implies "tracking data exists here" but clicking it shows a frame without tracking.

## Solution

Ensure clicking a tracking marker navigates to the exact frame time where detection data exists, not an approximate time.

## Context

### Relevant Files
- `src/frontend/src/components/timeline/` - Timeline markers
- `src/frontend/src/stores/` - Detection/tracking state
- `src/frontend/src/hooks/` - Video navigation hooks

### Screenshots
- `screenshots/onclick.png` - Frame 46.17 after clicking marker (no tracking)
- `screenshots/tracked_frame.png` - Frame 46.23 with actual tracking boxes

### Technical Notes

**Likely Causes:**
1. Marker position calculated from detection time but click handler uses marker pixel position → time conversion (rounding error)
2. Detection times stored at specific intervals but seek uses different precision
3. Marker represents a range but navigates to start of range instead of detection frame

**Fix Approach:**
1. Store exact detection frame time in marker data
2. On marker click, use stored time directly instead of calculating from position
3. Ensure video.currentTime is set to exact detection time

## Implementation

### Steps
1. [x] Find where tracking markers are rendered on timeline
2. [x] Find click handler for markers
3. [x] Verify detection frame times are available in marker data
4. [x] Update click handler to seek to exact detection time
5. [x] Test with various detection frames

## Acceptance Criteria

- [x] Clicking green marker always shows frame with tracking boxes
- [x] Navigation time matches detection data time exactly
- [x] Works for all detection markers on timeline

## Resolution

**Root Cause:** The `fps` property was not being preserved when restoring/exporting highlight regions. The backend sends detection data with frame numbers calculated at a specific fps, but the frontend was discarding this fps during region restoration, causing `frameToTime()` to use a default value of 30 which might not match the original video.

**Fix:**
1. Added `fps` preservation in `useHighlightRegions.js` when restoring regions
2. Added `fps` preservation in `useHighlightRegions.js` when exporting regions
3. Added `framerate` prop to `DetectionMarkerLayer` in `OverlayMode.jsx` as fallback

**Files Changed:**
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js`
- `src/frontend/src/modes/overlay/OverlayMode.jsx`
