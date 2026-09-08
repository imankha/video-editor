# T9010: Tune auto-crop on the real DJI folder (parameter sweep + ball-in-frame check)

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Problem

The shrink tool's auto-crop (`scripts/shrink-tool/pipeline/autoCrop.js`, automated on
folder load since commit b8601797) is a coarse motion heuristic with hand-picked constants:
per-cell luminance variance over ~8 frames spread across the middle 80% of the segment, on a
24 x 14 grid, keeping every cell above 15% of the max cell's variance, padded 3%, floored at
10% per axis. It was validated only by unit tests on synthetic blobs. Nobody has measured
whether, on the REAL DJI 8K footage, it (a) keeps the whole field plus the players for the
entire segment, (b) drops the sky / tripod / dead field it is supposed to drop, and (c)
never cuts the ball out of frame. Crop is the one lever that reduces output WIDTH (and the
resolution cap is width-driven, design R11), so a rect that is too tight loses play and a
rect that is too loose saves nothing. The T5650 study already proved that a YOLO pass on
the `.LRF` proxy detects the ball in every tested frame - that is the ground truth this
heuristic can be scored against.

## Solution

A parameter sweep of the existing heuristic against the four real DJI segments, scored by
an offline ground truth: ball + player bounding boxes from YOLO on sampled proxy frames.
Output = recommended defaults (grid, threshold, padding, sample count, sample resolution)
committed to `autoCrop.js` with a table of evidence in the README, and a repeatable
`qa/` script so the sweep can be re-run when the heuristic changes (T9050 tweening will
need exactly this harness). The heuristic stays pure and DOM-free; frame sampling stays
in `ui/segmentList.js`.

## Context

### Relevant Files (REQUIRED)
- `scripts/shrink-tool/pipeline/autoCrop.js` - `suggestCropFromFrames(frames, width,
  height, opts)`, `computeCellVariance`; constants `DEFAULT_GRID_COLS = 24`,
  `DEFAULT_GRID_ROWS = 14`, `DEFAULT_THRESHOLD_FRACTION = 0.15`,
  `DEFAULT_PADDING_FRACTION = 0.03`, `MIN_AXIS_FRACTION = 0.1`
- `scripts/shrink-tool/pipeline/autoCrop.test.js` - extend with cases derived from real
  findings (e.g. a bright static sky band must never be kept)
- `scripts/shrink-tool/ui/segmentList.js` - `sampleMotionFrames(file, count = 8)`
  (160 x 90 downscale, middle 80% of the duration, 30 s timeout); the sample COUNT and
  RESOLUTION are sweep axes too
- `scripts/shrink-tool/tool.js` - `autoCropAllSegments` (~L430) and `onSuggestCropClick`
  (~L452); per-segment crop store `cropFor` / `setCropFor` (~L130-140)
- `scripts/shrink-tool/pipeline/checkpoint.js` - `newManifest` carries a per-segment
  `crop` (the manifest is the writer of record once a job starts)
- `scripts/shrink-tool/qa/autocrop-sweep.mjs` - NEW: loads a folder's sampled frames
  (exported once as PNG/raw from the browser, or via the existing `qa/harness.html`),
  runs `suggestCropFromFrames` across a parameter grid, scores each rect against the
  ground truth, prints a table
- `scripts/shrink-tool/qa/autocrop-groundtruth.py` - NEW (optional, Python): YOLO on the
  `.LRF` proxies at N timestamps per segment -> ball + person boxes as JSON. The backend
  venv already has `ultralytics` (`src/backend/app/routers/detection.py`,
  `yolov8x.pt` per `.claude/knowledge/modal-gpu.md`); T5650 §9 ran exactly this at
  ~0.16 s/frame on the 720p proxy
- `scripts/shrink-tool/README.md` - add an "Auto-crop evidence" table
- `docs/plans/research/T5650-dji-8k-ingest-reduction-study.md` §1 (segment
  character: 0003 warm-up/distant, 0005 live game, clouds later), §9 (YOLO ball
  detection worked; `dji-study-assets/autocrop_*_annotated.jpg`)

### Related Tasks
- Depends on: T9000 (the real-folder run records whether the current rects looked
  usable - that observation seeds the sweep; also proves the tool runs on this folder)
- Blocks: T9020 (other sources use the tuned defaults as the baseline), T9050
  (tweening evolves this heuristic; needs this harness), T9040 (size-cap bitrate is
  parked until auto-crop is proven - this task is half of that proof)
- Related: T8840 (tool), T8845 (ports `pipeline/` - keep it DOM-free)

### Technical Notes
- **Ground truth, not eyeballing alone.** For each segment sample ~30 timestamps
  (denser than the heuristic's 8 so the check is independent); YOLO the proxy frame;
  record the ball box (when detected) and the union of person boxes on the field.
  Score a candidate rect by: ball-in-rect rate (must be 100% of detected balls),
  players-in-rect rate, and kept-area fraction (lower is better once the first two are
  satisfied). Per T5650 §9, headcount is NOT a play signal - use it only to bound the
  field, not to judge activity.
- **The sweep axes**: grid (16x9, 24x14, 32x18, 48x27), threshold fraction (0.05 ..
  0.30), padding (0 .. 0.08), sample count (8, 16, 32), sample resolution (160x90,
  320x180). Also try variance of luminance vs variance of a simple edge/gradient
  measure if plain luminance keeps the sky because of cloud drift (the heuristic's
  own comment worries about exactly this).
- **Segments differ**: 0003 is mostly warm-up and distant play; 0005 is live game.
  Report per segment. A single default that is good on both is the goal; if none
  exists, say which way to err (the standing rule: never cut real play - err loose).
- **Keep `pipeline/autoCrop.js` pure.** No DOM, no canvas in the pipeline module; the
  sweep script feeds it raw RGBA buffers. Anything that needs a `<video>` lives in
  `ui/` or `qa/`.
- Fixture videos are multi-GB and never committed; the sweep script takes a folder
  path. Only the small ground-truth JSON and the evidence table are committed.

## Implementation

### Steps
1. [ ] Export sampled frames for each DJI segment at the sweep's sample counts and
   resolutions (proxy-sourced, same path as `sampleMotionFrames`).
2. [ ] Build the ground truth: YOLO ball + person boxes at ~30 timestamps per segment
   from the `.LRF` proxies; save JSON under `scripts/shrink-tool/qa/fixtures/`.
3. [ ] Write `qa/autocrop-sweep.mjs`; run the grid; print the score table per segment
   and overall.
4. [ ] Pick defaults; update the constants in `autoCrop.js` and add unit tests that
   encode the real findings (e.g. cloud-drift sky band must be dropped).
5. [ ] Re-run the tool on the folder; confirm the suggested rects match the sweep's
   winner visually on all four segments; record the evidence table in the README.
6. [ ] Note in the Progress Log what the static heuristic could NOT do (this is the
   brief for T9050 tweening).

### Progress Log

**2026-09-08**: Filed. Current defaults: grid 24 x 14, threshold 15% of max cell variance,
padding 3%, min axis 10%, 8 samples at 160 x 90 across the middle 80%.

## Acceptance Criteria

- [ ] Ground-truth JSON exists for all four DJI segments (ball + person boxes at ~30
      timestamps each)
- [ ] The sweep script runs from a folder path and prints per-segment scores for every
      parameter combination
- [ ] Chosen defaults keep 100% of detected ball positions in-rect on every segment and
      drop the sky/tripod region; kept-area fraction is recorded per segment
- [ ] Constants updated in `autoCrop.js` with tests encoding the real findings;
      `pipeline/` remains DOM-free (grep-confirmed)
- [ ] README "Auto-crop evidence" table filled; the static heuristic's limits written
      down as T9050's brief
