# T9230: Render the fire in all three paths (preview, backend, Modal)

**Status:** TODO
**Impact:** 6
**Complexity:** 7
**Created:** 2026-09-08
**Updated:** 2026-09-08

Epic 3/6 of [On Fire](EPIC.md). See EPIC.md for the render technique decision (B1 sprite sheets) and the motion source (A1 spotlight spline).

## Problem

The placement spec (T9210) and the per-region level (T9220) exist but nothing draws. The fire has to appear in the Overlay preview and in both export paths, pixel-equivalent, without blowing the `render_overlay` 600 s Modal cap.

## Solution

Per frame, for every enabled region with `heat != off` that is active at `t`:

1. Interpolate the ellipse as today, compute `velocity` (T9210 helper) and the reveal factor (T5250), call `heat_placements(...)`.
2. Composite each placement: bilinear-resize the sprite frame to `scale * 256`, rotate by `rotation_deg` about its center, position at `(cx, cy)`, blend with `screen` or `normal` alpha. The fire ring placement REPLACES the spotlight stroke when level is `fire`; the dim vignette and fill are unchanged.
3. Stacking: dim layer, fill, fire trail, plume, ring, embers/smoke, then text layers (T5225) on top.

Per path:

- **Preview** (`HighlightOverlay.jsx`): a new `<g data-testid="heat-layer">` inside the existing SVG renders one `<image href="/heat/{sprite}/{frame}.png">` per placement with `transform="translate rotate scale"` and `style="mix-blend-mode: screen"`. Sprites preloaded once per mount. Display-only: the drag/resize commit reads the raw ellipse, never the placements.
- **Backend local** (`overlay._process_frames_to_ffmpeg` + `KeyframeInterpolator.render_highlight_on_frame`): sprites decoded once per export with `cv2.imdecode(IMREAD_UNCHANGED)`, cached per `(sprite, frame, scale, rotation)` bucket, blended with numpy. Shared helper `services/heat_composite.py::blend_placement(frame, sprite_rgba, placement)`.
- **Modal** (`video_processing._render_highlight`): sprite bytes shipped per call (`call_modal_overlay(heat_sprites=...)`, the T5225 `text_layers` pattern), decoded once before the frame loop, inline copy of `blend_placement`. Modal redeploy required (staging then prod, user-gated).

Parity: extend `tests/test_heat_placements.py` with a frame-level test that renders one synthetic frame through the backend helper and the Modal inline copy and asserts max pixel delta <= 2. A Playwright QA spec screenshots the preview at a fixed `t` and compares against the backend render of the same frame with a tolerance (same approach as the T5250 QA spec).

## Context

### Relevant Files
- `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx`, `src/frontend/src/modes/OverlayModeView.jsx`
- `src/backend/app/routers/export/overlay.py` (`_process_frames_to_ffmpeg`, sprite loading, `call_modal_overlay` args)
- `src/backend/app/ai_upscaler/keyframe_interpolator.py` (`render_highlight_on_frame`)
- `src/backend/app/services/heat_composite.py` (new)
- `src/backend/app/modal_client.py` (`call_modal_overlay` payload)
- `src/backend/app/modal_functions/video_processing.py` (`render_overlay`, `_render_highlight`, inline blend)
- `src/backend/tests/test_heat_placements.py`, `e2e/T9230-on-fire-preview-parity.qa.spec.js` (new)

### Related Tasks
- Depends on: T9210, T9220
- Blocks: T9240, T9250
- Sibling render loops `frame_processor.py` and `ai_upscaler/__init__.py` (framing + highlight combined pass) stay no-op, same as T5250 left them.

### Technical Notes
- Screen blend in numpy: `out = 255 - (255 - frame) * (255 - sprite * alpha) / 255` per channel, float32, then clip. Match the browser's `mix-blend-mode: screen` which composites the premultiplied sprite the same way.
- Budget: a 60 s reel at 30 fps with one fire region per clip is ~1800 frames x <= 6 placements x a ~300 px blend, well under a second of numpy per reel. The cache keyed on `(sprite, frame, scale_bucket, rotation_bucket)` keeps the resize/rotate out of the hot loop; bucket scale to 4 px and rotation to 5 degrees.
- Rotation about the sprite center with `cv2.warpAffine` on RGBA, border transparent. In SVG use `rotate(deg cx cy)` on the same center so the two agree.
- Text layers (T5225) hard-require full-frame dims; do NOT reuse that path for sprites, it would mean one full-frame PNG per frame.

## Acceptance Criteria

- [ ] Fire and heating render in preview, local export, and Modal export for body and ground shapes
- [ ] Trail direction follows the spline velocity and flips correctly when the player reverses
- [ ] Entrance/exit faded by the reveal envelope, no pop at region bounds
- [ ] Frame-level parity test green; preview-vs-export QA spec within tolerance
- [ ] Render time increase per reel measured and recorded in the task file; under the 600 s cap with margin
- [ ] Modal deploy verified on staging, then prod (user gate)
