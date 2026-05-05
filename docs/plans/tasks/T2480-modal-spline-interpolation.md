# T2480: Modal Spline Interpolation

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-05-05
**Updated:** 2026-05-05

## Problem

The standalone `_interpolate_crop` functions in Modal cloud functions still use linear interpolation, while `keyframe_interpolator.py` and the frontend both use Catmull-Rom cubic spline. This means framing crop animations rendered by Modal have subtly different motion curves than what the user sees in the editor preview.

The mismatch was discovered while fixing an overlay positioning bug where the backend's linear interpolation caused visible offset from the editor's spline-based preview.

## Solution

Inline the Catmull-Rom spline helpers (`_catmull_rom`, `_find_spline_indices`, `_spline_prop`) directly into each Modal file and update their `_interpolate_crop` to use spline interpolation.

Modal functions can't import from the `app` package (they run standalone in the cloud), so the helpers must be copied, not imported.

## Context

### Relevant Files
- `src/backend/app/modal_functions/video_processing.py` — `_interpolate_crop` at line ~1032
- `src/backend/app/modal_functions/video_processing_optimized.py` — `_interpolate_crop` at line ~206
- `src/backend/app/ai_upscaler/keyframe_interpolator.py` — reference implementation (already uses spline)

### Related Tasks
- Follow-up from overlay spline fix (commit TBD)

### Technical Notes
- The spline helpers are ~30 lines total — small inline footprint
- With only 2 crop keyframes (common case), spline and linear produce identical results. The difference only shows with 3+ keyframes where the path curves.
- Requires Modal redeploy after changes

## Implementation

### Steps
1. [ ] Copy `_catmull_rom`, `_find_spline_indices`, `_spline_prop` into `video_processing.py`
2. [ ] Update `_interpolate_crop` in `video_processing.py` to use spline
3. [ ] Copy same helpers into `video_processing_optimized.py`
4. [ ] Update `_interpolate_crop` in `video_processing_optimized.py` to use spline
5. [ ] Redeploy Modal functions

## Acceptance Criteria

- [ ] Both Modal `_interpolate_crop` functions use Catmull-Rom spline
- [ ] Framing crop animation in exported video matches editor preview
- [ ] Modal functions deploy successfully
