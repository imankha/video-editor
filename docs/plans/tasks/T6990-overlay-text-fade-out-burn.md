# T6990: Overlay text fades out in the burned video instead of vanishing on its end frame

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-08-13
**Updated:** 2026-08-13

## Problem

User request (staging testing, 2026-08-13): "text should quickly fade out in the burned
video instead of just disappear." A text region currently renders at full alpha for its
whole `[start, end]` window and hard-cuts on the end frame in the exported video.

## Solution

Add a short fade-OUT envelope to the end of every text region's window in BOTH burn
loops and the editor preview, driven by ONE shared constant so preview == export:

1. **Constant:** `TEXT_FADE_OUT_SEC = 0.25` (tune by eye on a real export) — define
   once on the backend (near the text-layer blend code) and mirror to the frontend the
   same way other shared overlay constants travel (check how snapping/motion constants
   are shared; if no mechanism exists for this corner, define in
   `src/backend/app/routers/export/overlay.py` + `src/frontend/src/constants/` with a
   parity comment both ways).
2. **Burn loops (BOTH, verbatim-parity pair):**
   - Local: `src/backend/app/routers/export/overlay.py` `_blend_text_layers` (~1148) —
     per frame at time `t` within a layer's window, multiply the rasterized RGBA layer's
     alpha channel by `min(1, (end - t) / TEXT_FADE_OUT_SEC)` before compositing.
   - Modal: `src/backend/app/modal_functions/video_processing.py` (~189/228) — the
     duplicated blend loop gets the IDENTICAL change (these two are parity-tested;
     update the parity test's expectations, and REDEPLOY Modal — ask the user before
     `modal deploy`, per backend CLAUDE.md).
   - Clamp: a region shorter than the fade uses `(end - t) / min(fade, end - start)` so
     a 0.3s region still reaches full alpha at its start... simpler rule: factor =
     `min(1, (end - t) / fade)` only — a very short region then never hits alpha 1;
     decide with a quick visual check and document the choice in the code.
3. **Editor preview parity:** `TextOverlayPreview.jsx` (and any playhead-scrubbed canvas
   render of text) applies the same opacity ramp from the shared constant, so what the
   user scrubs matches the export.
4. **Fade-IN:** explicitly out of scope unless the user asks — the request was fade-out
   only. Leave a one-line note where the envelope is computed.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/export/overlay.py` — `_decode_text_layers`/
  `_blend_text_layers`/`_rasterize_text_layers` (~1110-1160, 2520)
- `src/backend/app/modal_functions/video_processing.py` — duplicated blend loop
  (~189-228) + its parity test (grep `parity` in backend tests for text layers)
- `src/frontend/src/modes/overlay/overlays/TextOverlayPreview.jsx`
- Knowledge: `.claude/knowledge/export-pipeline.md` §Overlay text (update at Stage 7)

### Classification guidance
M-tier, Backend (both render loops) + Frontend (preview) + Modal redeploy. Tester:
extend the existing text-burn tests with an alpha-over-time assertion (sample a frame
inside the fade window vs one mid-region — mirrors T5240's luma-over-time technique).

## Acceptance Criteria
- [ ] Exported video (local AND Modal path): text ramps to transparent over the final
      ~0.25s of its region; no hard pop
- [ ] Editor preview shows the same ramp when scrubbing across a region end
- [ ] Both loops' parity test green with the new envelope; Modal redeployed with user OK
- [ ] Alpha-over-time regression test green; relevant sets green
