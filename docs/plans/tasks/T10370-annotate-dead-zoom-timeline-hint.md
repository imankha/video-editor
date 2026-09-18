# T10370: Annotate shows a dead "Scroll to zoom timeline" hint

**Status:** WIP
**Impact:** 2
**Complexity:** 1
**Created:** 2026-09-18
**Updated:** 2026-09-18

## Problem

Found by the UX agent investigating T10380 (Annotate toolbar placement). `TimelineBase.jsx`
renders "Scroll to zoom timeline (current: {timelineZoom}%)" whenever the playhead layer is
selected, with no check for whether the mode actually wired timeline zoom. Annotate never does:
`AnnotateTimeline.jsx` hardcodes `timelineZoom={100}` and never passes
`onTimelineZoomByWheel`. So on Annotate the hint always reads "100%" and scrolling silently does
nothing — dead, misleading UI shown on every session.

## Solution

Gate the hint on `onTimelineZoomByWheel` actually being provided, not just on which layer is
selected. Focus/Overlay always pass the handler, so their hint is unaffected; Annotate never
does, so the hint stops rendering there.

## Context

### Relevant Files
- `src/frontend/src/components/timeline/TimelineBase.jsx` — hint render site (~line 444)

### Technical Notes
Single-file, single-condition fix. No behavior change for Focus/Overlay (they always pass
`onTimelineZoomByWheel`).

## Acceptance Criteria

- [x] Annotate's timeline never renders the "Scroll to zoom timeline" hint
- [x] Focus/Overlay's hint is unaffected
- [x] Targeted test added
