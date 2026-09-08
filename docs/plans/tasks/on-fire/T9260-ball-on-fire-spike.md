# T9260: Ball on fire: recall spike, then possession + shot trail (evidence-gated)

**Status:** TODO
**Impact:** 4
**Complexity:** 9
**Created:** 2026-09-08
**Updated:** 2026-09-08

Epic 6/6 of [On Fire](EPIC.md). See EPIC.md section C for the four-step ball assessment; this task starts with the measurement and only continues if the number clears the bar.

## Problem

The real NBA Jam visual is the ball burning in the player's hands and streaking on the shot. Nothing in the app detects a ball (`yolov8x.pt` is run person-only), and a soccer ball in a wide Veo shot is 8 to 15 px and often motion-blurred. Building possession logic on a detector that misses half the frames would produce a flame that blinks, which is worse than no flame.

## Solution

### Stage 1: recall spike (do this first, stop if it fails)

1. Script `scripts/measure_ball_recall.py`: for 10 real user WORKING videos (Focus output, 9:16, cropped and upscaled, from dev/staging fixture accounts), run `yolov8x` with `classes=[0, 32]` at imgsz 640 and 1280 on every frame inside each spotlight region, and record ball detections per frame.
2. Hand-label possession windows (athlete has the ball) for those regions in a small JSON fixture.
3. Report: ball recall inside possession windows, false positives per minute, and the median ball size in px, at both image sizes.
4. **Gate: proceed to Stage 2 only if recall inside possession windows >= 80% at a setting that fits the GPU budget.** Otherwise close the task with the numbers recorded and a note on the fallback (fine-tuned YOLOv8n on a public soccer-ball dataset, or a TrackNet-style heatmap model, each a separate research task).

### Stage 2: possession + flames (only after the gate)

1. **Detect + track.** Extend T9250's `track_region_modal` with class 32, return ball boxes separately (`ball_boxes`, never mixed into the person list; `slice_detections` / `hoist_video_detections` and the frontend `sliceDetections` are not touched because the ball track lives in `heat_tracks`, not `detections_data`). Constant-velocity Kalman filter with gap interpolation up to 0.3 s (ball paths are near-parabolic, short gaps are predictable).
2. **Possession.** Held when the ball center is within `0.6 * bboxHeight` of the athlete's feet point (T9250) for >= 3 consecutive frames; released when it leaves that radius; a release with `|v_ball| > v_shot` (tune on the fixture) is a shot.
3. **Placements.** `heat_placements` gains `ball_flame` (engulfs the ball while held, scale from ball radius) and `shot_trail` (streams along `-v_ball` after release until the burst or 1.5 s). Burst on the goal marker per T9240. Three mirrored copies, parity test extended.
4. **Preview.** Same rule as T9250: the preview reads the ball track from `heat_tracks` when present, otherwise shows no ball flame (there is no client-side fallback for a ball position; the spline has no notion of the ball).

## Context

### Relevant Files
- `scripts/measure_ball_recall.py` (new), `docs/plans/research/T9260-ball-recall.md` (new, the measurement record)
- `src/backend/app/modal_functions/video_processing.py` (`track_region_modal` class list, Kalman inline)
- `src/backend/app/services/heat_tracks.py` (possession state machine)
- `src/frontend/src/utils/heatPlacements.js`, `src/backend/app/services/heat_placements.py`, `video_processing._heat_placements`
- `src/backend/tests/test_heat_tracks.py` (possession + shot cases on synthetic tracks)

### Related Tasks
- Depends on: T9250 (dense tracking, `heat_tracks` store)
- Related: T5650 study (`docs/plans/research/T5650-dji-8k-ingest-reduction-study.md:236` is the only prior mention of COCO class 32 in the repo)

### Technical Notes
- The single biggest recall lever is running on the Focus OUTPUT rather than the raw game: after crop + upscale the ball is 30 to 60 px. Measure both anyway so the number is defensible.
- Possession thresholds are per-sport in principle; the audience is 75%+ soccer, so tune for soccer and leave a constant per sport rather than a setting.
- If Stage 1 fails, do NOT ship a "ball flame" that appears only sometimes. A blinking effect reads as a bug.

## Acceptance Criteria

- [ ] Stage 1 report committed with recall, false positives, and ball size at two image sizes on 10 real working videos
- [ ] Gate decision recorded in this file (proceed or close) with the numbers
- [ ] (Stage 2) Ball flame is continuous through a hand-labeled possession window with no gaps over 0.3 s
- [ ] (Stage 2) Shot trail triggers on release and ends at the burst
- [ ] (Stage 2) Parity test green across the three copies; Modal deploy verified on staging, then prod (user gate)
