# T310: Mobile Framing/Editor Layout

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-03-04
**Updated:** 2026-03-04

## Problem

The framing/editor screen uses a two-column layout (clips list on left, video preview + details on right) that is unusable on mobile:
- Both columns are squeezed side-by-side, each getting ~50% of a 360px screen
- Video preview is tiny — the crop rectangle is barely visible
- Clip metadata text wraps awkwardly ("Great Movement Dribbling" + "Vs LA Breakers (LB) Sep 27" stacked)
- Dimension text ("205x365 @ (8...") is truncated
- The entire editing workflow is impractical at this size

This is the highest-impact mobile issue because framing is the core editing feature.

## Solution

Stack the layout vertically on mobile:
- Video preview takes full width at the top
- Clips list and controls below the video
- Clip details in a collapsible/expandable section
- Consider a swipe or tab interface between clips list and video preview

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FramingScreen.jsx` - Framing layout
- `src/frontend/src/containers/FramingContainer.jsx` - Framing logic
- `src/frontend/src/components/VideoPreview.jsx` - Video/crop preview
- `src/frontend/src/components/ClipsList.jsx` - Clips sidebar

### Related Tasks
- Part of: Mobile Responsive epic
- T320 (Mobile Video Preview) depends on this layout change

## Implementation

### Steps
1. [ ] Add responsive breakpoint to switch from side-by-side to stacked layout
2. [ ] Video preview takes full width on mobile
3. [ ] Clips list stacks below video
4. [ ] Clip metadata wraps properly at full width
5. [ ] Test framing workflow on mobile (select clip, adjust crop, export)

## Acceptance Criteria

- [ ] Video preview is large enough to see and interact with the crop rectangle
- [ ] Clips list is accessible without horizontal scrolling
- [ ] Full framing workflow is possible on a 360px screen
- [ ] Desktop layout is unchanged
