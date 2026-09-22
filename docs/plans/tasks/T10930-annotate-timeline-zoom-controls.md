# T10930: Annotate timeline zoom in/out with a visible control, desktop and mobile

**Status:** DONE (deployed 2026-09-21 prod)
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Problem

User request 2026-09-21: "in annotate we should have the ability to zoom into and out of the
timeline and then use the scroll UI when not at 100%. Think of UI that would work for mobile
and desktop." Filed alongside T10890's finding that on an 88-minute game one track pixel is
5-7 s, so every play's span bar collapses to the 3 px floor at 100%: zoom is the honest fix.

## Current state (facts, mapped 2026-09-21)

- `hooks/useTimelineZoom.js`: `timelineZoom` 100-500%, step 25, `zoomByWheel`, `zoomIn`,
  `zoomOut`, `resetZoom`, `setZoom`, `getTimelineScale`; plain `useState`, nothing persisted.
- `components/timeline/TimelineBase.jsx`: wheel zoom only when `selectedLayer === 'playhead'`;
  read-only "Zoom: N%" badge (not clickable, hidden at 100%); `.timeline-scroll-container`
  with playhead-follow autoscroll (T5647) above scale 1; `MobileScrollbar` touch pill (T10780)
  above scale 1. **No +/- or reset buttons exist anywhere for the timeline** (the
  `ZoomControls.jsx` component is the VIDEO zoom, unrelated).
- Focus and Overlay wire the hook (wheel + badge on desktop; NO zoom gesture at all on mobile).
- `modes/annotate/AnnotateTimeline.jsx`: pins `timelineScale` to 1 (desktop) / 3 (mobile,
  T10780 "Option A"), passes no `onTimelineZoomByWheel`, `showZoomBadge={false}`.
- T10780 deferred pinch-to-zoom: the RegionLayer lever touch handlers already fight page zoom.

## Proposed (decision artifact, awaiting the user's pick)

Artifact: https://claude.ai/artifact/VRztYxsiraMJz6wsMrUENB (interactive: the fixture game's
29 real plays at any zoom 100-500% under each bar rule, plus desktop/phone control mockups).

Recommended: **"chip on both"**. A `-  N%  +` chip (click % to reset) top-right of the track on
desktop AND phone (44 px targets on phone), rendered by `TimelineBase` in place of the read-only
badge so Focus/Overlay get it too. Desktop keeps wheel zoom; phone keeps the scroll pill. Phone
OPENS at 300% (today's fixed value becomes the default, not the only value) and can go 100-500%.
No pinch in this task (T10780's reason stands); "chip + pinch" is the listed alternative.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` (drop the constant scale, take zoom props)
- `src/frontend/src/screens/AnnotateScreen.jsx` (own `useTimelineZoom`, like FocusScreen L336-342)
- `src/frontend/src/components/timeline/TimelineBase.jsx` (render the chip; keep badge gate tests honest)
- `src/frontend/src/components/timeline/TimelineZoomChip.jsx` (new) + test
- `src/frontend/src/hooks/useTimelineZoom.js` (initial-zoom option for the mobile 300% default)
- `src/frontend/src/modes/annotate/AnnotateTimeline.mobileZoom.test.jsx` (update: no longer asserts "no badge")

### Related Tasks
- T10890 (span-bar readability half; this task IS its fix if option D is chosen)
- T10780 (mobile fixed 3x, scroll pill), T10370 (dead zoom hint), T5647 (autoscroll)

### Technical Notes
Zoom stays view state for the life of the screen, never persisted (T10780 decision, and
CLAUDE.md: no persisted view state). Wheel zoom must remain gated on the playhead layer so the
lanes still scroll. Tier M, frontend only, no schema.

## Progress Log

**2026-09-21**: Approved (option D + chip on both). Shipped in two commits: Annotate (hook owned by
AnnotateModeView, chip in TimelineBase, phone default 300%) and the Focus/Overlay threading. Tests:
TimelineZoomChip (2), AnnotateTimeline.mobileZoom (6, rewritten), AnnotateModeView.timelineZoom (3,
incl. zoom survives a fullscreen remount); Focus/Overlay regression set 26 files / 107 green. Live
Playwright on the fixture game: desktop chip 100% -> 300%, longest (26.2 s) span 3.36 -> 10.5 px vs
a 10 s span 3 -> 4.0 px; phone opens at 300% with 44x44 targets and the scroll pill, zooms out to
100% (pill gone). Screenshots checked once.

## Acceptance Criteria

- [x] Desktop: -/+/reset chip visible on the Annotate track; wheel over the scrub row zooms
- [x] Phone: same chip with 44 px targets, opens at 300%, can reach 100% and 500%; scroll pill
      appears above 100%
- [x] Above 100% the track scrolls and follows the playhead (existing T5647 behaviour)
- [x] Live-drive on the fixture game: at 300% the 26 s play's span bar is measurably wider than a
      10 s play's (closes T10890's readability half)
- [x] Focus/Overlay show the chip too and their existing wheel behaviour is unchanged
