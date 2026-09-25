# T11320: Preflight Export-Size Guard for Modal Multi-Clip Exports

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-09-25
**Updated:** 2026-09-25

## Problem

Nothing stops a user from dispatching a multi-clip Modal export whose GPU work cannot finish
inside `process_clips_ai`'s hard `timeout=3600`. Bug 58p: a user exported 14 clips (~79s of
1920x1080 source, no crop reduction) 4 separate times, each attempt running the full 60:00 before
Modal cancelled it with `TIMEOUT` — confirmed via `FunctionCall.from_id(call_id).get_call_graph()`
on all 4 `modal_call_id`s. The user got zero feedback beyond an hour of silence per attempt; credit
was auto-refunded each time (`credit_transactions` shows matched `framing_usage`/`framing_refund`
pairs), so this is purely a wasted-time/trust problem, not a billing one.

## Solution

Before dispatching to `call_modal_clips_ai` (multi-clip) — and while we're touching the estimate,
`call_modal_framing_ai` (single-clip) too, since the same GAN-cost-scales-with-crop-input-pixels
math applies there — compute an estimated GPU-seconds figure and reject the export up front if it
would exceed a safe fraction (e.g. 80%) of the Modal timeout budget, instead of dispatching and
letting the user find out an hour later.

Estimate = `sum over clips of (frame_count * per_frame_cost(crop_input_width, crop_input_height))`.
`per_frame_cost` should be derived from the documented T4 benchmark anchor in
[modal-gpu.md](../../../../.claude/knowledge/modal-gpu.md) (`~681ms/frame` at the pipeline's
benchmarked default crop size) scaled by input pixel count, since `_upscale_crop`'s docstring
(`video_processing.py:1328`) states GAN cost scales with the crop's INPUT pixel count, not output.
Prefer a conservative estimate (round up) — a false rejection just tells the user to crop in or
split the batch (T11330), a false acceptance repeats Bug 58p.

**Do not attempt to build an exact cost model from scratch.** If a precise per-pixel constant
isn't already measured, treat this task's first step as calibration: instrument a few real Modal
exports (staging) across a couple of crop sizes to fit the constant, rather than guessing one.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/modal_client.py` — `call_modal_clips_ai` (`:925`), `call_modal_framing_ai` (`:632`); the guard belongs at/before dispatch here, or in the router just above
- `src/backend/app/routers/export/multi_clip.py` — `_export_clips` (`:1479` per modal-gpu.md), `calculate_multi_clip_resolution` (`:999`) already computes target resolution per clip, a natural place to also compute the cost estimate
- `src/backend/app/routers/export/framing.py` — single-clip `/render` entry point, if extending the guard there too
- `.claude/knowledge/modal-gpu.md` — GPU/timeout/benchmark background, update after this ships

### Related Tasks
- Blocks: T11330 (popup needs a structured rejection reason from this guard)
- See also: T11340 (raises the real ceiling this guard estimates against), T11350 (changes the
  per-frame cost model once the GAN-skip gate is enabled — this task's estimate should be written
  so flipping `GAN_MIN_ENLARGE` later doesn't require re-deriving the formula from scratch)

### Technical Notes
- `process_clips_ai` timeout is 3600s, single T4, no chunking (confirmed at `video_processing.py:2782-2789`).
- Per-clip crop input dims come from `working_clips.crop_data`/keyframes, already loaded by the
  export request path — no new data source needed.
- Reject with a structured error (not just a 4xx string) so T11330's popup can render specific
  guidance rather than parsing free text.

## Implementation

### Steps
1. [ ] Derive/calibrate the per-pixel GPU-cost constant (staging Modal runs across 2-3 crop sizes)
2. [ ] Write the pure cost-estimate function (frames x crop pixels x constant), unit-testable without Modal
3. [ ] Wire the guard into the multi-clip export dispatch path, reject over-budget requests with a structured reason (estimated seconds, budget, which clips/levers are the biggest contributors)
4. [ ] Apply the same guard to single-clip framing export
5. [ ] Update `modal-gpu.md` with the constant and where the guard lives

### Progress Log

**2026-09-25**: Filed from Bug 58p investigation. Not started.

## Acceptance Criteria

- [ ] A project shaped like Bug 58p's (14 clips, full 1920x1080 crop, 16:9) is rejected before
      dispatch, not after an hour
- [ ] A normal-sized export (small crop, few clips) is unaffected
- [ ] Rejection response includes enough structured detail for T11330 to render specific guidance
- [ ] Regression test using Bug 58p's actual clip/crop shape as a fixture
