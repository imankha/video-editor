# T4730: Temporal VSR Prototype (FlashVSR / SeedVR2)

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-07-03
**Updated:** 2026-07-03

## Problem

Per-frame GAN upscaling has an information ceiling: a far-side player is 30-80 px tall and a single frame does not contain their face or jersey number, so no single-frame model — however good — can render them well. Temporal VSR models aggregate sub-pixel information across neighboring frames of the moving subject, which is genuine detail recovery for exactly our failure case, and they remove frame-to-frame flicker as a side effect. This is the epic's headline bet (see [EPIC.md](EPIC.md) "Why temporal VSR is the headline bet"). We need to know: does it actually beat our pipeline on OUR footage, does it hallucinate, and what does it cost?

## Solution

Wrap FlashVSR v1.1 (primary) and SeedVR2-3B (secondary) as testbed pipelines running on Modal L40S, run the full eval, and deliver a go/no-go against the EPIC decision gate (design decision #3): >= 70% far-side blind-A/B wins, no near-side regression, zero identity hallucinations, <= $0.15 and <= 3x wall-clock per 10s clip. Evaluation only — production integration is T4740.

## Context

### Relevant Files (REQUIRED)

- `src/backend/experiments/sr_testbed/pipelines/vsr_flashvsr.py` — NEW
- `src/backend/experiments/sr_testbed/pipelines/vsr_seedvr2.py` — NEW (only if FlashVSR fails the gate or its setup dead-ends; see step 8)
- `src/backend/experiments/sr_testbed/modal_runner.py` — extended: `gpu="L40S"`, a second Modal image for VSR deps, and a Modal Volume for weights
- READ-ONLY: `src/backend/app/modal_functions/video_processing.py` (the generator/progress contract T4740 will need — skim it so the pipeline's inputs/outputs stay compatible)

### Related Tasks
- Depends on: T4700 (testbed + hallucination checklist), T4710 (compare against post-quick-wins prod)
- Blocks: T4740 (integration needs this task's go/no-go and winning config)
- See [EPIC.md](EPIC.md) for model links, speed claims, and the decision gate — don't restate them, cite them.

### Technical Notes

- **Input to the VSR model is the CROPPED LR video** (crop-first, same as prod — see EPIC "Current Production Pipeline"). Build the cropped clip with the shared testbed helpers (identical Catmull-Rom interpolation), write it as a lossless intermediate (`-c:v libx264 -crf 0` or PNG sequence, whatever the model's loader wants), VSR it 4x, then LANCZOS-conform to target and encode with prod flags. Only the middle step differs from `current_prod`.
- **FlashVSR setup** ([repo](https://github.com/OpenImagingLab/FlashVSR), v1.1): clone into the Modal image, weights from the repo's HuggingFace links into a **Modal Volume** (multi-GB — do NOT bake into the image; mount the volume and download-once with a guard file). Check the repo's README for the exact torch/CUDA pins and whether it needs a sparse-attention extra (e.g. Block-Sparse-Attention) — build these into the image, expect some iteration. [FlashVSR-Pro](https://github.com/LujiaJin/FlashVSR-Pro) is a production-hardened fork with Docker + low-VRAM tiling; read its Dockerfile for a known-good dependency set even if we use the official repo.
- **SeedVR2 setup** ([repo](https://github.com/IceClear/SeedVR2)): use the official inference scripts (NOT the ComfyUI port), 3B variant, fp16. Community data: 3B runs on 12-24 GB VRAM comfortably — L40S (48 GB) is safe.
- **GPU choice: L40S** (~$1.95/hr on Modal). A100-40GB is the fallback if either model's kernels demand Ampere+ features that misbehave on Ada — note which was used in results. Budget check: FlashVSR's claimed ~17 fps at 768x1408 on A100 → a 10s/30fps clip in well under a minute → a few cents. SeedVR2 at ~8s per output-second → ~80s GPU → ~$0.05. Both inside the gate on paper; measure for real.
- **Resolution sweet spot:** diffusion VSR models have preferred operating resolutions (FlashVSR trains around ~768-1408-class sizes). Our LR crops are ~206x366 → 4x = 824x1464, right in range. If a model wants dimension multiples (of 8/16/32), pad the LR input symmetrically and crop the output back — never squash-resize the input.
- **Long clips / VRAM:** if a 300+ frame sequence OOMs, process in overlapping windows (e.g. 64 frames, 8-frame overlap, discard overlap halves at joins) — FlashVSR is streaming-native so this mainly applies to SeedVR2. Note any window seams in the report.
- **Determinism:** fix all seeds (`torch.manual_seed(0)`) so reruns are comparable. One-step models have no sampler schedule to tune — config surface is small; keep every knob at repo defaults for the first run and record them.
- **Licensing:** record each repo's license in the pipeline docstring (FlashVSR and SeedVR2 have research-oriented licenses — flag anything that restricts commercial use in the go/no-go so the user can rule on it BEFORE T4740 builds on it).

## Implementation

### Steps

1. [ ] **Modal VSR image + volume.** Extend `modal_runner.py`: a second `modal.Image` for VSR deps (separate from the realesrgan image — their torch pins conflict), a `modal.Volume` "sr-testbed-weights" with a `download_weights_flashvsr()` one-shot function, `gpu="L40S"`, `timeout=1800`.
2. [ ] **Get official FlashVSR inference running on ONE cropped clip** end-to-end (repo's own demo script, our input). This is the risk-retirement step — expect dependency iteration here; timebox to ~a day of effort before considering the FlashVSR-Pro Dockerfile route.
3. [ ] **Wrap as `vsr_flashvsr.py`** implementing the T4700 `Pipeline` interface (crop → lossless intermediate → FlashVSR 4x → conform → prod encode). `runs_on="modal"`.
4. [ ] **Full eval run:** `vsr_flashvsr` + `current_prod` (post-T4710), all clips, one run ID. Record s/frame, wall-clock, VRAM peak, $/clip alongside quality metrics.
5. [ ] **Hallucination checklist** (defined by T4700's report, EPIC decision #4): for every jersey-number clip, frame-by-frame focus-box comparison — numbers must match the source on ALL checklist frames; faces must not be invented. One clear fabrication = automatic FAIL of the gate for that model, regardless of prettiness.
6. [ ] **Blind A/B** on far-side clips (the >= 70% mechanic) + near-side regression check + flicker ratio (expect <= 1.0; a VSR that flickers is misconfigured — investigate before concluding).
7. [ ] **Go/no-go write-up** in this file: gate-by-gate verdict (win rate, hallucination, cost, wall-clock, license), the winning config frozen (weights version, window size, seeds, GPU), and open risks for T4740.
8. [ ] **SeedVR2 arm — only if needed:** if FlashVSR fails on quality (not on setup), repeat steps 2-7 with `vsr_seedvr2.py`. If FlashVSR fails on *setup* after the timebox, try SeedVR2 first instead — it has more community deployment mileage. If BOTH fail the gate, write the negative result honestly: the epic falls back to T4720's best GAN + T4750 fine-tuning.

### Progress Log

**2026-07-03**: Task created. Not started.

## Acceptance Criteria

- [ ] FlashVSR (and SeedVR2 if exercised) runs the full clip set on Modal via the testbed CLI, reproducibly (fixed seeds, frozen config recorded)
- [ ] Same-run comparison vs post-T4710 prod pipeline; report committed (metrics JSON + findings here)
- [ ] Hallucination checklist executed on every jersey clip; verdict recorded per clip
- [ ] Measured $/10s-clip and wall-clock vs the gate's <= $0.15 / <= 3x budgets
- [ ] License review recorded for any model recommended for integration
- [ ] Explicit go/no-go against ALL gate criteria in EPIC decision #3, with numbers
