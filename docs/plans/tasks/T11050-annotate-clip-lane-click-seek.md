# T11050: Annotate clip-lane click didn't move the playhead

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-24
**Updated:** 2026-09-24

## Problem

Reported live by imankh@gmail.com: clicking on the Annotate timeline's clips lane
(the "My athlete"/"Team" tracks, or the single mobile lane) did nothing — the
playhead never moved. Confirmed via Playwright against the real running dev
server: clicking the thin video scrub row above the lanes seeks correctly
(`TimelineBase.jsx`'s `onMouseDown`), but the `ClipRegionLayer.jsx` track
(background, not a clip marker) had no click handler at all — unlike Focus's
`CropLayer.jsx` and Overlay's `HighlightLayer.jsx`, whose lane backgrounds
already do something on click (add a keyframe / paste a highlight), Annotate's
clips lane background was a dead click target with no competing gesture.

## Solution

Give `ClipRegionLayer.jsx`'s track background the same click-to-seek behavior
as the video scrub row, mirroring `TimelineBase.getTimeFromPosition`'s own
edge-padding math exactly (same clamp order, same `EDGE_PADDING`). Marker/span
clicks already call `e.stopPropagation()`, so clip selection is unaffected —
only genuinely empty track space now seeks. Also calls `onLayerSelect()`
(selects the `'clips'` layer), matching the existing label-click behavior and
the `CropLayer`/`HighlightLayer` track-click pattern. Both props are optional
so callers/tests with no seek concept are unaffected.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/layers/ClipRegionLayer.jsx` - new `onSeek`/`onLayerSelect` props, `handleTrackClick`, `data-testid="clip-track"`
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` - threads `onSeek`/`onLayerSelect` into all three `ClipRegionLayer` call sites (mobile, desktop mine/team lanes)
- `src/frontend/src/modes/annotate/layers/ClipRegionLayer.trackClick.test.jsx` - new, click-to-seek math/clamping/marker-stopPropagation/no-op coverage
- `src/frontend/src/modes/annotate/AnnotateTimeline.trackClickSeek.test.jsx` - new, guards the prop-threading itself (verified this test fails if a lane's `onSeek` prop is dropped)

### Related Tasks
None.

### Technical Notes
- No persistence involved — seeking only drives the existing memory-only
  auto-select/deselect effect in `AnnotateContainer.jsx`, same as a scrub-row
  click. No new `useEffect`→write, no new API call.
- `onLayerSelect('clips')` when clicking empty lane space means wheel-zoom
  (which only fires while `selectedLayer === 'playhead'`) turns off until the
  user clicks the scrub row again — pre-existing behavior for label/marker
  clicks too, so this is consistent, not a new regression.
- Six timeline layers now each reimplement the same edge-padding
  `clamp(clientX - rect.left - pad) / (width - 2*pad) * duration` formula
  (`TimelineBase`, `CropLayer`, `HighlightLayer`, `SegmentLayer`, and now
  `ClipRegionLayer`). Past the project's third-duplication threshold; a shared
  `timeFromClientX()` helper would be a reasonable follow-up cleanup task, but
  is out of scope for this bug fix.

## Implementation

### Steps
1. [x] Add `handleTrackClick` + `onSeek`/`onLayerSelect` props to `ClipRegionLayer.jsx`
2. [x] Thread `onSeek`/`onLayerSelect` through all 3 `ClipRegionLayer` call sites in `AnnotateTimeline.jsx`
3. [x] Tests (click math, clamping, marker/span stopPropagation preserved, no-op without `onSeek`, prop-threading regression guard)
4. [x] Fresh-context Reviewer (Tier M) — APPROVED, no BLOCKING/MAJOR findings

### Progress Log

**2026-09-24**: Implemented per plan above in an isolated worktree
(`C:\work\tasks\t11050`, off `master`). Live-verified against the real running
dev server (a second Vite instance on port 5175 pointed at this worktree,
proxying to the same backend on 8000, dev-logged-in as
imankh+devfixture@gmail.com / game 11): before the fix, clicking empty clip-lane
space did nothing; after the fix, it seeks to the correct time AND highlights
the "My athlete"/"Team" label, while clicking an existing clip marker still
seeks to that clip's own start time unaffected. Fresh-context Reviewer (Tier M)
approved with only MINOR findings, three of which were cheap enough to fix
before commit: added `data-testid="clip-track"` (tests no longer couple to
Tailwind classes), added a `clip-span` stopPropagation assertion, and added
the dedicated `AnnotateTimeline.trackClickSeek.test.jsx` regression guard for
the prop-threading itself (manually confirmed it fails if a lane's `onSeek` is
dropped, then reverted the deliberate breakage). Two findings accepted as
pre-existing/out-of-scope: the click-not-drag-scrub divergence from the video
track, and the six-way duplication of the edge-padding time math across
timeline layers (candidate for a separate cleanup task, not this fix).

## Acceptance Criteria

- [x] Clicking empty space in the Annotate clips lane (mobile single lane,
      desktop "My athlete" lane, desktop "Team" lane) moves the playhead to
      that position
- [x] Clicking a clip marker or its span bar still selects that clip and seeks
      to its own start time, unaffected by the new track-click handler
- [x] Clicking empty lane space also selects the `'clips'` layer, matching the
      label-click behavior
- [x] Frontend unit tests pass (new + all existing `ClipRegionLayer`/`AnnotateTimeline` tests)
- [x] Live-verified against the dev fixture account on a real running dev
      server, not simulated with mocks
