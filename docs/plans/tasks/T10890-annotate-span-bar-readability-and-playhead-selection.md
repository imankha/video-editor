# T10890: Annotate span-bar readability on long games + playhead nearest-center selection

**Status:** DONE (deployed 2026-09-21 prod)
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Problem

Filed from a prod screenshot (account imankh@gmail.com, 88-minute game, 29 plays, 100% zoom):
every play-marker span bar under "My athlete"/"Team" renders as a ~3px dot regardless of clip
length. Clip #6 "dfsadf" (17:54.6 -> 18:44.6, 50.0s) looks no wider than a 10s clip.

Two things bundled here (found together, same files):

1. **Span-bar readability (design question, not a regression).** Verified empirically (see
   Investigation below): the bars ARE proportional — `ClipRegionLayer.jsx`'s
   `widthPct = (endTime-startTime)/duration*100` computes a genuinely different percentage per
   clip — but at typical track widths on a long (~88min) game, nearly every play's true width is
   under the 3px `minWidth` floor, so they all render identically. This needs a design decision,
   not a silent behavior change.
2. **Playhead click doesn't select the play under it (real bug).** Clicking the timeline within
   a marked play's start/end should select that play; when multiple plays overlap the clicked
   time, the one whose center is closest to the click wins. Current auto-select
   (`AnnotateContainer.jsx` `getRegionAtTimeUnified`, used by the `effectiveCurrentTime` effect)
   uses `Array.find`, which returns the FIRST array-order match, not the nearest-center one.

## Investigation (2026-09-21, empirical — do not re-derive)

Drove the app as a real user (dev fixture account `imankh+devfixture@gmail.com`, game id=1
"Vs LA Breakers May 9", video_duration=5281.8s, clip_count=29 — same shape as the prod report)
via a throwaway Playwright spec against the running dev server. Dumped every
`[data-testid="clip-span"]`'s `data-region-id`, rendered `getBoundingClientRect().width`, and its
`style.width` percentage, plus the track's own rendered width (718px in the Playwright viewport).

Result: `style.width` percentages varied continuously across clips (0.07% - 0.52%, i.e.
genuinely proportional to each clip's real duration), but computed pixel width was 3px (the
floor) for 28 of 29 clips — only the single longest clip (0.497%, ~26s at this game's length)
just barely cleared the floor at 3.36px. This confirms **H1 (scale, not a bug)**: the percentage
math is correct; the 3px floor plus a ~700-1000px track over an 80+ minute game makes nearly
every real-world play (10-30s) sub-pixel, so all bars collapse to the same visual dot. Not H2 —
`startTime`/`endTime` are NOT collapsing; `useAnnotate.js` region mapping is fine.

**Decision needed (see artifact) before implementing any span-bar behavior change.**

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/layers/ClipRegionLayer.jsx` (~L185-215) - span bar rendering,
  `minWidth: '3px'` floor
- `src/frontend/src/containers/AnnotateContainer.jsx` (~L1775-1894) - `getRegionAtTimeUnified`
  (playhead->region matching, used by both `handleTimelineSeek` and the auto-select/deselect
  effect) and `handleSelectRegion`
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` (~L627-634) - `getRegionAtTime`
  (single-video path; same `Array.find` first-match issue)

### Related Tasks
- T10430 (archived, PLAN-archive.md) - introduced the layer-colored span bar per clip (this task's
  subject)
- T10810 (commit 13ca1c93, 2026-09-20) - mobile disc markers rewrite; last to touch
  `ClipRegionLayer.jsx` before this
- T10780-T10820 - Mobile Annotate timeline zoom epic (archived) - the `TimelineBase` zoom
  mechanism a scale-with-zoom option (below) would piggyback on

### Technical Notes
`getRegionAtTimeUnified` returning first-match-in-array-order (not nearest-center) has been the
behavior since the function was introduced; only surfaced now because overlapping plays are rare
on real data but WILL occur (angle clips, closely-timed plays). Fix: when multiple regions match
a time, pick the one whose `(startTime+endTime)/2` is closest to the query time. Applies to both
`useAnnotate.js`'s `getRegionAtTime` (single-video) and `AnnotateContainer.jsx`'s
`getRegionAtTimeUnified` (multi-video/overlap) — same fix shape in both.

## Implementation

### Steps
1. [x] Investigate H1 vs H2 empirically (drive-app-as-user, dev fixture game id=1)
2. [x] Fix `getRegionAtTime` (useAnnotate.js) and `getRegionAtTimeUnified` (AnnotateContainer.jsx)
   to pick the nearest-center match among overlapping regions, not first-array-order
3. [x] Add/extend a test covering: playhead within one play selects it; playhead within two
   overlapping plays selects whichever center is closer
4. [x] Produce decision artifact for span-bar readability options; **stop for user approval**
   before implementing any of them -- https://claude.ai/artifact/VRztYxsiraMJz6wsMrUENB
   (shared with T10930, the zoom-controls request the user filed in the same session; the
   recommended option D means T10930 IS this half's fix). Playhead half shipped to master in
   5b08aebf on 2026-09-21.
5. [x] (post-approval) Option D approved: the span bar stays honest and T10930 (zoom chip) is the fix; width proportionality at 300% proved live in T10930 (26 s = 10.5 px vs 10 s = 4 px)

### Progress Log

**2026-09-21**: Investigated (H1 confirmed, see above). Starting nearest-center playhead fix
(well-specified, no design gate needed). Span-bar readability decision artifact to follow;
implementation of that half is blocked on user's choice.

**2026-09-21 (later)**: Playhead half implemented + reviewed (one fresh-context Reviewer pass,
0 blocking / 2 major / 3 minor, all majors addressed):
- New `modes/annotate/regionAtTime.js`: `pickNearestCenterRegion` (argmin of center distance;
  equal-distance ties go to the SHORTER span, never array order) + a shared `FRAME_TOLERANCE`
  (0.15s). Both `useAnnotate.getRegionAtTime` and `AnnotateContainer.getRegionAtTimeUnified`
  now filter with `+-FRAME_TOLERANCE` (previously only the auto-DESELECT check had the
  tolerance, so a seek snapping to a frame boundary just outside a region's edge matched
  nothing) and reduce via the shared picker. The effect's local `FRAME_TOLERANCE` const is
  replaced by the shared import: one tolerance policy.
- Tests: `regionAtTime.test.js` (5, incl. order-independence + tie-break) and
  `AnnotateContainer.nearestCenterSelection.test.jsx` (2, drives the REAL container: load with
  playhead outside every region, then move it onto an overlap -> the tighter/closer play is
  selected; move it where only the wide play is -> the wide play).
- Curated set run (8 files, 72 tests, green): regionAtTime, useAnnotate x3, useClipSelection,
  AnnotateContainer nearestCenterSelection/pendingSelection/createAtTap. Lint: 0 errors (9
  pre-existing warnings, none on changed lines).
- **Scope note, found while writing the container test:** the nearest-center pick fires when
  selection is NONE or when the playhead leaves the currently selected play (the existing
  effect's two branches). While a play is already SELECTED and the playhead is still inside
  it, moving closer to an overlapping neighbour's center does NOT switch selection (the effect
  only re-evaluates on exit). That is the pre-existing "don't yank the selection out from under
  a playing clip" behaviour and matches the gesture the task describes (click/seek onto
  overlapping plays); left as is deliberately.
- Reviewer MAJOR-2 (accepted, carried into the span-bar half): on an 88-min game at ~700-1050px
  one pixel is ~5-7s while the default play window is 8s, so "clicking on the 3px dot" lands
  outside the play's real range most of the time regardless of this fix. That IS the
  readability decision, not a selection bug.

## Acceptance Criteria

- [x] Clicking/scrubbing the playhead into a single play's start..end range selects that play
- [x] With overlapping plays, the one whose center is closest to the playhead is selected
- [x] Unit test proves both cases
- [x] Span-bar readability: option D approved 2026-09-21; shipped via T10930
