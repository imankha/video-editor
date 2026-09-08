# T9050: Tweening auto-crop: a keyframed crop path that follows the play

**Status:** TODO
**Impact:** 7
**Complexity:** 7
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Problem

Auto-crop produces ONE static rect per segment. Over a 24-minute segment play moves
end to end, so a static rect that keeps every play must be nearly the full field width,
and the resolution cap is width-driven (design R11: a vertical-only crop produced
byte-identical player detail to no crop). The real win - fewer output pixels at the same
player detail - needs a rect that MOVES with play: smaller, re-centred as the action
shifts, smoothed so it never jitters. T5650 §9 already showed the signal exists (ball
detected in every tested frame on the proxy) and named the missing piece: a smoother
(Kalman / 1-euro) for a non-jittery virtual camera path. This is the "follow the play"
upgrade to the heuristic T9010 tunes.

## Solution

Evolve the crop from `{x, y, w, h}` to a **crop path**: a list of keyframes
`[{tSec, x, y}]` with a CONSTANT size (w, h) per segment, interpolated and smoothed at
every frame's timestamp inside the crop/scale stage. Constant size is deliberate: the
encoder is configured once per segment with fixed output dimensions, and a moving
constant-size window scaled to that output is a pan, not a zoom - the simplest thing
that gets the width down. Keyframes come from the existing variance heuristic run per
time window instead of once per segment; smoothing bounds velocity/acceleration so the
camera never snaps. Everything in `pipeline/` stays DOM-free so T8845 can port it
mechanically; the UI shows the rect at the previewed time and offers "Follow the play"
vs "Fixed".

## Context

### Relevant Files (REQUIRED)
- `scripts/shrink-tool/pipeline/cropScale.js` - `resolveCropRect(crop, w, h)` (pure)
  and `createCropScaler({sourceWidth, sourceHeight, crop, outWidth, outHeight})`, whose
  `transform(frame)` currently uses ONE resolved `{sx, sy, sw, sh}` for every frame.
  Change: resolve per frame from `frame.timestamp` (microseconds) when `crop` is a path.
  Keep the single-owner frame rule (close input frame before returning the new one).
- `scripts/shrink-tool/pipeline/shrinkSegment.js` - ~L134 resolves the crop once and
  passes it to the scaler; output dimensions derive from the crop's SIZE (unchanged for
  a constant-size path); `StageError('crop', ...)` at ~L229
- `scripts/shrink-tool/pipeline/autoCrop.js` - `suggestCropFromFrames` stays; ADD
  `suggestCropPath(windows, width, height, opts)` where `windows` is
  `[{tSec, frames: RGBA[]}]` -> per-window bbox -> constant size = max window size (or
  a chosen percentile) -> centres -> smoothed keyframes. Pure math.
- `scripts/shrink-tool/pipeline/cropPath.js` - NEW: `evaluateCropPath(path, tSec)`
  (interpolation: Catmull-Rom or linear + 1-euro / EMA smoothing; clamp to frame),
  `smoothCropPath(path, {maxVelocity, maxAccel})`, `isCropPath(x)`. Unit-tested with a
  synthetic moving blob: bounded velocity, no overshoot outside the frame, exact hold
  when the blob is still.
- `scripts/shrink-tool/pipeline/checkpoint.js` - `newManifest` stores per-segment
  `crop`; a path must round-trip through the manifest (writer of record) unchanged;
  resume must replay the identical path
- `scripts/shrink-tool/ui/segmentList.js` - `sampleMotionFrames(file, count)`: add
  windowed sampling (e.g. 8 frames per 60 s window) - DOM code stays here
- `scripts/shrink-tool/ui/cropRect.js` - render the path's rect at the previewed
  timestamp; scrub to see it move; drag edits become an offset applied to the whole
  path (v1), not per-keyframe editing
- `scripts/shrink-tool/tool.js` - `autoCropAllSegments`, `cropFor` / `setCropFor`,
  the M6 output-dimension derivation (uses path SIZE), "Follow the play" toggle
- `scripts/shrink-tool/qa/autocrop-sweep.mjs` - T9010's harness; extend scoring to a
  path: ball-in-rect rate per sampled timestamp using the path evaluated at that time
- `scripts/shrink-tool/README.md` - results row(s)
- `docs/plans/research/T5650-dji-8k-ingest-reduction-study.md` §9 (ball detection +
  the smoother requirement)
- `src/backend/app/services/video_processing.py` `_interpolate_crop` (~L1117,
  Catmull-Rom) - the app's existing crop-path interpolation for framing keyframes;
  match its interpolation semantics so a future "use the pre-shrink path as a Focus
  hint" is not a translation problem. Read-only.

### Related Tasks
- Depends on: T9010 (tuned static heuristic + ground-truth harness), T9020 (which
  sources are in scope - panning cameras likely stay static/full-frame)
- Blocks: nothing in this epic; informs T8845 (port includes `cropPath.js`) and T8850
  (crop step UI shows a moving rect)
- Related: T9040 (a path's constant size feeds `decideShrink`'s output pixels), the
  Focus (framing) keyframe system in `.claude/knowledge/keyframes-framing.md` - do NOT
  reuse its stores; only its interpolation shape

### Technical Notes
- **Why constant size**: WebCodecs `VideoEncoder` is configured with fixed
  `width/height`; the scaler always draws into that canvas, so the source window can
  move freely but changing its SIZE mid-segment would zoom the output. A zooming path
  is a later task if the numbers justify it; a pan already recovers the width.
- **Smoothing target**: no visible jitter at 1x playback and no snap on a counter
  attack. Start with a 1-euro filter on the centre (parameters swept against the
  ground truth) or EMA over keyframes at 1-2 s spacing; assert
  `|dx/dt| <= maxVelocity` (fraction of frame per second) in tests.
- **Timestamps**: `frame.timestamp` is microseconds from the decoder; keyframes are in
  seconds; convert in ONE place (`evaluateCropPath`). Segments are cut on keyframes
  every 2 s in the output (T8845 note) - irrelevant to the path but do not confuse the
  two "keyframe" meanings in code names (`cropKeyframes` vs encoder key frames).
- **Never lose play**: the path must keep 100% of detected ball positions in-rect
  (same bar as T9010); if the smoother would lag the ball out of frame, widen the
  constant size rather than speed up the pan.
- **Manifest compatibility**: a plain rect must remain valid (`isCropPath` false ->
  today's behaviour, byte-identical output). Add a manifest `version` bump only if the
  shape change requires it; resume from an old manifest must not throw.
- **Cost**: per-frame `drawImage` with a moving source rect is free relative to the
  encoder (encode-bound); `evaluateCropPath` must be O(log n) or O(1) with a cursor -
  no per-frame array scans over thousands of keyframes.
- DOM-free means: no `document`, `<video>`, `URL.createObjectURL` in `pipeline/`. The
  smoke test (`qa/t8840-smoke.mjs`) must still pass with a path supplied.

## Implementation

### Steps
1. [ ] `pipeline/cropPath.js` with tests (synthetic moving blob; still blob; edge
   clamping; old plain-rect passthrough).
2. [ ] `autoCrop.suggestCropPath` from windowed samples; `ui/segmentList.js` windowed
   sampling; harness scoring for paths.
3. [ ] `cropScale.createCropScaler` evaluates the path per frame; `shrinkSegment`
   passes the path through; manifest round-trip + resume test.
4. [ ] UI: rect rendered at previewed time, scrub, "Follow the play" / "Fixed" toggle,
   drag = whole-path offset.
5. [ ] Run on the four DJI segments: record kept-area vs T9010's static rect, output
   pixels/bytes/time delta, ball-in-rect rate, and a playback check for jitter (user
   judges at 1x). README row + Progress Log.
6. [ ] Update this epic's EPIC.md with the verdict: is the pan worth its complexity for
   T8845/T8850 to carry?

### Progress Log

**2026-09-08**: Filed. Brief comes from T9010's recorded limits of the static heuristic.

## Acceptance Criteria

- [ ] `cropPath.js` + `suggestCropPath` are pure/DOM-free and unit-tested (velocity
      bound, clamp, still-hold, plain-rect passthrough)
- [ ] On the real DJI segments the path keeps 100% of detected ball positions in-rect
      and reduces output width vs the T9010 static rect by a recorded amount
- [ ] No visible jitter at 1x playback (user verdict recorded); no snap on direction
      change
- [ ] Manifest round-trip + resume replay identical paths; old plain-rect manifests
      still resume
- [ ] `qa/t8840-smoke.mjs` green with a path; `pipeline/` DOM-free (grep-confirmed)
- [ ] EPIC.md verdict written for T8845/T8850
