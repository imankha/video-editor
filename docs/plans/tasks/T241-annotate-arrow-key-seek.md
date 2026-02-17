# T241: Annotate Arrow Keys Should Seek 4 Seconds

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-02-17
**Updated:** 2026-02-17

## Problem

In Annotate mode, the forward and backward arrow keys are supposed to move the playhead 4 seconds forward/backward, but they don't work correctly.

This breaks the expected keyboard navigation workflow for scrubbing through video.

## Solution

Fix the arrow key handlers in Annotate mode to properly seek 4 seconds in each direction.

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` - Annotate mode keyboard handlers
- `src/frontend/src/containers/AnnotateContainer.jsx` - May have video control logic
- `src/frontend/src/components/VideoControls.jsx` - If shared controls exist

### Related Tasks
- Related to: T60 (Consolidate Video Controls) - completed, may have introduced regression

### Technical Notes
- Need to verify if this worked before and regressed, or never worked
- Check if the 4-second value is defined somewhere (constant vs hardcoded)
- May need to check if other modes (Framing, Overlay) have working arrow key seek

## Implementation

### Steps
1. [ ] Reproduce the bug - verify arrow keys don't seek in Annotate
2. [ ] Check if arrow key seek works in other modes
3. [ ] Find the keyboard event handler in Annotate mode
4. [ ] Fix the seek logic to move 4 seconds
5. [ ] Test arrow key navigation

### Progress Log

*No progress yet*

## Acceptance Criteria

- [ ] Right arrow key seeks forward 4 seconds in Annotate mode
- [ ] Left arrow key seeks backward 4 seconds in Annotate mode
- [ ] Seek respects video boundaries (doesn't go negative or past end)
