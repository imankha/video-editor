# T4420: Spotlight circle follows the curved crop

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

Between the crop points a parent sets in Frame, the final video moves the crop along a smooth curve. The code that places the Spotlight circle and picks the cover frame works the same crop out as straight lines. With three or more crop points the circle can sit slightly off the athlete; this is reasoned from the code and not yet reproduced. Use the curve in both places and add a test proving every copy of the curve maths gives the same numbers. Runs after T11260, which deletes part of this code.

## Implementer details

- `src/backend/app/services/highlight_transform.py` `interpolate_crop_at_frame` documents 'Uses linear interpolation'; it feeds `highlight_carry.py`, `poster.py` and `routers/export/overlay.py`. Every renderer uses Catmull-Rom.
- Reproduce first: a clip with three crop keyframes on a curve, compare the mapped circle position at a mid frame against the rendered crop. If the difference is under a pixel at real sizes, close this task with the measurement.
- After T4410 and T16500 delete the dead copies, two live copies of the spline remain (the local upscaler's `keyframe_interpolator.py` and the inline copy in `modal_functions/video_processing.py`, which is inline by documented policy because the GPU image does not mount `app/`). That is below the rule of three: add one parity fixture test across them, do not build a shared package.
- T11260 removes highlight carry across joined clips; check what is left of `highlight_carry.py` before starting.
- Knowledge docs: `.claude/knowledge/keyframes-framing.md`, `.claude/knowledge/modal-gpu.md`.

## Acceptance Criteria

- [ ] A test with three crop keyframes shows the Spotlight mapping and the renderer use the same crop rectangle at a mid frame.
- [ ] One fixture test feeds the same keyframes to every live copy of the curve maths and gets the same rectangles.
