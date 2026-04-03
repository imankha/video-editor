# T830: Clip Preview Timeline Shows Full Video Duration

**Status:** TESTING
**Impact:** 6
**Complexity:** 4
**Created:** 2026-04-01
**Updated:** 2026-04-01

## Problem

In the "New Project" modal (GameClipSelectorModal), when previewing a clip, the playback timeline spans the entire game video instead of just the clip's start_time → end_time range. The user sees a tiny sliver of the scrubber representing the actual clip within a multi-hour timeline.

### Expected Behavior
Timeline should show only the clip range (e.g., 0:00 to 0:08 for an 8-second clip).

### Actual Behavior
Timeline shows the full game video duration (e.g., 0:00 to 1:32:14), with the clip being a barely visible segment.

## Solution

The clip preview video player needs to use `clipOffset` and `clipDuration` (like framing mode does) to scope the timeline to the clip range. The video element still loads the full game video URL, but the UI should treat `start_time` as 0 and `end_time - start_time` as the duration.

## Context

### Relevant Files
- `src/frontend/src/components/GameClipSelectorModal.jsx` — clip preview player
- `src/frontend/src/hooks/useVideo.js` — clipOffset/clipDuration handling

### Related Tasks
- T740: Introduced game video range queries (clipOffset model)
