# T11350: Enable the GAN-Skip Gate for Near-1:1-Enlargement Crops

**Status:** ICE (deferred, user decision 2026-09-26)
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-25
**Updated:** 2026-09-26

## Problem

`_upscale_crop` (`video_processing.py:1328`) already has a cheap-path gate,
`should_skip_gan(output_width, crop_width)`, built by T10160 specifically to skip the expensive
Real-ESRGAN 4x pass when the requested enlargement is small — but it ships INERT
(`GAN_MIN_ENLARGE = 0.0`, so `(output_width/crop_width) < GAN_MIN_ENLARGE` is never true). Bug
58p's export is the exact case this gate exists for: a 16:9 project with the full, uncropped
1920x1080 source as the crop, target resolution also 1920x1080 (no enlargement needed at all,
`calculate_multi_clip_resolution` correctly computes this) — every frame still pays for a full 4x
GAN enhance to 7680x4320, immediately Lanczos-resized back down to 1920x1080. This is pure waste:
GPU time spent enlarging pixels that get thrown away one line later, and (per the docstring) GAN
cost scales with input pixel count — a full 1080p crop is roughly 28x the input pixels of the
pipeline's benchmarked default 9:16 crop (810x1440 target from a ~205x365 crop).

## Solution

Flip `GAN_MIN_ENLARGE` above 0.0 so near-1:1 crops take the cheap Lanczos+sharpen path instead of
GAN-enhance-then-shrink. **This is explicitly gated in `modal-gpu.md`'s Active/upcoming work and
the T9970 quality benchmark findings**: "keep any conditional 'looks soft' warning DISABLED until
a GAN-inclusive multi-fixture calibration run exists." Do not flip the constant off the back of
this task alone — the calibration run modal-gpu.md calls for (GAN vs Lanczos visual quality across
multiple real fixtures, not just the Lanczos-only `quality_benchmark.py` first pass) is a
prerequisite, not optional prep work.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/ai_upscaler/upscale_gate.py` — canonical `GAN_MIN_ENLARGE` / `should_skip_gan`
- `src/backend/app/modal_functions/video_processing.py:58-74` — byte-for-byte Modal-image copy of
  the same gate (the two copies are asserted to agree by `tests/test_upscale_gate.py` — change
  both together)
- `tests/test_upscale_gate.py` — existing gate tests already cover both non-default-threshold
  behavior and the two-copies-agree invariant; extend, don't replace
- `scripts/quality_benchmark.py` — the existing (currently Lanczos-only / no-CUDA) benchmark
  instrument; this task's calibration needs a GPU-available run, not just this script as-is
- `docs/plans/tasks/evaluation-2026-09-13/T9970-benchmark/` — prior findings this task must read
  before proposing a threshold value

### Related Tasks
- Related: T11320 (once this gate is live, the preflight cost estimate should account for
  cheap-path frames costing far less than GAN-path frames — update the estimate formula rather
  than leaving it pessimistic forever)
- Part of: [modal-export-safety epic](EPIC.md), independent of T11330/T11340

### Technical Notes
- This directly reduces the cost of Bug 58p's specific failure shape (full-frame/no-crop exports)
  without needing T11340's parallelization — the two are complementary, not redundant: T11350
  makes the degenerate case cheap, T11340 makes genuinely large legitimate exports feasible.
- Threshold choice is a quality/cost tradeoff, not a pure engineering call — needs the calibration
  run's findings presented for a design decision before shipping a non-zero default.

## Implementation

### Steps
1. [ ] Run the GAN-inclusive multi-fixture calibration modal-gpu.md calls for (GPU-available
       environment, not a /dotask container — Modal is off there per T4180)
2. [ ] Propose a `GAN_MIN_ENLARGE` threshold from the calibration results, present tradeoff to user
3. [ ] Update both copies of the gate (`upscale_gate.py` + `video_processing.py`) together
4. [ ] Extend `test_upscale_gate.py` for the new default
5. [ ] Staging deploy + verify, then prod (per backend CLAUDE.md Modal deploy rules)
6. [ ] Update `modal-gpu.md` (remove the "inert by default" language once it's not)

### Progress Log

**2026-09-25**: Filed from Bug 58p investigation. Not started. User flagged this epic as top
priority (2026-09-25).

**2026-09-26 (deferred)**: No work started beyond confirming Modal staging connectivity from the
supervisor session (`modal.Function.from_name('reel-ballers-video-v2-staging', 'process_clips_ai')`
resolves — credentials and reachability are fine whenever this is picked back up). User reasoning:
T11320 (merged) already prevents the actual failure mode (Bug 58p's silent hour-long timeout) —
a near-1:1-crop export now gets a fast, informative rejection instead. This task would only let
some of those rejected exports succeed more cheaply (skip the wasted GAN pass) rather than fixing
a bug. Given the real cost of doing it right (a GAN-inclusive multi-fixture calibration run, a
threshold decision, a staged prod deploy) against current top priorities (single-clip-editor,
highlight-first), not worth pursuing now. Unlike T11340, this task is NOT rendered moot by
multi-clip removal — near-1:1 crops happen on single clips too (e.g. an uncropped raw upload) —
so it stays a valid, revisit-able backlog item, not obsolete. **Revisit if false-rejections on
legitimately large single-clip exports turn out to be common in practice.**

## Acceptance Criteria

- [ ] Calibration run completed and its findings recorded (not skipped in favor of guessing a
      threshold)
- [ ] Bug 58p's clip shape (full-frame 16:9 crop) takes the cheap path and completes well inside
      the Modal timeout on a single GPU, with no visible quality regression per the calibration
- [ ] `test_upscale_gate.py` covers the new non-zero default
- [ ] Both gate copies still verified in sync by the existing test
