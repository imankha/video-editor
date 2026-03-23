# T650: Clip Scrub Region UI

## Pain Point

Multiple user feedback items about clip creation/editing in Annotate mode:

1. **Too coarse**: Time scrubbing jumps too far (e.g., 6.14 → 6.39), no fine-grained control for fast-paced sports clips
2. **Time appears to shift**: Clip boundaries seem to move during playback, causing confusion
3. **Workflow confusing**: User forgot instructions, couldn't figure out how to set start/end times. The flow isn't self-explanatory.

## Solution

Replace the current start/end time input UI in the Add Clip dialog with a **visual scrub region**:

### Scrub Region Spec

- **Trigger**: User clicks "Add Clip" at playhead position (the "Add Clip point")
- **Window**: 30-second viewport centered around the Add Clip point — **20 seconds before** and **10 seconds after**
- **Initial region**: 8 seconds before the Add Clip point up to the Add Clip point itself
- **Controls**: Two draggable handles (start handle, end handle) on a mini-timeline
- **Real-time video preview**: As the user drags either handle, the video updates to show the frame at that handle's position (playhead = handle being scrubbed)
- **Play button**: User can play the selected region to preview the clip before confirming

### Example

If user clicks "Add Clip" at 6:14:
- Scrub window: 5:54 → 6:24
- Initial region: 6:06 → 6:14 (green highlighted section)
- User drags start handle left to 6:02, sees video frame at 6:02
- User drags end handle right to 6:18, sees video frame at 6:18
- User clicks play to preview 6:02–6:18, then confirms

### Edit Mode

When opening an existing clip for editing (see T660), this same scrub region UI appears pre-populated with the clip's current start/end times. The window centers on the clip's midpoint with the same 20s before / 10s after sizing.

## Scope

**Stack Layers:** Frontend
**Files Affected:** ~4-6 files
**LOC Estimate:** ~200-300 lines
**Test Scope:** Frontend Unit + Frontend E2E

## Implementation Notes

- New component: `ClipScrubRegion` — mini-timeline with draggable start/end handles
- Replaces current duration/start/end time inputs in the Add Clip dialog
- Video element seeks to handle position on drag (use `video.currentTime = handleTime`)
- Clamp handles to the 30-second window bounds
- Handle drag should be smooth (requestAnimationFrame or pointer events, not input onChange)
- Play button plays from region start to region end, then stops
- Mobile: handles need to be touch-friendly (min 44px tap targets)

## Source

User feedback (2026-03-23): NUF tester struggled with clip timing — too coarse, confusing workflow, times appeared to shift. Three separate feedback items all pointing to the same root cause: the time selection UI isn't visual enough.
