# T11370: Calibrate T11320's Export-Cost-Guard Per-Pixel Constant

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-25
**Updated:** 2026-10-02

## Problem

T11320 (preflight export-size guard) shipped with its per-pixel GPU-cost constant derived from a
SINGLE benchmark measurement (`experiments/e6_l4_benchmark_results.json`: 0.6815 s/frame at a
540x960 crop). The same benchmark script shows 1.57x run-to-run variance on an identical config
across two separate runs (E1: 192.19s, E6: 122.67s, both 540x960/180 frames) — cold start, R2
I/O, and encode are all folded into the "per-frame" wall-clock number, not just GAN compute. The
task's own spec called for a real calibration step (2-3 Modal runs across crop sizes) before
landing if a precise constant wasn't already measured; this was explicitly skipped with the
user's sign-off to land T11320 faster and calibrate after, not as a permanent state.

Risk while this is open: the guard's threshold could be wrong in either direction for crop sizes
far from 540x960 — false rejections (annoying, but safe) or false acceptances (a return to Bug
58p's actual failure mode: an hour of silence then a Modal timeout) for crop sizes the single
measurement doesn't represent well.

## Solution

Run 2-3 real Modal exports on STAGING (Modal is off in /dotask containers, T4180 — this needs a
GPU-available environment, i.e. actually dispatching to Modal staging, not a container) across a
spread of realistic crop sizes (e.g. something near the 9:16 default ~410x730, something near
540x960 to sanity-check against the existing anchor, and something large/near-1:1 like Bug 58p's
full 1920x1080) and measure actual GPU-seconds per frame for each. Fit a per-pixel constant (or
confirm linear-in-pixels scaling actually holds — the current assumption is unverified, not just
uncalibrated) from real data instead of one extrapolated point.

**This needs a user decision on how it gets run** (real Modal/staging cost + GPU time): either
the supervisor drives real staging exports directly (ask before dispatching, per CLAUDE.md Modal
deploy/cost rules), or the user runs the exports and hands back the measurements.

Consider bundling this with T11350's own calibration need (T11350 needs a "GAN-inclusive
multi-fixture calibration run" on a GPU-available environment for a different purpose — Lanczos
vs GAN visual quality, not raw cost-per-pixel) since both need the same kind of environment
access; they measure different things and shouldn't be conflated into one constant, but running
them back-to-back may save setup cost.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/export_cost_guard.py` — `per_frame_cost`, the constant this task
  recalibrates
- `experiments/e6_l4_benchmark.py` / `experiments/e6_l4_benchmark_results.json` — existing
  single-point benchmark this task supersedes/extends
- `.claude/knowledge/modal-gpu.md` — update the cost-anchor section after this ships

### Related Tasks
- Follows: T11320 (this task calibrates T11320's shipped constant; T11320 does not block on this
  landing first)
- See also: T11350 (independent calibration need, same class of environment constraint)

### Technical Notes
- Verify the linear-in-input-pixel-count scaling assumption itself, not just the constant — if
  real data doesn't fit a line well, that's a more important finding than the constant's exact
  value.
- Measure GAN-compute time specifically where possible, separating it from fixed per-job
  overhead (cold start, R2 I/O, encode) that doesn't scale with crop size — the current constant
  conflates these, which likely explains part of the run-to-run variance.

## Implementation

### Steps
1. [x] Get user sign-off on how the staging runs happen (supervisor-driven vs. user-driven) —
   user chose supervisor-driven, real-cost dispatch directly from this session
2. [x] Run 2-3 Modal staging exports across a spread of crop sizes, capture real GPU-seconds —
   3 jobs / 12 measured points (9:16 sizes, 16:9 sizes incl. the max 2560x1440 target and the
   full Bug-58p-shaped 1920x1080 crop, plus a replicate for variance)
3. [x] Fit/verify the per-pixel constant against real data; check the linear-scaling assumption —
   linear-in-crop-pixels CONFIRMED (slope agrees within ~1% across jobs, R²>0.998 each); found
   the formula also needed a target-resolution-dependent overhead term it didn't have at all
4. [x] Update `export_cost_guard.py`'s constant and `modal-gpu.md`'s documentation — done; user
   explicitly chose to thread target resolution through rather than use a conservative single
   intercept, given the real finding
5. [x] Update T11320's "Known accepted risk" progress-log note to reflect the calibrated state

### Progress Log

**2026-09-25**: Filed as a T11320 landing follow-up (user accepted the uncalibrated-constant
risk to land T11320 without blocking on this). Not started.

**2026-10-02**: Dispatched directly by the supervisor (containers can't reach Modal, T4180; user
chose supervisor-driven real staging dispatch over user-driven or deferring). The `expert` agent
found `experiments/e6_l4_benchmark.py` fully stale (old pre-T8270 app name, wrong/non-existent
function, deleted test fixture) and designed a fresh calibration script
(`experiments/t11370_cost_calibration.py`) targeting `process_clips_ai` on
`reel-ballers-video-v2-staging` directly, isolating per-clip GAN-loop rate from fixed overhead via
Modal's own streamed per-frame progress timestamps. Ran 3 real jobs (~$0.55 actual, under the
~$0.55-0.70 estimate): all succeeded cleanly, no silent GPU-upscale fallback (checked live Modal
logs during the run). Found the crop-pixel slope is linear and target-resolution-independent
(confirmed, not assumed) but the fixed per-frame overhead is NOT crop-dependent — it's
TARGET-resolution-dependent, 2.4x higher at the max 16:9 target than the 9:16 default, which the
original formula had no term for at all. Asked the user how to handle this: conservative single
intercept vs. threading target resolution through vs. keeping the old zero-intercept shape; user
chose to thread target resolution through `export_cost_guard.py`/`multi_clip.py` properly rather
than take the conservative shortcut. Implemented, updated all existing tests (new
target-resolution-dependence tests added), ran the relevant set (20 preflight-guard tests + T11330
+ 3 golden export tests, all green), updated `modal-gpu.md` and this task's own + T11320's progress
notes.

## Acceptance Criteria

- [x] Per-pixel constant is derived from 2+ real Modal staging measurements across different
      crop sizes, not a single extrapolated point — 12 points across 3 jobs
- [x] Linear-in-pixel-count scaling is confirmed (or the formula is corrected if it doesn't hold)
      — confirmed for crop pixels; the formula WAS corrected to add a target-resolution-dependent
      overhead term the original shape couldn't represent
- [x] `export_cost_guard.py` and `modal-gpu.md` updated with the new constant and its provenance
- [x] T11320's task file's risk note is updated to reflect the calibrated state
