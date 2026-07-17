# T4932: Annotate mobile playback maxHeight uses 100vh (should be 100dvh)

**Status:** DONE
**Impact:** 4
**Complexity:** 1
**Created:** 2026-07-15
**Updated:** 2026-07-15

## Problem

Found by the T4930 `h-screen`/`100vh` lint gate (`scripts/check-viewport-units.mjs`),
where it is currently catalogued as tracked KNOWN_DEBT. In mobile Annotate fullscreen
playback the video area is sized with a raw `100vh`:

```jsx
maxHeight: mobilePlaybackFs ? '100vh' : 'calc(100vh - 120px)',
```
([AnnotateModeView.jsx:215](../../src/frontend/src/modes/AnnotateModeView.jsx#L215))

On iOS Safari `100vh` is taller than the visible viewport (it spills behind the dynamic
toolbar), so in fullscreen playback the video/controls can extend off-screen — the T4880
clipping class, invisible to Playwright emulation (hence the source-level gate).

## Solution

Convert `100vh` -> `100dvh` and `calc(100vh - 120px)` -> `calc(100dvh - 120px)` (dvh
tracks the true visible viewport). Then remove the `AnnotateModeView.jsx` entry from
`KNOWN_DEBT` in `scripts/check-viewport-units.mjs` (the gate FAILS on a stale entry, so
removal is enforced in the same change). Verify mobile Annotate fullscreen playback fits
the visible viewport on a phone.

## Acceptance Criteria

- [ ] Mobile Annotate fullscreen playback uses `100dvh`; video/controls fit the visible viewport.
- [ ] `AnnotateModeView` removed from `KNOWN_DEBT` in `check-viewport-units.mjs`; gate green.

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` (~215)
- `scripts/check-viewport-units.mjs` — remove the KNOWN_DEBT entry on fix

### Related Tasks
- Found by: T4930 (viewport-unit gate). Same class as: T4880.
