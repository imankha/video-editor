# T4250: Spline Interpolator Consolidation — Fixes Highlight Opacity Snapping Between Keyframes

**Status:** DONE
**Impact:** 6
**Complexity:** 2
**Created:** 2026-07-03
**Source:** Code quality audit ([audit-2026-07-03-code-quality.md](../audit-2026-07-03-code-quality.md) item A6)

## Problem

**Exposure: every overlay render AND export with opacity keyframes — reel visual quality is the shareable output (retention + organic growth).**

`utils/splineInterpolation.js` contains three interpolators: `interpolateCropSpline` (:116-154), `interpolateHighlightSpline` (:163-206), and `interpolateGenericSpline` (:217-255) — the generic one was built to replace the first two and is **used by neither**. The two specialized copies are line-identical except for the property list. Classic fix-bugs-twice setup.

**Live bug from the divergence:** highlight keyframes now carry `strokeOpacity`/`fillOpacity` (`useHighlightRegions.js:101, 114-115`), but `interpolateHighlightSpline` still interpolates only the legacy `opacity` field (:203) and returns **no** `strokeOpacity`/`fillOpacity`. The consumer masks it — `HighlightOverlay.jsx:423` does `strokeOpacity={currentHighlight.strokeOpacity ?? 0.85}` — so **between keyframes, user-keyframed opacities silently snap to the defaults**, then jump back at each keyframe. Users who animate opacity get flickering output.

## Solution

1. Extend `interpolateGenericSpline` minimally so it can fully replace both:
   - **Skip missing properties:** if a property is absent on the bracketing keyframes, leave it `undefined` in the result (so consumers' `??` defaults apply) instead of producing `NaN`. Guard per-property, not per-call — old persisted keyframes may have `opacity` but not `strokeOpacity`, new ones the reverse.
   - **Non-interpolated properties from the preceding keyframe:** the highlight version takes `color` from `keyframes[indices.p1Index]` (the keyframe before the current frame), not from a static default. Support this (e.g., a `carryProperties: ['color']` option resolved from the p1 keyframe) — the current `nonInterpolatedDefaults` static object can't express it.
   - **Clamping:** the highlight version clamps opacity to [0,1] (:203). Support per-property clamp or clamp in the consumer — pick one, document it in the JSDoc.
2. Replace both specialized functions with thin wrappers or direct call-site updates:
   - Crop: properties `['x','y','width','height']`
   - Highlight: properties `['x','y','radiusX','radiusY','opacity','strokeOpacity','fillOpacity']`, carry `color`
3. Delete the two specialized implementations (~120 LOC).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/splineInterpolation.js`
- Call sites: `grep -rn "interpolateCropSpline\|interpolateHighlightSpline" src/frontend/src` — update every one
- `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx` — verify the `??` defaults now only apply for keyframes that truly lack the property
- Existing tests: `useCrop.test.js` exercises crop interpolation — must stay green unchanged

### Technical Notes
- **Backend parity warning:** the render pipeline has its own interpolation copies (audit item E4 — `app/interpolation.py` + Modal copies). This task is frontend-only; do NOT touch backend interpolation here. But add a test asserting the frontend's interpolated `strokeOpacity`/`fillOpacity` values match what the exported video should show — if the backend render ignores these fields too, note it in the PR (it becomes evidence for E4).
- Pure functions — this is the safest kind of consolidation. The risk is property-presence edge cases; the tests below are the whole game.

## Implementation

### Steps
1. [ ] Characterization tests FIRST on the two existing functions: golden outputs for representative keyframe sets (2-keyframe, 4-keyframe, boundary frames, single keyframe). These pin current behavior.
2. [ ] New tests for the bug: keyframes with `strokeOpacity` 0.2→1.0 → assert midpoint interpolates (~0.6), not undefined.
3. [ ] Mixed-era test: keyframes with only legacy `opacity` → `strokeOpacity` stays undefined (consumer default applies), no NaN anywhere.
4. [ ] Extend generic fn; switch call sites; delete specialized fns; all tests green.
5. [ ] Visual check (dev app): animate opacity across two keyframes in Overlay; scrub between them — smooth ramp, no snap.

## Acceptance Criteria

- [ ] One spline implementation remains; crop + highlight both use it
- [ ] Keyframed strokeOpacity/fillOpacity interpolate smoothly between keyframes
- [ ] Legacy keyframes (opacity only) render exactly as before
- [ ] Characterization tests prove crop behavior is byte-identical
