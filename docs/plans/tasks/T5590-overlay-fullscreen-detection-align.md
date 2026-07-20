# T5590: Overlay tracking boxes / spotlight circle misalign in mobile fullscreen

**Status:** IN PROGRESS (branch feature/T5590-overlay-fullscreen-detection-align pushed; awaiting review/merge)
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-20
**Tier:** M (frontend-only, no schema/backend)

## Problem

Found 2026-07-20 (imankh, mobile): in Overlay mode, entering fullscreen makes the
player-detection boxes (and the spotlight circle) no longer line up with the players.

## Root cause

There are two fullscreen states: desktop `isFullscreen` and mobile `mobileFs`
(`OverlayModeView.jsx:254`). Entering mobile fullscreen re-parents the player to
`fixed inset-0 w-full h-full`, resizing the `.video-container` — but the WINDOW does not
resize, so no `resize` event fires, and the overlays only receive `isFullscreen`
(`OverlayModeView.jsx:431`), never `mobileFs`. `useVideoDisplayRect` recomputed its
video->screen transform only on a window `resize` or an `isFullscreen` change, so in mobile
fullscreen it kept the pre-fullscreen geometry and every overlay drifted off the players.

## Fix

Observe `.video-container` with a `ResizeObserver` in `useVideoDisplayRect` so the transform
recomputes on ANY container size change (mobile fullscreen, orientation, layout shift), not
just a window resize. Guarded on `typeof ResizeObserver` (jsdom has none -> graceful);
disconnected on cleanup. The pure aspect-fit math (`computeVideoDisplayRect`) was already
correct — the bug was purely that nothing triggered a recompute.

## Verification

- Unit test drives a container resize through a mock ResizeObserver and asserts the rect
  recomputes (scale 0.5 -> 1.25).
- Real-Chromium check: a ResizeObserver on `.video-container` fires with the fullscreen
  dimensions when the element is re-parented to `fixed inset-0`, confirming it does not
  depend on a window resize.

## Acceptance Criteria

- [x] Detection boxes + spotlight circle stay aligned when entering/exiting mobile fullscreen.
- [x] Desktop fullscreen + windowed unchanged; no regression to the pure transform math.
- [x] jsdom (no ResizeObserver) degrades gracefully.
