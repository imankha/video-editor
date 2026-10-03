# T11420: Spotlight timeline should open at the left edge

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-28
**Updated:** 2026-10-03
**Reported environment:** Production build 5870, Framing export to Spotlight

## Problem

After exporting Framing and entering **Add Spotlight**, the zoomed timeline can open horizontally
scrolled into the middle. The video/playhead are at `00:00:00.000`, but the custom scrollbar thumb
and timeline content are offset. Spotlight should always start at timeline scroll position 0.

## Investigation

`OverlayScreen` owns `useTimelineZoom`, whose React `scrollPosition` initializes to 0, and
`TimelineBase` has a layout effect intended to align the DOM scroller to that owned position.
Spotlight also auto-zooms once detection timestamps arrive (381% in the report), which is expected
and distinct from horizontal position. The screenshot proves the current lifecycle can still
retain or reintroduce a non-zero DOM/state position across the Framing-to-Spotlight transition,
despite the existing reset-intent comment. This needs a transition/lifecycle reproduction rather
than another blind `scrollLeft = 0` write.

## Solution Direction

Trace whether `OverlayScreen` remains mounted across mode switches and which scroll event updates
`timelineScrollPosition` during auto-zoom/hydration. Establish one explicit Spotlight-entry reset
that synchronizes both the mode-owned percentage and the DOM scroller after width is known, while
leaving the automatic zoom level and later user/playback scrolling intact.

## Context

### Relevant Files

- `src/frontend/src/screens/OverlayScreen.jsx:438-506` — timeline zoom state and detection auto-zoom.
- `src/frontend/src/hooks/useTimelineZoom.js` — zoom/scroll ownership and reset behavior.
- `src/frontend/src/components/timeline/TimelineBase.jsx:96-116,250-386` — DOM synchronization,
  scroll events, playback follow, and restart behavior.
- `src/frontend/src/components/timeline/TimelineBase.autoscroll.test.jsx` — scroll mechanism tests.
- Spotlight/Framing navigation tests — add the cross-mode regression at the actual lifecycle seam.

### Constraints

- Auto-zoom may remain above 100% so detection markers preserve usable spacing.
- Reset only on entering/re-entering Spotlight; do not fight manual scrolling after entry.
- Do not conflate the video zoom/pan bug in T11380 with timeline zoom/scroll.

## Implementation

### Steps

1. [x] Reproduce Framing export -> Spotlight with dense detections and capture state/DOM ordering.
2. [x] Add a red integration test that begins with a previously scrolled timeline.
3. [x] Implement one entry-boundary reset for both owned state and DOM position.
4. [x] Verify first entry, re-entry, auto-zoom hydration, manual scroll, and playback follow.

### Progress Log

**2026-10-03**: Root cause was `PosterMarkerLayer`'s mount-reveal (cover-marker auto-scroll)
firing unconditionally on Spotlight entry regardless of active tab, writing back through
`TimelineBase`'s scroll handler into the owned scroll-position state. Fix scopes the reveal to
only fire when the Cover-image tab is active. This necessarily narrows T6630 round 7's
"reveal regardless of active tab" behavior -- the two are mutually exclusive given this task's
constraint not to touch auto-zoom. Flagged by both the independent Reviewer and Proof Verifier;
user explicitly chose to accept the narrower reveal and ship (2026-10-03). Reviewer: APPROVED,
0 blocking/0 major. Proof Verifier: VERIFIED, red-to-green reproduced in an isolated copy, full
suite 40/40, CI green. Merged PR #555 (`8ae5b1cb9`). Live-browser staging pass still owed
(container had no dev stack/GPU) -- verify via Framing export -> Spotlight with dense
detections, confirm left-edge open + re-entry + Cover-image-tab reveal + manual scroll/playback.

## Acceptance Criteria

- [x] Spotlight opens with the timeline at horizontal position 0 after a Framing export.
- [x] Reopening Spotlight also starts at 0 regardless of the prior session's scroll.
- [x] Detection auto-zoom still chooses its required zoom level.
- [x] Manual scrolling and playback follow work normally after entry.
