# T10200: Fix Focus-mode infinite-loop crash (P0, live on staging)

**Status:** STAGING
**Impact:** 10
**Complexity:** 2
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

Live P0 flagged 2026-09-15 (found by a different session testing T10160's Modal deploy, recorded
on T9950's PLAN.md row): opening ANY draft into Focus mode on staging crashed to a blank white
screen with a real React error — "Maximum update depth exceeded" (minified error #185, an
infinite render loop). Confirmed via console capture on a real Playwright run against
`reel-ballers-staging.pages.dev`, reproduced repeatedly, not a fluke.

**Root cause confirmed** (not the earlier hypothesis): T9950 Slice 3 ("output-aspect moving
preview", commit `2cbe0b0ff`) added an unconditional call in `FocusModeView.jsx` —

```js
const { rect: previewRect } = useVideoDisplayRect(videoRef, metadata, {
  zoom: 1,
  panOffset: { x: 0, y: 0 },   // <- fresh object literal, every render
  isFullscreen,
});
```

`useVideoDisplayRect`'s layout effect (`src/frontend/src/hooks/useVideoDisplayRect.js:165`)
depends on `panOffset` **by reference**. The hook's own test file documents this exact contract
(`useVideoDisplayRect.test.js:216-217`: "a fresh object each render would re-trigger forever").
Every other call site (`CropOverlay`, `PlayerDetectionOverlay`, `HighlightOverlay`,
`TextOverlayPreview`) passes a stable variable; this new call passed a literal created fresh in
the render body. Each render → new `panOffset` reference → effect deps changed → effect re-runs →
`setRect(...)` → re-render → new `panOffset` literal again → infinite loop, hitting React's
nested-update guard within the first commit.

This call is **unconditional** (not gated on the `previewing` toggle — comment at
`FocusModeView.jsx:334` says "Always called (rules of hooks)"), which is why it broke *every*
draft opened into Focus mode, not just the new preview feature.

**Why tests/review didn't catch it:** every existing `FocusModeView` test mounts with
`videoRef: { current: null }`, which makes the effect bail out at its first line
(`if (!videoRef?.current || !videoMetadata) return;`) before the loop can manifest. The
`useVideoDisplayRect` hook's own tests only exercise the *correct* (stable-reference) usage.
Nothing exercised a real `videoRef` + `FocusModeView` together.

Confirmed **not** caused by T10150 (reproduces on a page load from before that merge's frontend
changes were live) — that hypothesis in the original P0 flag was wrong; T9950 Slice 3 was the
actual cause.

## Solution

Hoist the pan-offset literal to a stable module-level constant (`PREVIEW_ZERO_PAN`) in
`FocusModeView.jsx` so its reference never changes across renders, restoring
`useVideoDisplayRect`'s documented stable-reference contract. No behavior change — `{x:0,y:0}`
was always the intended value; only its identity was wrong.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/FocusModeView.jsx` — the fix (module-level `PREVIEW_ZERO_PAN` constant,
  used in place of the inline literal at the `useVideoDisplayRect` call)
- `src/frontend/src/hooks/useVideoDisplayRect.js` — unchanged; its documented contract (stable
  `panOffset` reference) is what the fix restores compliance with
- `src/frontend/src/modes/FocusModeView.outputPreview.test.jsx` — new regression test (real
  `videoRef`/container, not `{ current: null }`, so the loop can actually reproduce)

### Related Tasks
- T9950 (`tasks/evaluation-2026-09-13/T9950.md`) — introduced the bug in Slice 3 (PR #451, merged,
  STAGING). This fix does not touch any of T9950's other slices.
- T10150 — investigated and ruled out as the cause during this session's root-cause pass.

### Technical Notes
S-tier: 1 production file, ~5 line diff (a constant + swapping the literal for it), no schema/API
change. Frontend-only.

## Implementation

### Steps
1. [x] Root-cause via `git show` on T9950's three slice commits + reading `useVideoDisplayRect.js`
   and its test file's documented contract.
2. [x] Fix: module-level `PREVIEW_ZERO_PAN` constant in `FocusModeView.jsx`.
3. [x] Regression test added (`FocusModeView.outputPreview.test.jsx`), red-confirmed against the
   pre-fix code (`git stash` the fix, run test → reproduces "Maximum update depth exceeded" at
   `useVideoDisplayRect.js:121`), green-confirmed after restoring the fix.
4. [x] Curated relevant-set run green: `FocusModeView.outputPreview.test.jsx`,
   `FocusModeView.framingActionRow.test.jsx`, `FocusModeView.advancedEditing.test.jsx`,
   `useVideoDisplayRect.test.js`, `CropOverlay.test.jsx`, `CropOverlay.straighten.test.jsx`,
   `outputPreviewTransform.test.js`, `widenFraming.test.js`, `useFramingHistory.test.js` —
   68/68 pass.

### Progress Log

**2026-09-17**: Root-caused and fixed directly in the shared checkout (S-tier, no container).
Red/green independently proven (see Steps above). Committed directly per the S-tier precedent
(T10100) given the live P0 severity — this is the single most time-critical item blocking
verification of other staging work.

## Acceptance Criteria

- [x] Root cause identified with file:line citations, confirmed by reproducing the crash in a test
- [x] Fix applied (stable `panOffset` reference)
- [x] Regression test added and red/green independently verified
- [x] Curated relevant-set tests green (68/68)
- [ ] Branch CI green (pending push)
- [ ] Live-browser re-verification on staging once deployed (unblocks T9950/T10150's own pending
      live-browser QA, T9720's release gate)
