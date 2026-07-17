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

---

## Progress Log

### Step 1 — Line-diff of the 3 copies (BEFORE unifying)

**Core aspect-fit math is byte-identical across all three copies.** The `videoAspect` /
`containerAspect` branch, `baseDisplayWidth/Height`, `displayWidth/Height = base * zoom`,
`offsetX/Y = (container - display)/2 + panOffset`, and `scaleX/Y = display / metadata` lines
are the same in Crop, Highlight, and PlayerDetection. **There is no placement-math drift** —
the only *behavioral* divergences are the two known fix-axes below. No extra placement bug was
found, so no additional fix beyond the unification is warranted.

**Intended divergence (the two known fixes):**

| Fix axis | CropOverlay (framing) | HighlightOverlay (overlay) | PlayerDetectionOverlay (overlay) |
|----------|-----------------------|----------------------------|----------------------------------|
| first-paint (`useLayoutEffect`) | ✅ `useLayoutEffect` | ❌ `useEffect` | ❌ `useEffect` |
| rAF-leak (inner frame cancelled) | ❌ double-rAF settle present but only the **outer** id is captured/cancelled — inner frame leaks on unmount (:102-108) | ✅ both ids tracked + cancelled (:92-101) | ❌ **no rAF at all** — also no fullscreen settle |

Unified hook has BOTH by construction: `useLayoutEffect` + double-rAF settle with both frame
ids cancelled.

**Incidental drift (beyond the two fixes) — surfaced, none is a placement bug:**

| # | Drift | Copies | Resolution in unified hook |
|---|-------|--------|----------------------------|
| D1 | Computes dead `left`/`top` fields (screen-absolute video pos via `containerRect.left/top`, `videoLeft`, `videoTop`) that nothing reads | Crop only | **Dropped** — no consumer reads `rect.left`/`rect.top` (verified by grep) |
| D2 | Defines `screenToVideo` inverse but never calls it — drag handler hand-rolls `delta / scaleX` instead | Crop only | **Kept & exposed** to all three via `screenToVideo`; drag handlers left hand-rolling (no behavior change; inverse now available for the next feature) |
| D3 | `videoToScreen` signature: `(x,y,radiusX,radiusY)→{x,y,radiusX,radiusY}` | Highlight (Crop/PD use `w,h→width,height`) | **Unified** on `(x,y,w,h)→{x,y,width,height}`; Highlight maps `width→radiusX, height→radiusY` at its one call site (identical math) |
| D4 | Guards `!videoMetadata` before computing | PD only (Crop/Highlight would throw on null metadata) | **Unified** on the `!videoMetadata` guard (safe superset → `rect` stays `null`, overlays already null-guard `rect`) |
| D5 | Local `round3` copy (used for constrain rounding too) | Crop, Highlight (PD has none) | Exported `round3` from hook module; Crop/Highlight import it, deleting their local copies |
| D6 | Captures `const video = videoRef.current` once outside `updateRect` | Highlight (Crop/PD re-read each call) | **Unified** on re-reading `videoRef.current` inside `updateRect` (safer if the ref target swaps) |

**Conclusion:** no divergence beyond the two known fixes changes on-screen placement. Proceeding
to unify (hook + tests, then one overlay per commit).
