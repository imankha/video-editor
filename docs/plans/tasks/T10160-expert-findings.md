# T10160 Expert Findings — Skip the GAN upscale for small enlargements

> Produced by the `expert` agent (Opus) during the Stage 1-2 design-gate dispatch, 2026-09-15.
> Analysis only; no code changed, no Modal jobs dispatched. Input artifact for the Architect and
> for the user's design-gate decision.

## (a) Environment constraints — what could and could not be measured

Verified independently (not just trusting the kickoff):
- **No torch/CUDA** (`ModuleNotFoundError: No module named 'torch'`). The local Real-ESRGAN GAN
  cannot run. `realesrgan` package is not installed either.
- **No Modal auth** (`config.token_id=False`, `token_secret=False`, no `~/.modal.toml`, no
  `~/.config/modal/`). A live Modal T4 dispatch is impossible — it would fail auth before doing any
  work. (`MODAL_ENABLED=true` is set in `.env` but is inert without tokens; `APP_ENV=dev`.)
- **ffmpeg + cv2 4.9.0 + numpy 1.26.4 present**; the authorized fixture exists
  (`formal annotations/test.short/wcfc-carlsbad-trimmed.mp4`, 1920x1080).

**Could measure:** the geometric/Lanczos no-GAN lower bound at every target ratio, matched-timestamp,
via `scripts/quality_benchmark.py` (ran clean, exit 0). **Could NOT measure:** anything the GAN
contributes, and any real GPU-second/VRAM figure. Every cost number in section (c) is **ANALYTICAL**,
derived from the documented E6 anchor + the SRVGGNetCompact architecture, explicitly not a measurement.

## Ground-truth correction to the task framing (read first)

The task premise and the domain doc both lean on `frame_processor.py:216-228`'s
`desired_scale = min(scale_x, scale_y, 4.0)` "enhance-then-downsize" logic. **That code is NOT the
production hot path.** Two independent facts:

1. **Production is the Modal copy, and it calls `enhance(cropped, outscale=4)` UNCONDITIONALLY** at
   all four render sites (`video_processing.py:1568, 1954, 2187, 2963`). There is no
   `min(scale_x, scale_y, 4.0)` on the Modal side — the crop-interpolation-math-exists-4x landmine
   applies here too: the local `ai_upscaler` and the Modal prod copy are separate implementations,
   and only the local one has the `desired_scale` trim.
2. **`outscale` does not reduce GAN compute anyway.** `RealESRGANer.enhance(img, outscale)` always
   runs the network at its native `scale=4` over the *entire* input, then does a trivial final
   `cv2.resize` to `outscale`. So even the local path's `desired_scale` "optimization" saves only a
   downscale-resize, never GAN FLOPs. **The GAN cost is a pure function of input crop pixel count**,
   full stop — `tile=0` (`video_processing.py:1282`) confirms no tiling, so compute and activation
   VRAM scale with the crop's input pixels, independent of the enlargement ratio.

Consequence for the design: the cheap path this task proposes is **the only lever that actually
removes GAN cost** — you cannot get the savings by tuning `outscale`. That strengthens the task's
motivation, not weakens it.

## (b) Quality numbers — fresh, matched-timestamp, no-GAN LOWER BOUND

Fixture 1920x1080 @ 29.97, window 0:03-0:09, 24 matched timestamps @ 4fps, output 810x1440 (9:16).
`lap_var` at the common 810x1440 output grid (higher = sharper; compare only within this matched
grid). Reproduce: `python3 scripts/quality_benchmark.py --config /tmp/t10160_scn.json --out /tmp/t10160-bench`.

| Crop (9:16) | enlarge_x | crop input px | source-crop lap_var | enlarged lap_var (Lanczos, no-GAN) | enl std | encoded lap_var | subject % of crop-h |
|---|---|---|---|---|---|---|---|
| 608x1080 | 1.33x | 656,640 | 276.5 | 104.0 | 36.7 | 111.6 | 12.0% |
| 540x960 | 1.50x | 518,400 | 293.4 | 73.8 | 26.4 | 88.2 | 13.5% |
| 410x730 (T9950 wider) | 1.98x | 299,300 | 336.0 | 32.2 | 11.0 | 41.5 | 17.8% |
| 405x720 | 2.00x | 291,600 | 338.2 | 30.9 | 10.6 | 42.9 | 18.1% |
| 270x480 | 3.00x | 129,600 | 355.6 | 8.0 | 2.4 | 13.8 | 27.1% |
| 205x365 (today's default) | 3.95x | 74,825 | 304.6 | 3.2 | 1.0 | 6.5 | 35.6% |

Reads consistent with T9970 (their 608x1080->105.0 and 205x365->3.18 reproduce almost exactly). Key
shape: **enlarged sharpness falls off roughly as 1/enlarge^2 in the no-GAN path** — 104 -> 74 -> 32
-> 8 -> 3 as enlarge goes 1.33 -> 1.5 -> 2 -> 3 -> 3.95. The Lanczos path degrades *fast* past ~1.5x.

**Source-supply ceiling (load-bearing):** a 9:16 crop in a 1920x1080 source physically cannot be
wider than 608x1080, so **enlarge_x < ~1.33x is impossible for 9:16 output from 1080p** — the
requested 1.1x and 1.3x ratios don't exist for this format/source. The interesting threshold band is
therefore **1.33x-2x**, not "1.1x-3x."

**GAN side — qualitative only (cannot run here).** Per T9970 FINDINGS and the upscale-quality EPIC,
the GAN "is designed precisely to recover detail the tight crop lacks," and whether it closes the
~33x Lanczos gap "is unknown and is the single most important follow-up measurement (needs
CUDA/staging)." At 1.33x, Lanczos alone already reaches lap_var ~104 (vs ~3 at 3.95x) — i.e. **at low
enlargement the crop starts with abundant detail and the GAN has little left to add**, which is the
mechanism that would justify a cheap path. But "little" is not "none," and only a GAN run quantifies it.

## (c) ANALYTICAL GPU/VRAM cost model

Assumptions (all checkable):
1. SRVGGNetCompact is fully convolutional -> FLOPs proportional to input pixel count (HxW), linear.
   `tile=0` -> no tiling overhead, single forward pass over the whole crop.
2. Production always runs the net at native 4x over the full crop (`outscale=4`, confirmed 4 sites).
   Cost is independent of enlarge_x; it depends only on **crop input pixels**.
3. **E6 anchor calibration:** documented 681 ms/frame, T4 ~ 1.47 fps. This anchor predates the
   wider-frame work. Calibrated to the historical default crop **205x365 = 74,825 px -> 681
   ms/frame**, giving **k ~ 9.1 us per input kilopixel**. Single fitted constant; if the E6 anchor
   was measured at a different crop size, every GAN column below rescales linearly (open question Q1).
4. Lanczos alternative cost is CPU-negligible vs the GAN; treat Lanczos GPU-s ~ 0 for the delta.

Per-frame GAN time (analytical), 30fps, 10s clip = 300 output frames:

| Crop | input px | GAN ms/frame (=9.1us x kpx) | vs default | GAN-s / 300-frame clip | ~ T4 $ |
|---|---|---|---|---|---|
| 205x365 (default) | 74,825 | ~681 (anchor) | 1.0x | ~204 s | ~$0.033 |
| 270x480 | 129,600 | ~1,180 | 1.73x | ~354 s | ~$0.058 |
| 405x720 (~2x) | 291,600 | ~2,655 | 3.90x | ~797 s | ~$0.131 |
| 410x730 (T9950) | 299,300 | ~2,725 | 4.00x | ~817 s | ~$0.134 |
| 540x960 | 518,400 | ~4,720 | 6.93x | ~1,416 s | ~$0.232 |
| 608x1080 | 656,640 | ~5,980 | 8.78x | ~1,794 s | ~$0.294 |

The **ratios** ("vs default" column) are anchor-independent and robust; absolute dollars inherit the
anchor's uncertainty. Headline: the wider crops the product is moving toward cost **4x-9x the GAN
time** of today's default, because GAN cost tracks input pixels and wider crops have far more of them.
A cheap path that skips the GAN for the wide crops removes that cost exactly where enlargement is
smallest.

**VRAM (analytical):** activation memory for a fully-conv net at `tile=0` also scales ~linearly with
input pixels. 608x1080 has ~8.8x the input pixels of the default -> order-8x the activation
footprint. Absolute MB unmeasurable here (no CUDA); the *widest* crops are also the OOM-risk crops —
which is why the local `model_manager.py` forces `tile=256` (line 462) for stability while Modal runs
`tile=0`. Exact peak MB is a staging measurement (open question Q2).

## (d) Threshold verdict

**A cheap-path threshold is justified in principle, and the quantity it must be computed on is
`enlarge_x` (output_width / source-crop_width) — NOT crop pixel count, NOT a lap_var cut point.**
- `enlarge_x` is the pure-geometry signal available at framing time, GAN-independent, and it is
  exactly what determines how much invented detail the GAN must supply. T9970 reached the same
  conclusion for a different guard.
- Crop pixel count drives *cost*, but the *quality* decision (is the GAN worth its cost here?) is
  governed by enlarge_x. Gate on the quality axis and get the cost win for free, because low
  enlarge_x correlates with large crops.

**A specific numeric cut point cannot be responsibly set from this environment.** The no-GAN lower
bound tells you where Lanczos is good enough on its own (~104 at 1.33x, ~74 at 1.5x), but the
threshold decision is "below X, GAN ~ Lanczos so skip it" — which requires the GAN's numbers at those
same ratios (CUDA/Modal). Setting it on Lanczos-only data risks skipping the GAN where it still adds
visible detail, or being needlessly conservative.

**Provisional direction (defensible, not a ship-it number):** the band worth testing is
**enlarge_x <= ~1.5x**. At <=1.5x the source crop is already sharp (lap_var 276-293) and even Lanczos
alone retains 74-104 lap_var at the output grid, while the GAN there costs 7x-9x the default. Above
~2x the Lanczos path collapses (32 -> 8 -> 3) and the GAN clearly earns its cost. Treat 1.5x as the
hypothesis the one required measurement tests — do not default to it as a decision.

## (e) The exactly-one gated measurement, and where

**A GAN-inclusive run of the same six crops on CUDA or staging Modal.** Run
`enhance(crop, outscale=4)` -> Lanczos-to-810x1440 through the real `realesr-general-x4v3` model at
608x1080, 540x960, 410x730, 405x720, 270x480, 205x365, over the same 24 matched timestamps, computing
enlarged/encoded lap_var + hf_ratio the same way. That produces the GAN column table (b) is missing.
The threshold is the largest enlarge_x at which **(GAN lap_var - Lanczos lap_var)** drops below a
perceptual-noise floor (ideally with a small parent A/B, per T9970's blocked dimension 12).

Environment: a CUDA host (torch + the four pinned packages from `upscale_image`), or **staging Modal**
(`reel-ballers-video-v2-staging`) with real credentials. Also gated to staging: real billed
GPU-seconds (to confirm the analytical k) and peak VRAM per crop. None dispatchable from this container.

## (f) Design / rollback hooks

- **Where the branch lives:** the production change goes in `video_processing.py`, at each of the four
  `upsampler.enhance(cropped, outscale=4)` sites (1568, 1954, 2187, 2963) — the deployed hot path.
  The local `ai_upscaler/frame_processor.py:222` mirror must get the same branch **or the two engines
  diverge** (the 4x crop-math landmine). Both required.
- **Branch shape:** `if enlarge_x < GAN_MIN_ENLARGE: upscaled = cv2.resize(cropped, target,
  INTER_LANCZOS4) + existing sharpen; else: enhance(...)`. `enlarge_x` is computable right there from
  `output_width / cropped.shape[1]`.
- **Trivially revertible:** a single named constant `GAN_MIN_ENLARGE` (co-located per greppability).
  Set it to `0.0` and the cheap path is dead — byte-identical to today, the T8280 inert-gate pattern.
  Ship inert (`0.0`), verify no behavior change, then flip to the calibrated value in a follow-up once
  the GAN run exists. Modal-image change -> rides the manual per-env deploy gate (staging->verify->prod,
  Invariant 3).
- **Regression guard:** above the threshold the enhance call must be byte-identical to today; the
  design must assert `GAN_MIN_ENLARGE` gates only the new branch and never alters the >=threshold path.

## (g) Open questions for the user

- **Q1 (calibration):** What crop input size was the E6 681 ms/frame anchor actually measured at?
  Calibrated to 205x365; a different size rescales every absolute GAN-time/dollar figure linearly
  (ratios unaffected). Confirm from the E6 record before any dollar figure is quoted to product.
- **Q2 (the gated run):** Authorize a staging-Modal or CUDA-host run of the six-crop GAN benchmark?
  It is the single measurement that converts the provisional ~1.5x direction into a shippable
  threshold. Without it, land the **inert** constant + measurement harness only; the numeric flip is a
  follow-up.
- **Q3 (scope coupling):** T9970 flagged this is a single-fixture, one-lighting-condition sample.
  Calibrate the threshold on a multi-fixture set (low-light, closer distance) before shipping
  non-inert, or is the wcfc fixture acceptable for a first flip? A too-high threshold durably
  under-processes real exports; a too-low one wastes the GPU savings.

## Cost/spend note

**Zero real Modal jobs were dispatched from this container, and none could be** — no Modal auth
tokens present (verified: `token_id`/`token_secret` both False, no `~/.modal.toml`). No GPU spend.
The only compute was the local Lanczos-only `quality_benchmark.py` (CPU/ffmpeg, free). Every
GPU-second, VRAM, and dollar figure is analytical, derived from the documented E6 anchor and the
SRVGGNetCompact architecture — not a measurement.
