# T10160: Skip the GAN upscale pass when the enlargement is small

**Status:** WIP
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-15
**Updated:** 2026-09-15

## Problem

Found during T9950's design review (Fable, second-pass verification of the Architect's design
doc). `AIVideoUpscaler` (`src/backend/app/ai_upscaler/__init__.py` + `frame_processor.py`) always
runs the full Real-ESRGAN 4x pass and then downsizes the result to the 1440p-capped target
resolution (`frame_processor.py:216-228`, `desired_scale = min(scale_x, scale_y, 4.0)` — the GAN
itself still processes at up to 4x before the result is resized down). Production runs with
`tile_size=0` (no tiling — `multi_clip.py:1101`, `processor_local.py:82`), so the GAN's per-frame
compute and VRAM scale with the CROP's pixel count, not with how much real enlargement is needed.

This means a *small* crop enlargement (e.g. 1.3-2x, which is exactly what T9950's "wider frame"
control and any future default-crop change produce) still pays the FULL GAN cost of a much larger
input frame, for a visually marginal gain over a cheaper method at that ratio. Benchmarked via
T9970's `scripts/quality_benchmark.py` (no-GAN Lanczos baseline, so these are lower bounds, not
final numbers) on the wcfc-carlsbad-trimmed.mp4 fixture, 1080p source, 9:16 output:

| Crop | Enlargement | GPU input pixels vs. today's default |
|---|---|---|
| 205x365 (today's default) | 3.95x | 1x |
| 410x730 (candidate new default / T9950 "wider frame") | 1.98x | 4x |
| 608x1080 (max-fit) | 1.33x | 8.8x |

A crop this close to the target resolution may not need the GAN pass at all — a high-quality
Lanczos/bicubic resize plus the existing sharpen step (`frame_processor.py:230-238`) could be
visually competitive at low enlargement ratios, at a fraction of the GPU time and VRAM.

## Why this matters now

T9950 (Framing simplification) is adding a "use a wider frame" control that will make ~2x
enlargements common (previously the tight 205x365 default meant ~4x was the norm). T9950's own
risk R1 already requires measuring GPU cost before shipping the widen button, and its finding
will very likely show a real per-export time/VRAM increase absent this optimization. Separately,
the evaluator's own "looked soft" report traces to the *default* crop being needlessly tiny
(T9970's finding) — fixing the default (a plausible T10150 follow-up) only becomes economically
safe at scale once cheap enlargements exist.

## Solution (to be designed, not assumed)

1. Measure actual quality delta between GAN-upscaled and Lanczos-upscaled output at several
   enlargement ratios (1.1x, 1.3x, 1.5x, 2x, 3x) using T9970's benchmark methodology (matched
   timestamps, the documented rubric) — this determines WHERE the threshold should sit, if one
   is warranted at all. Do not assume 1.5x; measure it.
2. If a threshold is justified, add a cheap-path branch in the upscale pipeline: below the
   threshold, skip `upsampler.enhance()` and use a high-quality Lanczos resize + the existing
   sharpen step instead; at or above threshold, unchanged GAN behavior.
3. This is a Modal/GPU-pipeline change — needs the `expert` agent per CLAUDE.md's escalation
   rules (performance analysis beyond an obvious hot spot) before implementation, and likely an
   Architect design doc given it changes a production render code path used by every export.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/ai_upscaler/__init__.py`
- `src/backend/app/ai_upscaler/frame_processor.py`
- `src/backend/app/ai_upscaler/model_manager.py` (tile/model setup)
- `scripts/quality_benchmark.py` (T9970 — reuse for the threshold measurement)

### Related Tasks
- Found during: T9950 design review (`docs/plans/tasks/T9950-design.md` §3.5, §6 R1)
- Gates: T10150 (lower the default crop size) — that task should not ship without this, or it
  durably raises GPU cost/export for every new upload, not just users who opt into a wider frame.
- Builds on: T9970 (quality benchmark tooling and methodology, merged)

### Technical Notes
L-tier candidate: touches the production render path, needs real before/after quality evidence
(not just a benchmark number), and a GPU-cost measurement on the actual Modal/T4 environment, not
just a local no-GAN approximation. Do not implement without an Architect design gate.

## Implementation

### Steps
1. [ ] Spawn `expert` agent: quantify actual GAN vs. Lanczos GPU time/VRAM delta at several
   enlargement ratios on the real Modal T4 path (not the no-GAN local benchmark), and assess
   quality delta using T9970's rubric.
2. [ ] If a threshold is justified, Architect design doc for the cheap-path branch.
3. [ ] Implement per approved design, with before/after quality evidence attached to the outcome
   record (not just a benchmark number — real exported clips, matched timestamps).
4. [ ] Verify no regression for large-enlargement crops (the existing GAN path must stay exactly
   as good as it is today above the threshold).

### Progress Log

**2026-09-15**: Filed as a T9950 design-review byproduct (Fable's second-pass verification found
this gates both T9950's R1 risk and any future default-crop-size change).

## Acceptance Criteria

- [ ] Measured (not assumed) quality delta between GAN and Lanczos at multiple enlargement ratios
- [ ] If a cheap path ships: real GPU time/VRAM improvement demonstrated on the actual Modal path
- [ ] No quality regression for enlargement ratios that stay on the GAN path
- [ ] No quality claim in any user-facing copy ships from this task alone (measurement/pipeline
      change only, per the standing "name the step, never promise the outcome" rule)
