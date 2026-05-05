# T2480: Modal Spline Interpolation for Crop

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-05-05
**Updated:** 2026-05-05

## Problem

The standalone `_interpolate_crop` functions in Modal cloud functions still use linear interpolation, while `keyframe_interpolator.py` and the frontend both use Catmull-Rom cubic spline. This means framing crop animations rendered by Modal have subtly different motion curves than what the user sees in the editor preview.

## Solution

Inline the Catmull-Rom spline helpers into each Modal file and update their `_interpolate_crop` to use spline interpolation.

Modal functions can't import from the `app` package (they run standalone in the cloud), so the helpers must be copied, not imported.

## Context

### Relevant Files
- `src/backend/app/modal_functions/video_processing.py` — `_interpolate_crop` at line ~1032
- `src/backend/app/modal_functions/video_processing_optimized.py` — `_interpolate_crop` at line ~206
- `src/backend/app/ai_upscaler/keyframe_interpolator.py` — reference implementation (already uses spline)

### Related Tasks
- Follow-up from overlay spline fix (commits 3ef52753, 14f3ad4d)

### Learnings from Overlay Fix

These were discovered while debugging the overlay WYSIWYG mismatch and apply to any future interpolation work:

1. **Modal has its own rendering code.** The overlay render path goes through Modal's `_render_highlight` in `video_processing.py`, NOT `keyframe_interpolator.py` on Fly.io. Any interpolation fix must be applied in the Modal file directly. The Fly.io `overlay.py` local path is only used when `MODAL_ENABLED=false`.

2. **Frame-to-time conversion causes boundary keyframe drops.** Keyframes are stored as frame numbers in the frontend and converted to time for export (`time = frame / fps`). The last keyframe in a region can land slightly past the region's `end_time` (e.g., 2.017s vs 2.000s). All bounds filters must use epsilon tolerance of ~1 frame (`0.04s` at 30fps), not 1ms. This was the actual root cause of the overlay bug — the last keyframe was silently dropped, making the highlight disappear for the final portion of the region.

3. **`interpolation.py` can't import from `ai_upscaler`.** The `ai_upscaler/__init__.py` imports `torch`, which isn't available on Fly.io's slim image. Spline helpers must be inlined or in a separate module.

4. **Diagnostic logging on Modal requires `modal app logs`.** Fly.io logs only show the job completion summary. Use `timeout 5 modal app logs <app-name>` to see frame-by-frame interpolation logs from Modal containers.

5. **Frontend editor vs export use different keyframe sets.** The editor's `getHighlightAtTime` uses all keyframes in a region (no time filtering). The export serialization in `useHighlightRegions.js` filters by `region.endTime + TIME_EPSILON`. The backend rendering filters again. Double-filtering with tight epsilon = dropped keyframes.

### Technical Notes
- The spline helpers are ~30 lines total — small inline footprint. See `_catmull_rom`, `_spline_interpolate_highlight` already inlined in `video_processing.py` as a reference pattern.
- With only 2 crop keyframes (common case), spline and linear produce identical results. The difference only shows with 3+ keyframes where the path curves.
- Requires Modal redeploy after changes: `cd src/backend && .venv/Scripts/python.exe -m modal deploy app/modal_functions/video_processing.py`
- Also check if crop keyframe bounds filters in Modal framing paths need the same epsilon fix

## Implementation

### Steps
1. [ ] Copy `_catmull_rom` and spline index helpers into `video_processing.py` (already has them for overlay — reuse)
2. [ ] Update `_interpolate_crop` in `video_processing.py` to use spline
3. [ ] Copy same helpers into `video_processing_optimized.py`
4. [ ] Update `_interpolate_crop` in `video_processing_optimized.py` to use spline
5. [ ] Audit crop keyframe bounds filters for epsilon tolerance
6. [ ] Redeploy Modal functions

## Acceptance Criteria

- [ ] Both Modal `_interpolate_crop` functions use Catmull-Rom spline
- [ ] Framing crop animation in exported video matches editor preview
- [ ] Modal functions deploy successfully
