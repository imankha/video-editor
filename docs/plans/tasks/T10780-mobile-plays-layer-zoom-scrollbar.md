# T10780: Mobile Annotate timeline is zoomed in with a horizontal scrollbar

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Problem

On a phone (screenshot from staging, 1080x2340 portrait, 2026-09-20) the Annotate timeline
renders a full game (~90 min) across roughly 280 CSS px of track. Every play collapses to a
sliver 4 to 8 px wide; adjacent plays merge into one green smear, the selected play is
indistinguishable from its neighbours, and tapping a specific play is a lottery. On desktop the
same track is ~900 px wide and the plays are legible, individually tappable chips. Mobile is
the primary capture-and-annotate surface for parents at a game, so this is the screen where
legibility matters most.

## Solution

Two changes, both inside the existing timeline machinery (no new abstraction):

1. **Zoom the Annotate track on mobile.** `AnnotateTimeline` currently hardcodes
   `timelineZoom={100} timelineScale={1}` into `TimelineBase` ("disable zoom for Annotate").
   On `isMobile`, pass a scale > 1 so the plays layer (and the scrubber above it, which must
   stay aligned) is rendered at desktop density. Recommended: a fixed **300%** scale (a 360 px
   phone track becomes ~840 px of content, about what a laptop shows). Desktop stays at 100%,
   byte-identical.
2. **Show a horizontal scrollbar the user can drag.** `TimelineBase` already renders
   `MobileScrollbar` (touch-drag thumb, synced both ways with the native scroll container)
   whenever `timelineScale > 1`. Annotate never triggered it because scale was pinned at 1.
   Fix its `sm:hidden` gate (640 px) so it shows for the whole `useIsMobile` range (1023 px or
   coarse pointer), not just below 640 px. Native touch swiping on the plays row also scrolls
   because the container is already `overflow-x: auto`.
   **It must be a real mobile control (user ruling 2026-09-20):** finger-sized, not the
   current 24 px sliver. Touch target >= 44 px tall (the whole track row is the hit area,
   drawn as a 36 px pill inside it), thumb at least 56 px wide with a visible grip, 8 px of
   air above (from the plays track) and 12 px below (before Edit play), edge-to-edge with the
   plays track so a thumb at 0% or 100% lines up with the first/last play.

The playhead must stay reachable: `TimelineBase` already auto-follows during playback and
resets to the start on a seek-to-0. Add the one missing case: when a seek that is NOT
playback (tap a play chip, prev/next play buttons, "Edit play" selection) lands the playhead
outside the visible window, scroll it into view.

## Mockup

Decision artifact with before/after phone frames (published 2026-09-20):
https://claude.ai/artifact/JorjZij5XGKnYQMr6myHri (source: `docs/plans/tasks/T10780-mockup.html`). Option A (fixed 300%, recommended) vs Option B (pinch-to-zoom, deferred:
more code, and the RegionLayer touch handlers already fight page zoom, see
`RegionLayer.jsx:117`).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` - passes `timelineZoom={100}` /
  `timelineScale={1}` to `TimelineBase`; make the scale `isMobile ? 3 : 1`
- `src/frontend/src/components/timeline/TimelineBase.jsx` - scroll container, auto-follow
  effect, `MobileScrollbar` (`sm:hidden` gate, `ml-20 sm:ml-32` must match the label column
  `ml-20 lg:ml-32`), zoom badge (`Zoom: 300%` text should NOT render on mobile: it is a
  fixed setting there, not a state the user changed)
- `src/frontend/src/hooks/useTimelineZoom.js` - reference only; Annotate does not use the
  hook (no wheel zoom), the mobile scale is a constant
- `src/frontend/src/modes/annotate/layers/ClipRegionLayer.jsx` - reference only; chips are
  positioned as % of track width so they scale for free
- `src/frontend/src/modes/annotate/AngleLanes.jsx` - reference only; also % positioned,
  verify it scales with the track (T8890 angle strip)
- Tests: `src/frontend/src/components/timeline/TimelineBase.autoscroll.test.jsx`,
  `src/frontend/src/modes/annotate/AnnotateTimeline.twoLane.test.jsx`,
  `src/frontend/src/modes/annotate/AnnotateTimeline.angleStrip.test.jsx`, plus a new
  `AnnotateTimeline.mobileZoom.test.jsx`

### Related Tasks
- Depends on: none (file-disjoint from T10760 / T10770)
- Related: T10620 (mobile portrait compact strip, same screen), T8890 (angle strip must scale
  too), T10370 (removed the dead zoom hint from Annotate)

### Technical Notes
- `TimelineBase` computes chip positions as percentages of the scaled inner div
  (`width: ${timelineScale * 100}%`), so RegionLayer / AngleLanes / playhead all scale with no
  per-layer change. `EDGE_PADDING` stays 20 px absolute on both ends.
- `MobileScrollbar` thumb width is `max(20, 100/scale)%` = 33% at 3x. Thumb drag writes
  `container.scrollLeft`; the native `scroll` event syncs the thumb back. No new state.
- `sourceTimeToVisualTime` / trim: Annotate passes no `trimRange`, so `visualDuration ===
  duration`; nothing to adjust.
- The touch scrubber (`handleTouchStart` on the track) uses `touch-none`, so a horizontal
  swipe on the SCRUBBER row seeks, while a swipe on the PLAYS row (RegionLayer) or on the new
  scrollbar scrolls. QA must drive both gestures.
- Landscape phones (`isMobile` via coarse pointer, width up to 1023) get the same 3x. Track
  width there is ~700 px, so 3x = ~2100 px; acceptable, but if it feels excessive scale from
  measured track width instead (`Math.max(1, 900 / trackClientWidth)`) so any device lands at
  desktop density. Decide at implementation; the fixed constant is the simpler first cut.
- **Playback follow already exists** (`computeFollowScrollTarget`, TimelineBase.jsx:11): it
  nudges the window only when the playhead crosses a 15% margin band, so while playing
  forward the playhead rides the RIGHT edge with almost no lookahead. On a phone at 3x that
  reads as "the playhead is about to fall off". Change the forward case to re-anchor the
  playhead at ~1/3 from the left (page-forward), keeping the backward case as is. Parameterize
  the anchor so Focus/Overlay (desktop wheel-zoom) keep their current behaviour byte-identical
  unless the reviewer agrees the new anchor is strictly better there too. The 2% start guard
  and the 2 s manual-scroll pause stay. Unit-test the pure function for both anchors.
- Do NOT persist zoom or scroll position (no persisted view state).
- Initial scroll position: on mount, scroll so the current playhead is visible (a returning
  user lands on the play they were editing), not at 0.

## Implementation

### Steps
1. [ ] `AnnotateTimeline`: `const mobileScale = isMobile ? 3 : 1` -> `timelineZoom={mobileScale * 100}` `timelineScale={mobileScale}`
2. [ ] `TimelineBase`: gate the `Zoom: N%` badge on a new `showZoomBadge` prop (Focus/Overlay
   keep it; Annotate passes false); change `MobileScrollbar` root to `lg:hidden` + `ml-20 lg:ml-32`
2b. [ ] `MobileScrollbar`: finger-sized. Row `min-h-[44px]` hit area (`py-1`), 36 px visual
   pill, thumb `min-w-[56px]` with a 3-line grip glyph, `mt-2 mb-3` spacing. Focus/Overlay
   share this component at < 1024 px, so they get the same larger bar; that is intended.
3. [ ] `TimelineBase`: scroll playhead into view on a non-playback seek that lands off-screen
   (extend the existing seek-to-start effect; reuse `computeFollowScrollTarget`)
3b. [ ] `computeFollowScrollTarget`: forward crossing re-anchors the playhead at ~1/3 from the
   left (page-forward with lookahead) for the mobile Annotate timeline; pure-function unit
   tests for both anchors; Focus/Overlay unchanged
4. [ ] `TimelineBase`: on mount with `timelineScale > 1`, scroll the playhead into view
5. [ ] Unit tests: mobile renders scale 3 + scrollbar; desktop renders scale 1 + no scrollbar;
   off-screen seek scrolls the container; mount scrolls to playhead
6. [ ] Live-drive at 393x852 and 360x740 (Playwright, dev-login on the dev fixture account, a
   real 60+ min game): screenshot before/after, drag the scrollbar, tap a play, hit next-play
   past the visible edge, play through the edge and confirm auto-follow
7. [ ] Reviewer on the diff; commit `T10780: ...`

### Progress Log

**2026-09-20**: Filed from a staging screenshot. Mockup artifact published.

## Acceptance Criteria

- [ ] On a phone (<= 1023 px or coarse pointer) the Annotate plays track renders at 3x the
      viewport width; individual plays are distinguishable and tappable (each chip >= 12 px
      wide for a 6 s play on a 90 min game at 360 px)
- [ ] A drag-able scrollbar sits directly under the plays track, thumb ~1/3 of the track,
      aligned with the track (not under the label column)
- [ ] The scrollbar is finger-sized: hit area >= 44 px tall (measured via
      `getBoundingClientRect` in the e2e spec), thumb >= 56 px wide with a visible grip, and
      >= 8 px gap above / >= 12 px below; a thumb drag starting anywhere in the row moves the
      window (no dead zone at the row's edges)
- [ ] Dragging the thumb scrolls the track; swiping the plays row scrolls the track; swiping
      the scrubber row still seeks
- [ ] **Playback follow (user ruling 2026-09-20):** while playing, the window moves on its
      own so the playhead stays where a user expects it: never off screen, and always with
      upcoming content visible ahead of it. Concretely: when the playhead reaches the right
      15% margin the window re-anchors so the playhead sits about 1/3 in from the left
      (page-forward with lookahead), not pinned to the right edge. Verified live on a phone
      viewport by playing across the visible edge at least twice, and after a manual scroll
      the follow resumes once the 2 s manual-scroll pause expires
- [ ] Playhead scrolls into view after tapping a play, using prev/next play, or opening a
      play from the list (non-playback seeks)
- [ ] Angle strip (games with added footage) scales with the plays track and stays aligned
- [ ] Desktop (>= 1024 px, fine pointer) is byte-identical: scale 1, no scrollbar, no badge
- [ ] No `Zoom: 300%` badge on mobile
- [ ] Curated relevant tests green; Branch CI green
