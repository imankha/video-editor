# T4720: GAN Model A/B Evaluation

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-03
**Updated:** 2026-07-03

## Problem

Production runs the *compact/fast* tier of Real-ESRGAN (`realesr-general-x4v3`, SRVGGNetCompact). Heavier single-frame models — `RealESRGAN_x4plus` (RRDBNet), SwinIR-GAN, HAT — are expected to be visibly better at extreme scales; our own notes (`docs/REFERENCE/SR_MODEL_TESTING.md` comparison table) estimate exactly that, but those scores were never measured. Backends for these models exist in `src/backend/app/ai_upscaler/model_manager.py` but have never run in production and SwinIR/HAT require manually-vendored architecture files. We need real numbers: quality delta AND cost delta per model, on our clips.

## Solution

Add one testbed pipeline per candidate model, run the full clip set on Modal T4 and L4, and produce a recommendation table (quality vs $/clip). This is evaluation only — no production code changes (that's T4740's job if a GAN wins).

## Context

### Relevant Files (REQUIRED)

- `src/backend/experiments/sr_testbed/pipelines/` — NEW: `gan_x4plus.py`, `gan_swinir.py`, `gan_hat.py` (+ optional `gan_x4plus_dni.py` if T4710 shipped a denoise blend)
- `src/backend/experiments/sr_testbed/modal_runner.py` — reused from T4700, parameterized `gpu="T4"|"L4"`
- READ-ONLY: `src/backend/app/ai_upscaler/model_manager.py` (weight URLs + arch params for each variant, lines ~78-99 for the registry), `docs/REFERENCE/SR_MODEL_TESTING.md`

### Related Tasks
- Depends on: T4700 (testbed), T4710 (compare against the post-quick-wins baseline, and reuse its winning denoise strength as a variant)
- Feeds: T4740 (if a GAN model wins at acceptable cost, it can ship via routing even before/alongside VSR)
- See [EPIC.md](EPIC.md) overlap table for what's shared with T4730.

### Technical Notes

- **Use `spandrel` to load models instead of vendoring arch files.** `spandrel` (the loader ComfyUI uses) auto-detects the architecture from a `.pth`/`.safetensors` checkpoint and returns a callable torch model — this sidesteps the "SwinIR/HAT need manual arch files under `app/ai_upscaler/models/`" problem that left those backends dead. Pipeline shape:
  ```python
  from spandrel import ModelLoader
  model = ModelLoader().load_from_file("weights/RealESRGAN_x4plus.pth").cuda().eval().half()
  with torch.no_grad():
      out = model(lr_tensor)   # NCHW RGB [0,1] — same tensor conventions as metrics.py
  ```
  Keep `RealESRGANer` only for the prod-replica and DNI-blend pipelines (spandrel doesn't do DNI).
- **Candidate weights** (put URLs in each pipeline's docstring):
  - `RealESRGAN_x4plus.pth` — xinntao release v0.1.0 (URL already in `model_manager.py:~80`)
  - SwinIR: `003_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR-L_x4_GAN.pth` (official SwinIR release; the `-L` GAN real-SR variant)
  - HAT: `Real_HAT_GAN_SRx4.pth` (XPixelGroup/HAT releases)
- **Tiling:** RRDBNet/SwinIR/HAT at 4x on a 206x366 input fits easily in T4 16GB — run untiled first; add 512px tiling only if OOM. Log VRAM (`torch.cuda.max_memory_allocated()`) per pipeline — it goes in the recommendation table.
- **Speed measurement:** time ONLY the model forward per frame (exclude decode/encode), plus total wall-clock per clip. Both matter: forward time drives GPU cost; wall-clock drives UX.
- **Cost math for the table:** Modal ballpark $0.59/hr (T4), $0.80/hr (L4). $/10s-clip = `(seconds_per_frame * fps * 10) * hourly / 3600`. Current baseline: ~$0.03 on T4.

## Implementation

### Steps

1. [ ] Add `spandrel` + torch pins to the testbed `requirements.txt` (spandrel needs torch >= 2.x; it does NOT need basicsr, so it escapes the torchvision pin — but the prod-replica pipeline still needs the old pins; document which venv/env runs which pipeline in README, or use spandrel-only in a second Modal image).
2. [ ] Write the three pipelines. They differ from `current_prod` ONLY in the "upscale one frame" step (shared helpers from `pipelines/shared.py` do crop/encode). Outscale is 4x for all; keep the LANCZOS conform step identical.
3. [ ] Weight download helper: `python download_weights.py --models x4plus,swinir,hat` → `weights/` (gitignored). Verify sha256 of each file and hard-fail on mismatch (no silent fallback).
4. [ ] Local CUDA smoke test on 1 clip per pipeline (or CPU with `half=False` if no local GPU — expect minutes/frame, it's just a correctness check).
5. [ ] Full run on Modal: every pipeline x every clip on **T4**, then repeat timing-only (2 clips) on **L4**. Include `current_prod` (post-T4710 flags) in the same run so the comparison is same-run, same-clips.
6. [ ] Produce the recommendation table in this task file (Progress Log) and in the run report:
   | Model | LPIPS (synth) | MUSIQ (far) | Flicker | Blind-A/B win % vs prod | s/frame T4 | $/10s clip | VRAM |
7. [ ] Write the recommendation: which model (if any) justifies its cost for far clips, and whether it should ship via T4740 routing or wait for the T4730 VSR verdict. A "no GAN upgrade is worth it, wait for VSR" outcome is a valid result — say it explicitly with the numbers.

### Progress Log

**2026-07-03**: Task created. Not started.

## Acceptance Criteria

- [ ] All three heavy-GAN pipelines run the full clip set on Modal T4 without manual babysitting
- [ ] Same-run comparison includes the current prod pipeline (post-T4710)
- [ ] Recommendation table filled with measured (not estimated) numbers, including $/clip and VRAM
- [ ] Blind A/B (human) completed for far-side clips; win rates recorded
- [ ] Written recommendation in this file: ship-via-T4740 / wait-for-VSR / no-change, with reasoning
- [ ] Weight downloads sha256-verified; no test media or weights committed
