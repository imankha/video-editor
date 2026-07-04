# T4710: Encode + Denoise Quick Wins

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-07-03
**Updated:** 2026-07-03

## Problem

Three cheap quality losses sit in the production Modal path today (see [EPIC.md](EPIC.md) "Current Production Pipeline"):

1. **The final encode throws away detail the GPU just paid for.** Final output uses `libx264 -crf 23 -preset fast` while intermediate parallel chunks already use `-crf 18` — the last encode is the LOWEST quality step in the chain. Encoding runs on CPU; its cost is noise next to ~200 GPU-seconds per clip.
2. **Missing bt709 color tags.** The local encoder tags `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv` (`video_encoder.py:789-792`); the Modal path tags nothing. Untagged video renders washed out / color-shifted in some players (QuickTime, some Android).
3. **The denoise blend knob is unused.** `realesr-general-x4v3` ships with a companion denoise model (`realesr-general-wdn-x4v3`) designed to be interpolated with the base model via `RealESRGANer`'s `dni_weight` — we pass `dni_weight=None`. Far-side crops are dominated by H.264 block noise; the GAN currently *sharpens the noise*. A partial denoise blend before sharpening is the documented intended use for compressed sources.

## Solution

Prove each change in the testbed (per the epic's Testbed-First rule), then apply to `video_processing.py`. Items 1-2 are near-mechanical; item 3 needs a small eval to pick the blend strength.

## Context

### Relevant Files (REQUIRED)

- `src/backend/app/modal_functions/video_processing.py` — ALL changes land here:
  - image build (~lines 64-83): add the wdn weight download next to the existing one
  - `_get_realesrgan_model` (~1076-1114): DNI wiring
  - final-encode ffmpeg branches (~1478-1584, ~2745-2792) and `_build_simple_ffmpeg_cmd` (~2347): CRF/preset/color tags
  - every `upsampler.enhance(...)` call site is UNCHANGED (1367, 1752, 1984, 2638)
- `src/backend/app/services/ffmpeg_service.py` — read-only reference for tag strings
- `src/backend/experiments/sr_testbed/pipelines/` — NEW variant pipelines (see steps)

### Related Tasks
- Depends on: T4700 (testbed must exist to prove the changes)
- Blocks: nothing, but T4720 should A/B against the *post-T4710* baseline
- See [EPIC.md](EPIC.md) for design decisions and the current-pipeline ground truth.

### Technical Notes

- **DNI (Deep Network Interpolation) wiring:** `RealESRGANer` accepts `model_path=[path_base, path_wdn]` and `dni_weight=[w1, w2]` (weights sum to 1) and blends the two checkpoints' weights at load time. **Copy the exact wiring from the official `inference_realesrgan.py` in the xinntao/Real-ESRGAN repo** (the `denoise_strength` argument handling) rather than guessing the weight order — then verify direction empirically: run strength 0.0 and 1.0 on one noisy clip; 1.0 must look visibly smoother/denoised. Do this check FIRST; getting the pair backwards inverts every later result.
- **wdn weight URL:** same GitHub release as the base model (`v0.2.5.0`), filename `realesr-general-wdn-x4v3.pth`. Add to the image-build download loop so it's baked at `/root/.cache/realesrgan/weights/` like the others. The image rebuilds on next `modal deploy` — no manual step.
- **Blend is load-time, so it's per-container, not per-frame** — zero inference-speed cost. `_get_realesrgan_model` caches the model in a global; the denoise strength must be part of the cache key (or fixed by a module constant) so a container never serves a stale blend.
- **CRF 18 file-size impact:** expect roughly +30-40% file size on final videos. Final reels are seconds long; R2 delta is negligible. If anyone objects, CRF 19-20 + `preset medium` keeps most of the win.
- Keep the intermediate-chunk CRF 18 as-is; change ONLY final encodes.

## Implementation

### Steps

1. [ ] **Testbed variants first** (all tiny subclasses of `current_prod`):
   - `prod_crf18` — encode `-crf 18 -preset medium` + bt709 tags, model untouched
   - `prod_dni030` / `prod_dni050` — `denoise_strength` 0.3 / 0.5, prod encode
   - `prod_quickwins` — both together (the shipping candidate)
2. [ ] **DNI direction check** (Technical Notes) on one noisy far clip before running the matrix.
3. [ ] **Run the matrix**: `run_eval.py --pipelines current_prod,prod_crf18,prod_dni030,prod_dni050,prod_quickwins --clips all`. Read the report:
   - Encode change: must never look worse; banding/blocking in grass gradients should improve. Metrics roughly flat (encode differences barely move LPIPS) — human check is the judge.
   - Denoise: pick the strength that wins the blind A/B on far clips WITHOUT waxy over-smoothing on near clips. If both strengths lose on near clips but win on far, note it — T4740's crop-size routing can apply denoise only to far crops; record the finding in the Progress Log and ship encode-only.
4. [ ] **Apply to production** (`video_processing.py`):
   - Image build: add wdn weight download.
   - `_get_realesrgan_model`: DNI wiring with `DENOISE_STRENGTH` module constant set to the winning value (`0.0` = pure base model if denoise lost).
   - All final-encode branches + `_build_simple_ffmpeg_cmd`: `-crf 18 -preset medium` + the four bt709 tag args (copy strings from `video_encoder.py:789-792`).
   - Grep check: `grep -n "crf" video_processing.py` — every final branch updated, chunk branch untouched.
5. [ ] **Deploy + verify**: `modal deploy` (image rebuild pulls wdn weight), run one staging export end-to-end, `ffprobe` the output: confirms `color_space=bt709` and the new encode settings. Verify chunk path still works (export a >10s clip to trigger the parallel path).

### Progress Log

**2026-07-03**: Task created. Not started.

## Acceptance Criteria

- [ ] Testbed report for the variant matrix committed under `sr_testbed/baseline/` (metrics JSON + one-paragraph findings in this file)
- [ ] DNI direction verified empirically before the matrix run
- [ ] Production final encodes: CRF 18, preset medium, bt709 tags; chunks unchanged; `ffprobe` on a staging export confirms
- [ ] `DENOISE_STRENGTH` constant set from evidence (0.0 acceptable if denoise lost — record why)
- [ ] Modal image contains the wdn weight; cold-start still works (no runtime download)
- [ ] Backend tests pass; one full staging export verified end-to-end
