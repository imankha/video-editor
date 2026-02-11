# T57: Stale Tracking Rectangles When Extending Overlay Region

**Status:** DONE
**Impact:** MEDIUM
**Complexity:** MEDIUM
**Created:** 2026-02-11
**Completed:** 2026-02-11
**Type:** BUG

## Problem

When extending an overlay/highlight region in Overlay mode, the tracking rectangles (green player detection boxes) from the last tracked frame persist and display incorrectly. The boxes don't correspond to the current video frame position.

See: `screenshots/bad_tracking.png`

## Expected Behavior

- Tracking rectangles should only show for frames that have detection data
- When extending a region into untracked territory, boxes should not appear (or should show "no detection" state)
- Each frame should show its own detection data, not stale data from another frame

## Root Cause

The `clickedDetection` state in `OverlayContainer.jsx` was only cleared when video playback started. When a user:
1. Clicked a detection marker (setting `clickedDetection`)
2. Extended the region (without playing)
3. Scrubbed to the extended area

...the `clickedDetection` persisted and showed stale boxes because it was never cleared during scrubbing.

## Solution

Added an effect in `OverlayContainer.jsx` that clears `clickedDetection` when the user scrubs more than 2 frames away from the clicked detection's frame. This uses the same frame threshold as the `regionDetectionData` logic for consistency.

**File changed:** `src/frontend/src/containers/OverlayContainer.jsx`

## Acceptance Criteria

- [x] Tracking rectangles only display for frames with actual detection data
- [x] Extending a region does not show stale detection boxes
- [x] Detection boxes update correctly when scrubbing through video
