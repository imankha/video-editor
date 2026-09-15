# T9970 — Highlight quality rubric

Deliverable 3 of 4 (AC: "Define and document a testable quality rubric").
This is the scoring rubric the benchmark implements; it is intentionally split
into **objective/measurable** dimensions (which `scripts/quality_benchmark.py`
computes) and **human-judgement** dimensions (which require frame-matched review
and, for the last one, real parents — marked BLOCKED in this environment).

Golden rule (EPIC.md decision 3): **name the step, never promise the outcome.**
Nothing in this rubric authorises an "Enhanced to HD" claim; the rubric exists to
decide whether such a claim could ever be honestly made, and today it says no.

## What "quality" means for this product

The target user is a busy youth-sports parent who wants ONE compelling, playable
highlight they'd confidently send to family. So "quality" is not abstract PSNR —
it is: *is my athlete clearly visible, is the whole play intelligible, and does
it look good enough to send?* The rubric encodes that.

## Dimensions

Each dimension has a **measure** (how it is scored), a **source stage** (which of
the four captured stages it is read from), and a **direction** (higher/lower is
better). Stages: **S** source · **C** crop-applied-to-source · **E** enlarged
(Lanczos, no-GAN) · **X** encoded mp4 re-decoded.

| # | Dimension | Measure | Stage | Better | Automated? |
|---|---|---|---|---|---|
| 1 | **Subject visibility** | subject box height ÷ crop box height (`subject_share_of_crop_h`) | C | higher | ✅ (needs a subject box) |
| 2 | **Softness / sharpness** | `lap_var` (Laplacian variance) + `hf_ratio` (FFT high-freq energy fraction), compared at matched output resolution | E, X | higher | ✅ |
| 3 | **Enlargement load** | output width ÷ source crop width (`enlarge_x`) | C→E | lower | ✅ |
| 4 | **Temporal stability (softness pumping / jitter of quality)** | `lap_var_std` across the sampled window | E | lower | ✅ |
| 5 | **Framing jitter** | mean frame-to-frame crop-centroid movement `centroid_jitter_px` | (crop model) | lower | ✅ (of the tool's crop model, not prod spline) |
| 6 | **Black gaps** | fraction of sampled frames with mean luma < 16 (`black_frac`) | E, X | lower (→0) | ✅ |
| 7 | **Encode fidelity / drift** | `encoded lap_var` vs `enlarged lap_var` (does the H.264 pass lose or add texture) | X vs E | close to E | ✅ |
| 8 | **Full-action visibility** | does the crop retain the setup AND outcome of the play (ball origin + destination)? | C | qualitative | ❌ human |
| 9 | **Crop loss** | is the athlete or ball ever clipped out of the crop as the play moves? | C | qualitative | ❌ human |
| 10 | **Audio sync** | does audio stay aligned to action across the whole clip | X | qualitative | ❌ human (audio stripped in this benchmark) |
| 11 | **Effects fidelity** | do Spotlight / outline / cover-frame effects survive to the exported bytes | X | qualitative | ❌ human (Overlay pass not run here) |
| 12 | **"Would you send this?"** | recorded parent verdict + free-text reason | X | — | ❌ **BLOCKED** — no parents in this env |

### Notes on the measures

- **`lap_var` is a proxy, cross-checked by `hf_ratio`.** Neither is a perceptual
  score. Compare them only between images at the **same output resolution** (the
  benchmark always renders every variant to the same 810×1440 grid) — an
  upsampled image is inherently smoother, so cross-resolution comparison would be
  meaningless. Within matched resolution, a large gap reflects genuinely less
  high-frequency content reaching the output.
- **Dimension 1 vs 2/3 is the core tradeoff.** A tighter crop wins subject
  visibility (1) but loses on softness (2) and enlargement (3). The rubric does
  not collapse these into a single number — the recommendation weighs them (see
  FINDINGS.md).
- **Whole-clip, not one frame.** The brief warns single sampled frames don't
  prove whole-video quality. Every automated dimension is computed at a cadence
  (default 4 fps across the window) and aggregated (mean + std), and the tool
  also emits an encoded mp4 per variant for normal-playback review.

## Environment limits (must be restated wherever a number is quoted)

- **No GAN.** This container has no CUDA/torch, so the upscale stage is Lanczos
  only (`MockVideoUpscaler`-equivalent, `local_processors.py`). Production runs
  Real-ESRGAN 4× before the Lanczos resize. Every dimension-2/7 number here is a
  **no-GAN lower bound**; the GAN can only raise sharpness, never lower it. A
  GAN-inclusive run (dimensions 2, 4, 7, and ideally 8–11) MUST be repeated on a
  CUDA host / staging before any quality claim ships.
- **Crop model.** The benchmark uses a static or linear-pan crop box, not the
  production Catmull-Rom spline. Dimensions 1–3, 6, 7 are spline-independent
  (they depend on box size/position, not the interpolation curve). Dimensions 4
  and 5 reflect the tool's own crop motion and are indicative only.
- **No Overlay / audio pass.** Effects fidelity (11) and audio sync (10) are out
  of this benchmark's scope; they are listed so a future GAN+effects run covers
  them.

## Pass/consider/fail bands — deliberately NOT fixed yet

The brief requires tolerances be set "with product/QA using actual results, not
invented universal numbers." With a single-fixture, no-GAN sample, this rubric
**does not publish universal numeric thresholds.** It defines the *dimensions and
measures*; the *cut points* are left to a calibrated multi-fixture GAN-inclusive
run (see FINDINGS.md §"Threshold decision" for the explicit recommendation to
keep any conditional warning DISABLED until then).
