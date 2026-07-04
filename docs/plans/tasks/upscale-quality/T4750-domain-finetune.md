# T4750: Domain Fine-Tuning (conditional)

**Status:** TODO
**Impact:** 7
**Complexity:** 8
**Created:** 2026-07-03
**Updated:** 2026-07-03

> **CONDITIONAL TASK.** Only start if the T4730/T4740 outcome leaves a named quality gap (e.g. "jersey numbers still unreadable on clips shorter than X", "far-side faces still mushy"). If off-the-shelf VSR passed the gate comfortably, close this task as not-needed. The trigger condition and the gap must be written below before any implementation.

## Problem

Off-the-shelf SR models are trained on generic degradations. Our degradation is specific and consistent: Trace/Veo panoramic stitch + digital zoom + aggressive H.264, on one visual domain (grass, kits, small fast humans). Domain-matched fine-tuning is where published work gets its largest gains — e.g. a diffusion pipeline fine-tuned for football broadcast recovered player details from 64x64 crops ([Nature Sci Reports 2025](https://www.nature.com/articles/s41598-025-31543-8)), and SR tuned for football improved detection mAP +12% ([arXiv 2402.00163](https://arxiv.org/abs/2402.00163)). We are uniquely positioned: our users' near-side footage is a large in-domain HR corpus.

## Solution

Build an HR/LR paired dataset from our own footage (HR = sharp near-side player crops; LR = synthetically degraded with a Veo/Trace-matched degradation), fine-tune the incumbent production model from T4740 (LoRA/adapter if it's a VSR; full fine-tune via the official Real-ESRGAN recipe if it's a GAN), and prove the delta in the testbed like every other pipeline.

## Context

### Relevant Files (REQUIRED)

- `src/backend/experiments/sr_testbed/finetune/` — NEW: `build_dataset.py`, `degradation_config.yml`, training launcher, README
- `src/backend/experiments/sr_testbed/pipelines/` — NEW pipeline wrapping the fine-tuned checkpoint
- READ-ONLY: `sr_testbed/degrade.py` (T4700's synthetic degradation — the dataset builder generalizes it), YOLO detection functions in `src/backend/app/modal_functions/video_processing.py` (`detect_players_*`, model cached at ~783) for automated player-crop harvesting

### Related Tasks
- Depends on: T4740 (fine-tune the model that actually shipped; blocked until then)
- Reuses: T4700 metrics/report as the proof mechanism; T4730's Modal image/volume if the incumbent is a VSR
- See [EPIC.md](EPIC.md) decisions #5 (media handling) and #3 (the same gate applies to the fine-tuned model vs its own base).

### Technical Notes

- **Data consent boundary (hard rule):** training data comes ONLY from our own/test accounts' footage (imankh, sarkarati-test class accounts) unless the user explicitly approves a broader source. Users' kids' footage is sensitive; do not scrape the general user base. Dataset lives in private R2 (`testbed/finetune-dataset/`) or local disk — never in git, never in a public bucket.
- **HR harvesting:** run YOLO player detection over near-side segments, take detections taller than ~250 px, expand boxes ~40%, filter blur (Laplacian variance threshold — tune by eye on ~50 samples) and near-duplicates (frame stride >= 5). Target 5-20k crops. Keep full-frame context crops too (grass/lines matter for texture learning, not just player chips).
- **Degradation model is the whole game.** Extend T4700's `degrade.py` into a configurable pipeline: downscale 3-5x (random per sample) → mild gaussian/motion blur → H.264 round-trip at CRF 28-38 (random) → optional slight chroma subsampling noise. Validate it the honest way: degrade held-out near-side crops and visually confirm they're indistinguishable from REAL far-side crops in a blind shuffle (put 20 real + 20 synthetic in a folder, try to sort them; if you can sort them, the degradation is wrong — iterate before burning GPU hours).
- **Recipes:**
  - GAN incumbent: official [Real-ESRGAN fine-tune flow](https://github.com/xinntao/Real-ESRGAN/blob/master/docs/Training.md) — the paired-data mode with our LR/HR pairs (we have a better-than-synthetic degradation, so paired beats on-the-fly), starting from the shipped checkpoint, low LR (1e-4), 100-200k iters, checkpoints every 10k.
  - VSR incumbent: LoRA/adapter route on the restoration backbone; check the repo's issues/discussions for existing fine-tune scripts before writing any (SeedVR2 and FlashVSR both have community fine-tune threads).
- **Training compute:** Modal with a persisted Volume for dataset + checkpoints; A100-80GB class for VSR LoRA, L40S fine for GAN fine-tune. Estimate and record $ before launching; get user sign-off if a run exceeds ~$100.
- **Overfitting tripwire:** hold out 15% of clips (by GAME, not by frame — frames from one game are near-duplicates), and keep a general-domain sanity clip (non-soccer) in the eval to catch catastrophic domain collapse.

## Implementation

### Steps

1. [ ] Write the trigger: quote the specific quality gap from T4730/T4740 results here. If none exists, close the task now.
2. [ ] `build_dataset.py`: harvest → filter → degrade → LR/HR pairs manifest (game-level split baked into the manifest).
3. [ ] Degradation realism blind-sort check (Technical Notes) — do not proceed past it until synthetic ≈ real.
4. [ ] Fine-tune per the incumbent's recipe; log losses; snapshot checkpoints to the Volume.
5. [ ] Wrap best checkpoint as a testbed pipeline; full eval vs the incumbent base model (same run).
6. [ ] Apply the EPIC gate (hallucination checklist ESPECIALLY — fine-tuning on player data raises the identity-invention stakes; a model that draws *plausible* wrong jersey numbers is worse than a blurry one).
7. [ ] If it wins: ship the checkpoint via T4740's existing function (weights swap in the Volume + config bump), staging-first. If it loses: record the negative result and the config tried.

### Progress Log

**2026-07-03**: Task created as conditional/backlog. Gated on T4730/T4740 outcome.

## Acceptance Criteria

- [ ] Trigger condition documented (or task closed as not-needed)
- [ ] Dataset built exclusively from approved accounts; stored privately; game-level train/holdout split
- [ ] Degradation passes the blind-sort realism check
- [ ] Fine-tuned model evaluated in the testbed vs its base, same run, gate applied (hallucination checklist mandatory)
- [ ] Training cost recorded; >$100 runs pre-approved by user
- [ ] Ship-or-archive decision written with numbers
