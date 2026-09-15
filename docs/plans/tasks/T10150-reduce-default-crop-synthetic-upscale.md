# T10150: Reduce the default 9:16 crop's synthetic upscale

**Status:** WIP
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-15
**Updated:** 2026-09-15

## Problem

T9970's quality benchmark (`scripts/quality_benchmark.py`, merged) found that the evaluator's
"looked soft" report (S05) is explained almost entirely by the DEFAULT crop size, not by a faulty
upscaler. Confirmed and extended during T9950's design review (Fable's second-pass verification,
2026-09-15):

`DEFAULT_CROP_SIZES['9:16'] = { width: 205, height: 365 }`
(`src/frontend/src/modes/focus/hooks/useCrop.js`, mirrored by
`src/backend/app/services/default_crop.py`) is a FIXED size regardless of source resolution. On a
1080p source this is a ~5.7% area crop, forcing a ~3.95x real Real-ESRGAN upscale to reach the
1440p-capped output. This is the crop every user gets who doesn't manually resize the focus box —
almost certainly the majority, since resizing is not the default interaction.

Benchmark evidence (no-GAN Lanczos lower bound, `scripts/quality_benchmark.py` against
`formal annotations/test.short/wcfc-carlsbad-trimmed.mp4`, 1080p source):

| Crop | Enlargement | Sharpness (lap_var, higher=sharper) | Athlete share of frame |
|---|---|---|---|
| 205x365 (today's default) | 3.95x | 3.2 | 35.6% |
| 410x730 (2x candidate) | 1.98x | 32.1 (**~10x better**) | 17.8% |
| 608x1080 (max-fit, full source height) | 1.33x | 105.0 | 12.0% |

The 2x candidate (410x730) is the sweet spot: a ~10x sharpness improvement over today's default
while keeping the athlete a clear subject of the frame (voted the "wider frame" target for T9950
over max-fit for the same reason — max-fit shrinks the athlete to little more than a tenth of the
frame, undercutting the point of Focus mode).

## Why this is scoped separately from T9950

T9950 only widens a crop when the USER clicks "use a wider frame" — an opt-in. This task changes
the crop every new (or reset) clip gets with ZERO user action, which is a different blast radius:
every unframed clip's default output changes, not just clips someone explicitly widened. It needs
its own before/after evidence and its own decision, per the Architect's original scoping (T9950
design doc §8 Q2) and the project's standing "correct data, not workarounds" + "no unverified
quality claim" rules.

## Dependency

**WAIVED 2026-09-15.** Originally gated on T10160 (skip the GAN pass for small enlargements),
since doubling the default crop area roughly quadruples GPU input pixels for the upscale pass
on every single framing export in the product. Reviewed alongside T10160's design gate
(`docs/plans/tasks/T10160-design.md`, which puts the real cost at ~4x for a 410x730 default vs
today's 205x365); user confirmed there is plenty of margin and the cost increase does not
affect pricing. **T10160 does not need to land first** - proceed independently. T10160 still
ships (inert-by-default GAN-skip mechanism) as a separate quality/tidiness improvement, not a
prerequisite for this task.

## Solution (to be designed, not assumed)

1. Confirm the exact new default sizes for both `9:16` and `16:9` (this task's evidence covers
   9:16; `16:9` needs its own quick benchmark pass before assuming the same ~2x ratio applies).
2. Update `DEFAULT_CROP_SIZES` (frontend `useCrop.js`) and its backend twin
   (`default_crop.py`) together — these are documented as mirrored constants that must never
   drift (see T9950 design doc §1.3).
3. Decide default-size behavior for EXISTING clips with no user-set crop vs. NEW clips only —
   changing the default should not silently reframe an already-exported or already-reviewed
   clip's crop on an unrelated action. Follow the gesture-based / no-reactive-persistence rule:
   this is a code-level default constant, never triggered by a runtime write.
4. Verify the resulting default still respects `constrainCrop`/rotation-safe-area clamps for
   very small source videos where a 2x-larger default might not fit.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/focus/hooks/useCrop.js` (`DEFAULT_CROP_SIZES`)
- `src/backend/app/services/default_crop.py` (mirrored backend constant)
- `src/backend/tests/test_default_crop.py` (existing coverage to extend)

### Related Tasks
- Depends on: **T10160** (skip-GAN cheap path) — WAIVED, see Dependency above.
- Evidence from: T9970 (quality benchmark, merged) and T9950's design review
  (`docs/plans/tasks/T9950-design.md` §3.5, §8 Q2).
- Coordinate with: T9950 (Framing simplification) — if T9950's "wider frame" ships with a 2x
  target before this task changes the DEFAULT, a user who already has a default-sized clip and
  clicks "use a wider frame" reaches the same 410x730 this task would make the new baseline;
  confirm the two don't produce a confusing default-vs-widened distinction with no visible
  difference once both ship.

### Technical Notes
M/L-tier: touches a mirrored frontend/backend constant pair plus default-crop-size test coverage.
No schema change. Real before/after evidence (not just a benchmark run) should accompany the
outcome record given this changes default output for the majority of new exports.

## Implementation

### Steps
1. [x] Confirm T10160 has landed (or an explicit user waiver exists) before starting. **Waived
   2026-09-15** - user confirmed GPU-cost margin is not a concern.
2. [ ] Benchmark the `16:9` default separately — do not assume the `9:16` ratio transfers.
3. [ ] Update `DEFAULT_CROP_SIZES` + `default_crop.py` together, same values.
4. [ ] Decide and implement existing-vs-new-clip default behavior (see Solution item 3).
5. [ ] Extend `test_default_crop.py` and any frontend `useCrop` tests for the new sizes.
6. [ ] Real before/after export comparison (not just the no-GAN benchmark) attached to the
   outcome record.

### Progress Log

**2026-09-15**: Filed as a T9950 design-review byproduct (Fable's second-pass verification;
T9970's original finding named this as the likely higher-value follow-up, Q2 in the design doc).

**2026-09-15 (implementation)**: New defaults chosen as **2x the old fixed box** for both
ratios, evidence-backed:

- **9:16**: 205x365 -> **410x730** (confirmed from T9970 benchmark + T9950 design review:
  3.95x -> 1.98x enlarge, lap_var 3.2 -> 32.1 (~10x sharper), athlete 35.6% -> 17.8% of frame).
- **16:9**: 640x360 -> **1280x720** (benchmarked separately this task, `scripts/quality_benchmark.py`
  against `formal annotations/test.short/wcfc-carlsbad-trimmed.mp4` @ 1920x1080, output 2560x1440
  = the VIDEO_MAX 1440p cap):

  | 16:9 crop | enlarge | enlarged lap_var (higher=sharper) | subject share |
  |---|---|---|---|
  | 640x360 (old default) | 4.00x | 2.86 | 36.1% |
  | **1280x720 (2x, chosen)** | **2.00x** | **27.62 (~9.7x better)** | **18.1%** |
  | 960x540 (1.5x) | 2.67x | 10.97 | 24.1% |
  | 1920x1080 (max-fit) | 1.33x | 90.84 | 12.0% |

  16:9 mirrors 9:16 almost exactly: the 2x box is the sweet spot (~10x sharper, athlete still a
  clear ~18% subject vs max-fit's 12%).

**Real before/after export evidence** (in-container, GPU/Modal OFF so GAN is unmeasurable — these
are the sanctioned no-GAN LOWER BOUND, T4120):
- Standalone benchmark produced real encoded mp4s + side-by-side montages; the 640x360 (4x) frame
  is visibly mushy, the 1280x720 (2x) frame visibly sharper (players/trees/cars crisp). Reproduce:
  `python3 scripts/quality_benchmark.py --config <16:9 scenario, boxes above> --out <dir>`.
- The **real product export pipeline** (`_export_clips`, real ffmpeg crop+scale, ffprobed output)
  is exercised with the new defaults by `tests/test_t4050_reframe_e2e_pipeline.py` — PASSES.

**Existing-vs-new-clip behavior**: the default is applied ONLY when a clip has no saved crop
keyframes (state `uninitialized`); an existing clip with a user-set crop restores its saved
keyframes and never recomputes the default. This is a pure code-level constant — NO reactive
effect writes it back, so changing it cannot silently rewrite an already-set crop (gesture-based
persistence rule). Guarded by useCrop tests (`does not auto-initialize when saved keyframes are
provided`, `updateAspectRatio ... without rewriting saved keyframes`).

**Small-source edge case**: the enlarged box can exceed a tiny/aspect-mismatched source. Both
sides now fall through to the existing fit-to-video calc (largest rectangle of that ratio) so the
default is always a valid in-bounds crop; the backend keeps resolving the predefined size when
source dims are unknown. Guarded by `test_predefined_falls_back_when_source_too_small` (backend)
and `falls back to a fit-to-video default when the source is too small` (frontend).

**Drift guard**: new `test_frontend_backend_parity` parses `useCrop.js`'s `DEFAULT_CROP_SIZES` and
asserts it equals the backend dict (and that it parsed the expected number of ratios) — a change
to one side without the other now fails CI.

**Widen-framing (T9950) interaction (noted, not a defect)**: the "use a wider frame" target is
`min(default*2, maxFit)` (`widenFraming.js`). With the default now doubled, the raw widen target
(e.g. 820x1460 on 9:16) is clamped by max-fit on a 1080p source — this is exactly the per-axis
`min` clamp T9950 designed for, and `isWideFraming` is DERIVED so nothing is corrupted. Net effect:
the widen button now yields a smaller RELATIVE enlargement over the (larger) default. Product
behavior, within design; flagged for awareness. `widenFraming.test.js` uses its own fixture and
stays green.

**Tests**: backend 18/18 green (`test_default_crop.py`, `test_t4050_reframe_dropped_at_export.py`,
`test_t4050_reframe_e2e_pipeline.py`); frontend 32/32 green (`useCrop.test.js` + adjacent
`CropLayer`/`CropOverlay`). ESLint clean on the changed file.

**QA note (live browser drive)**: the WIP-limit worker container runs the stack via docker
orchestration on the host (`task.sh stack`), not reachable from inside the worker, and an
authenticated Focus-mode drive needs real R2 account/clip data the container does not hold. The
three QA checks it would perform are each covered by the automated evidence above (both-ratio
default applies; existing manually-set crop unaffected; small-source edge case), and the no-GAN
benchmark substitutes for the live GPU export. **Live browser QA at both aspect ratios should be
confirmed on staging** (the designated test phase per CLAUDE.md) after merge.

## Acceptance Criteria

- [ ] New default crop sizes chosen with real evidence for BOTH `9:16` and `16:9`
- [ ] Frontend/backend constants stay mirrored (no drift)
- [ ] Existing clips' already-set crops are never silently rewritten
- [x] T10160 has landed first, or the GPU-cost tradeoff is explicitly accepted by the user -
      **waived 2026-09-15**, tradeoff explicitly accepted
- [ ] No "Enhanced to HD" or similar quality-outcome claim ships in any related copy
