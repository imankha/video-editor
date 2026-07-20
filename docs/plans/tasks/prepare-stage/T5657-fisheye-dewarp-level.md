# T5657: Fisheye de-warp + horizon level

**Status:** TODO
**Impact:** 5
**Complexity:** 6
**Created:** 2026-07-20
**Epic:** [Multi-File Ingest & Prep](EPIC.md) (task 7/7)

## Epic Context
See [EPIC.md](EPIC.md) + study section 3 (the DJI footage has a strongly barrel-curved horizon).
Lens de-warp is a SEPARATE need from arbitrary tilt correction
([T5640](../T5640-framing-rotation-horizon-straighten.md)) - de-warp is a known-lens correction,
tilt is a small arbitrary rotation. They compose in the same filter stage.

## Problem
Ultra-wide action-cam footage (DJI Action) is heavily fisheye-distorted (curved horizon, bowed
lines). Cropping a region of it inherits the warp. Straight lines should be straight.

## Solution
- Apply a **lens de-warp** in the render/conform filter chain: OpenCV `cv2.fisheye` undistort with a
  DJI lens profile, or ffmpeg `lenscorrection` / `v360`. Known camera -> fixed profile; unknown
  cameras -> skip or manual.
- Order in the filter stage: de-warp -> (T5640 tilt rotate) -> crop. Coordinate space must stay
  consistent between the Framing preview and the master conform.

## Context
### Relevant Files
- `.claude/knowledge/keyframes-framing.md` + `modal-gpu.md`.
- `src/backend/app/services/export/framing.py`, `multi_clip.py`, Modal path (filter chain).
- Shares the filter-order + coordinate-space design with T5640 and T5655.

### Related Tasks
- Depends on T5655 (conform filter chain). Composes with T5640 (rotation) - same filter stage.

### Technical Notes
- De-warp changes pixel mapping; crop coords must be defined in de-warped space (or the transform
  applied consistently on both preview and output). Design-gate the coordinate space WITH T5640/T5655.

## Acceptance Criteria
- [ ] DJI footage exports with straight lines / level horizon (de-warp applied).
- [ ] Crop coords resolve consistently on proxy preview and master output.
- [ ] Composes with T5640 rotation in one filter stage.
