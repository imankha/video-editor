# T11380: Video remains panned off-center after zooming back to 100%

**Status:** IN PROGRESS
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-28
**Reported environment:** Production build 5870, Annotate

## Problem

After zooming the video in and then back out, the control reads `100%` but the video can remain
translated to one side, leaving a large black area on the opposite side. The production screenshot
shows this exact state: 100% zoom with the landscape video anchored left rather than centered.

## Investigation

`useZoom` stores `zoom` and `panOffset` independently. `resetZoom()` resets both, but the normal
`zoomOut()` and `zoomByWheel()` paths clamp `zoom` to `MIN_ZOOM` without clearing `panOffset`.
`VideoPlayer` always applies `translate(panOffset) scale(zoom)`, so a pan accumulated while zoomed
remains active after zoom reaches 1. The hook even reports `isZoomed=true` at 100% whenever the
stale pan is non-zero. Annotate, Framing, and Spotlight share this hook/player behavior.

## Solution

- Centralize zoom transitions so every path that lands at `MIN_ZOOM` also atomically centers pan.
- Cover button zoom-out, wheel/pinch zoom-out, and direct `setZoomLevel(1)`; do not change pan while
  the resulting zoom remains above 100%.
- Fix the shared hook rather than adding an Annotate-only visual correction.

## Acceptance Criteria

- [ ] Red-then-green hook test: pan at >100%, zoom out to 100%, `panOffset` becomes `{x:0,y:0}`.
- [ ] The same invariant holds for `zoomOut`, `zoomByWheel`, and `setZoomLevel`.
- [ ] Zooming out while still above 100% preserves the current pan.
- [ ] Annotate, Framing, and Spotlight render the video centered at 100% after zoom interaction.
- [ ] Live-drive the reported sequence at a desktop production-sized viewport; no asymmetric black
      bar remains.

## Implementation

- [x] Centralize clamped zoom transitions in `useZoom`; reaching `MIN_ZOOM` also centers pan.
- [x] Cover button zoom-out, wheel/pinch zoom-out, and direct `setZoomLevel(1)`.
- [x] Preserve pan while the resulting zoom remains above 100%.
- [x] Add focused hook regression coverage for all required transitions and `isZoomed`.

## Progress Log

**2026-09-29:** Implemented the shared-hook invariant and added four regression tests covering
button zoom-out, wheel zoom-out, direct reset to 100%, and pan preservation above 100%. The focused
hook and video-player suites pass: 20/20 tests. Desktop live-drive verification remains pending.
