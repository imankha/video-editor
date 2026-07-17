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

### Steps 2-4 — Unify + migrate (commits)

| Commit | What |
|--------|------|
| `feat(T4550)` | `hooks/useVideoDisplayRect.js` (useLayoutEffect + double-rAF settle, both frame ids cancelled) + pure `computeVideoDisplayRect` / `videoToScreenRect` / `screenToVideoRect` / `round3` + 15 unit tests |
| `refactor(T4550)` CropOverlay | consumes hook; **gains rAF-leak fix**; drops dead `left/top` (D1) and dead `screenToVideo` (D2) |
| `refactor(T4550)` HighlightOverlay | consumes hook; **gains first-paint fix**; maps `{width,height}->{radiusX,radiusY}` at the one call site (D3) |
| `refactor(T4550)` PlayerDetectionOverlay | consumes hook; **gains BOTH fixes** (had neither); uniform `!videoMetadata` guard (D4) |
| `test(T4550)` | live-drive QA spec `e2e/T4550-overlay-transform.qa.spec.js` |

### QA results

- **Math/hook unit tests:** `src/hooks/__tests__/useVideoDisplayRect.test.js` — 15/15 green
  (letterbox wide-video + tall-video + matching-aspect; zoom+pan; fullscreen container
  resize; exact `screenToVideo(videoToScreen(p)) === p` inverse; null-rect guard; first-paint
  synchronous rect; rAF double-cancel on unmount).
- **Full frontend unit sweep (touched + whole suite):** 100 files / **1075 tests passed**,
  exit 0. No new failures vs `docs/testing/known-failures.md` (its only entry is an unrelated
  backend ffprobe test).
- **Live-drive** (`bash scripts/dev-verify.sh e2e/T4550-overlay-transform.qa.spec.js`,
  real user `imankh@gmail.com` profile `9fa7378c`): **1 passed, 1 skipped**, exit 0.
  - Framing crop: box placed with finite/positive geometry on first paint; a (-40,-30)px
    drag landed within 6px on both axes (round-trip inverse accurate); **zero rAF / stale-update
    / NaN console warnings**. Evidence: `qa/T4550-crop-overlay-placed.png` (8 handles centered
    over the 1920x1080 video while pixels still loading — placement is metadata-driven),
    `qa/T4550-crop-overlay-dragged.png`.
  - Overlay (highlight + player-detection): **skipped honestly** — this account's first draft
    isn't exported, so Overlay mode is gated (same gate T4880 documents; Modal is off in the
    container so detection wouldn't run anyway). Placement of both is covered by the hook unit
    tests + `OverlayModeView` Vitest suites.

### Acceptance criteria -> evidence

| Criterion | Evidence |
|-----------|----------|
| One transform implementation; three consumers | `useVideoDisplayRect.js`; the 3 overlay commits each delete their local copy and destructure the hook |
| All three overlays have both fixes by construction | Hook ships both; Crop gains leak fix, Highlight gains first-paint, PD gains both (commit diffs) |
| Coordinate math unit-tested incl. letterbox + zoom/pan + fullscreen | 15/15 in `useVideoDisplayRect.test.js` |
| Manual placement-accuracy per overlay | Crop: live drag within 6px + evidence PNGs. Highlight/PD: unit + Vitest coverage; live skipped (unexported draft) — noted, not silently passed |

**Left for supervisor:** push branch; user tests on staging (esp. Overlay-mode highlight +
player-detection placement + fullscreen zoom/pan, which the container couldn't reach live).
