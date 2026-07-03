# T4550: useVideoDisplayRect — One Video→Screen Transform

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-03
**Source:** Audit item C2 ([audit doc](../audit-2026-07-03-code-quality.md))

## Problem

[DRY] The video→screen coordinate transform (aspect-fit rect inside `.video-container`, zoom/pan offsets, `videoToScreen`, `round3`) is implemented three times, and **each copy is in a different bug state** — the definitive fix-it-thrice exhibit:

| Copy | Has rAF-leak fix (inner frame cancelled) | Has first-paint fix (useLayoutEffect) |
|------|------------------------------------------|----------------------------------------|
| `modes/framing/overlays/CropOverlay.jsx:37-110` | ❌ (leaks, :102-108) | ✅ (:37) |
| `modes/overlay/overlays/HighlightOverlay.jsx:43-102` | ✅ (:92-101) | ❌ (useEffect) |
| `modes/overlay/overlays/PlayerDetectionOverlay.jsx:32-75` | ❌ | ❌ (has neither, nor the double-rAF fullscreen settle) |

## Solution

`hooks/useVideoDisplayRect(videoRef, videoMetadata, { zoom, panOffset, isFullscreen })` returning `{ rect, videoToScreen, screenToVideo }` — with BOTH fixes (layout effect + full rAF cleanup + fullscreen settle). The three overlays consume it; their local implementations are deleted.

- Diff the three copies line-by-line FIRST; any divergence beyond the two known fixes goes in the Progress Log table as intended-vs-drift before unifying.
- `screenToVideo` (inverse) — check whether drag handlers hand-roll the inverse today; include it so the next feature doesn't.
- Geometry is pure given inputs — unit-test the math directly (aspect-fit letterbox cases: wide video/tall container and inverse; zoom+pan; fullscreen).

## Steps

1. [ ] Line-diff table of the three copies.
2. [ ] Hook + math unit tests; behavior tests for resize/fullscreen (jsdom `getBoundingClientRect` mocks — follow existing overlay test patterns if any).
3. [ ] Migrate one overlay per commit: CropOverlay (gets the leak fix), HighlightOverlay (gets first-paint), PlayerDetectionOverlay (gets both).
4. [ ] Manual: crop drag accuracy, highlight placement accuracy, fullscreen toggle + zoom/pan in all three, no console rAF warnings.

## Acceptance Criteria

- [ ] One transform implementation; three consumers
- [ ] All three overlays have both fixes (leak + first-paint) by construction
- [ ] Coordinate math unit-tested incl. letterbox + zoom/pan + fullscreen
- [ ] Manual placement-accuracy check recorded per overlay
