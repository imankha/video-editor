# Upscale Quality Epic

**Status:** TODO
**Started:** —
**Created:** 2026-07-03

## Goal

Make far-side-of-field action look good after AI upscaling. Today, footage from Trace/Veo cameras produces far-side crops of ~206x366 px that are smeared by digital zoom, panoramic stitching, and heavy H.264 compression. Our per-frame Real-ESRGAN pipeline sharpens what's there but cannot recover detail that a single frame doesn't contain. This epic (1) builds a testbed that can PROVE quality changes before they touch the app, (2) harvests the cheap wins already sitting in the pipeline, and (3) evaluates temporal video super-resolution (VSR) — the only technique that genuinely raises the far-side quality ceiling, because it aggregates sub-pixel information across neighboring frames.

## The Prime Directive: Testbed First

**No quality change ships to the app without a testbed run proving it.** Every model swap, encode change, or filter addition is first expressed as a testbed pipeline, run against the standard clip set, and evaluated on the standard report. "It looked better on the one clip I tried" is not evidence. This is the whole reason T4700 exists and is ordered first.

## Current Production Pipeline (ground truth, verified 2026-07-03)

All in `src/backend/app/modal_functions/video_processing.py`:

- **Model:** `realesr-general-x4v3` — `SRVGGNetCompact` (the *compact/fast* tier of Real-ESRGAN, not the quality tier). Loaded in `_get_realesrgan_model()` (~line 1076): `RealESRGANer(scale=4, tile=0, tile_pad=10, pre_pad=0, half=True)`, `dni_weight=None` (denoise blend unused).
- **Flow (in `process_clips_ai`, ~line 2393):** decode frame (cv2) → interpolate crop rect (Catmull-Rom, `_interpolate_crop` ~line 1117) → crop → `enhance(cropped, outscale=4)` → `cv2.resize(..., INTER_LANCZOS4)` to target → PNG → ffmpeg.
- **No pre/post filters** in the Modal path (A/B testing found them useless at extreme scales — see `docs/REFERENCE/SR_MODEL_TESTING.md`).
- **Encode:** final output `libx264 -crf 23 -preset fast`, intermediate parallel chunks `-crf 18`. **No bt709 color tags** (the local path sets them in `video_encoder.py:789-792`; Modal doesn't).
- **GPU:** T4, ~1.47 fps (~681 ms/frame, E6 benchmark). 10s clip @ 30fps ≈ 204 GPU-seconds ≈ $0.03.
- **Target resolution:** `calculate_multi_clip_resolution` (`multi_clip.py:901-964`): min crop x 4, conform to aspect, cap 2560x1440. Default 9:16 output 810x1440. Default 9:16 crop is 205x365 (`useCrop.js:17-20`).
- **The far-side gap:** a 206x366 crop needs ~5.2x to reach 1080x1920; the model does 4x and Lanczos stretches the rest.

A richer local module exists (`src/backend/app/ai_upscaler/` — SwinIR/HAT backends, adaptive filters) but is NOT on the production hot path. Do not confuse it with production.

## Design Decisions (reference these from task files, don't duplicate)

1. **Testbed lives at `src/backend/experiments/sr_testbed/`** — follows the existing `src/backend/experiments/` pattern (e1/e3/e6/e7 benchmark scripts). Standalone: no FastAPI app, no frontend, no per-user DB. Runs locally (CPU/mock or CUDA) and on Modal for GPU pipelines.
2. **Two evaluation tracks:**
   - **Synthetic track (ground truth exists):** take sharp near-side HR crops, synthetically degrade them (downscale + H.264 recompress) to far-side-like LR, upscale, compare to the original with PSNR / SSIM / LPIPS.
   - **Real track (no ground truth):** actual far-side clips scored with no-reference metrics (MUSIQ, NIQE via `pyiqa`) + a temporal flicker ratio + **human side-by-side in an HTML report**. Human eval is the final gate; metrics are tie-breakers and regression tripwires.
3. **Decision gate for shipping any new pipeline to the app (T4740):**
   - Wins the human side-by-side on **>= 70% of far-side clips** vs current production.
   - **No regression** on near-side clips.
   - **No identity hallucination**: jersey numbers must match the source on every checklist frame; faces must not be invented/altered (kids' videos — this is a hard gate, see below).
   - **Cost <= $0.15 per 10-second clip** and wall-clock <= 3x current.
4. **Hallucination policy:** diffusion upscalers can invent detail. One-step adversarial models (SeedVR2, FlashVSR) hallucinate far less than multi-step ones (SUPIR), which is why we evaluate those two and not SUPIR. Every VSR eval must include the jersey-number/face checklist (T4700 defines it).
5. **Test media is never committed to git.** `clips/` and `runs/` are gitignored; only `manifest.json`, code, and small metrics JSON are committed. Test clips come from our own accounts' footage only.
6. **Eval criteria inherit from `docs/REFERENCE/SR_MODEL_TESTING.md`:** jersey numbers, jersey patterns, player edges (halo artifacts), grass texture, motion blur handling.

## Why temporal VSR is the headline bet

Per-frame GANs are information-limited: a far-side player is 30-80 px tall and one frame simply doesn't contain a face or a jersey number. Temporal models fuse many slightly-offset observations of the same moving subject into recovered detail, and they eliminate frame-to-frame flicker as a side effect. Candidates (researched 2026-07-03):

| Model | Type | Speed | Notes |
|---|---|---|---|
| [FlashVSR v1.1](https://github.com/OpenImagingLab/FlashVSR) (CVPR 2026) | one-step diffusion, streaming | ~17 fps @ 768x1408 on A100 | ~10x faster than our current T4 throughput; [FlashVSR-Pro](https://github.com/LujiaJin/FlashVSR-Pro) has Docker/NVENC/low-VRAM tiling |
| [SeedVR2 3B](https://github.com/ByteDance-Seed/SeedVR) (ICLR 2026) | one-step diffusion, adversarial post-training | ~8s compute per output-second on hosted infra | highest quality in community comparisons (at/above Topaz) |

## Tasks (implement strictly in order — each builds on the last)

| ID | Task | Status |
|----|------|--------|
| T4700 | [SR Quality Testbed](T4700-sr-quality-testbed.md) | TODO |
| T4710 | [Encode + Denoise Quick Wins](T4710-encode-denoise-quick-wins.md) | TODO |
| T4720 | [GAN Model A/B Evaluation](T4720-gan-model-ab-evaluation.md) | TODO |
| T4730 | [Temporal VSR Prototype (FlashVSR / SeedVR2)](T4730-temporal-vsr-prototype.md) | TODO |
| T4740 | [Production Integration + Crop-Size Routing](T4740-production-integration-routing.md) | TODO |
| T4750 | [Domain Fine-Tuning (conditional)](T4750-domain-finetune.md) | TODO |

Overlap map (what's shared vs. new per task):

| Concern | T4720 (GAN A/B) | T4730 (VSR) |
|---|---|---|
| Runs inside testbed | yes (new `Pipeline` subclasses) | yes (new `Pipeline` subclass) |
| Modal GPU runner | reuses T4700's `modal_runner.py` on T4/L4 | reuses same runner on L40S |
| Metrics/report | unchanged, reuse | unchanged, reuse + hallucination checklist |
| New dependencies | `spandrel` (arch auto-loader) | FlashVSR / SeedVR2 repos + weights |
| Output | model recommendation table | go/no-go vs decision gate |

## Completion Criteria

- [ ] Testbed exists, documented, with committed baseline metrics for the current prod pipeline
- [ ] Quick wins (encode, color tags, denoise blend) proven in testbed and deployed
- [ ] GAN A/B report produced with a clear recommendation
- [ ] VSR prototype evaluated against the decision gate with a go/no-go
- [ ] If "go": VSR (or winning GAN) integrated behind crop-size routing + feature flag, on staging
- [ ] Fine-tuning task re-scoped or closed based on VSR results

## References

- `docs/REFERENCE/SR_MODEL_TESTING.md` — prior model testing notes + eval criteria
- `docs/REFERENCE/AI-UPSCALING.md` — pipeline reference doc
- `src/backend/experiments/` — existing benchmark script patterns (e6 = L4 benchmark)
- Research links: [SeedVR2 paper](https://arxiv.org/abs/2506.05301) · [FlashVSR paper](https://arxiv.org/abs/2510.12747) · [Real-ESRGAN training/finetune docs](https://github.com/xinntao/Real-ESRGAN/blob/master/docs/Training.md) · [SR improves football detection +12% mAP](https://arxiv.org/abs/2402.00163) · [Football broadcast diffusion upscaler](https://www.nature.com/articles/s41598-025-31543-8)
