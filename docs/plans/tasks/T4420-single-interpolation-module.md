# T4420: One Crop-Interpolation Module (Kill the 4 Catmull-Rom Copies)

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-03
**Source:** Audit item E4 ([audit doc](../audit-2026-07-03-code-quality.md)) · Depends on T4370 (interpolation parity fixtures)

## Problem

The Catmull-Rom crop-interpolation math — the code that decides WHAT RENDERS — exists in 4 backend copies: `app/interpolation.py:10-90` (canonical), `ai_upscaler/keyframe_interpolator.py`, `modal_functions/video_processing.py:586-1156` (`_catmull_rom`, `_find_spline_indices`, `_spline_prop`, `_interpolate_crop`), `modal_functions/video_processing_optimized.py:206-280`. A fix in one copy makes local and Modal exports **crop differently** — a divergence users see as "export looks different than preview" with no attributable cause.

Adjacent dead weight: `video_processing_optimized.py` is a ~1,200-line benchmark harness (8 near-identical `@app.function` variants at :376-935) and `process_framing_ai_l4` (:1634) is a ~200-line admitted copy of `process_framing_ai` ("Identical ... but uses L4 GPU").

## Solution

1. Package `app/interpolation.py` into the Modal image so `modal_functions/*` import it (Modal images build from the repo — verify how `app/` modules get into the image; check the `modal deploy` config/Dockerfile in `video_processing.py`'s image definition).
2. Delete the three copies; Modal + upscaler call the canonical module.
3. Parameterize GPU type on `process_framing_ai` (one function, `gpu=` argument) and delete `process_framing_ai_l4`; delete or quarantine `video_processing_optimized.py` (grep for callers first — audit says benchmark-only).

## Context

- **Parity test is the whole game:** unit test feeding identical keyframes + frame indices to (a) the canonical module imported the way Modal will import it and (b) golden outputs captured from the CURRENT Modal copy BEFORE deletion — document any divergence found (a divergence means prod Modal exports already render differently than local; that's a finding to surface, not silently unify).
- Modal redeploy required (backend CLAUDE.md: ask the user before `modal deploy`). Deploy + a real Modal export on staging is part of acceptance.
- T4250 (frontend spline) is the sibling; note in the PR whether frontend/backend interpolation agree on the same fixtures (they should — divergence is a filed follow-up).

## Steps

1. [ ] Capture current-behavior fixtures from ALL four copies (same inputs → outputs table in the Progress Log). Surface any existing divergence before changing code.
2. [ ] Modal image packaging of app/interpolation.py; parity test green.
3. [ ] Delete copies; L4 parameterization; benchmark file removal (caller grep recorded).
4. [ ] Ask user → Modal redeploy → one real framing export on staging compared against a pre-change export of the same clip.

## Acceptance Criteria

- [ ] `grep -rn "catmull\|_interpolate_crop" src/backend` hits one module (+ its importers)
- [ ] Local and Modal render the same crop rect for identical fixtures (test-proven)
- [ ] One `process_framing_ai` with a GPU parameter; benchmark clones gone
- [ ] Staging Modal export verified post-redeploy
