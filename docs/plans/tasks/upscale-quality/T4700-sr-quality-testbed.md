# T4700: SR Quality Testbed

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-07-03
**Updated:** 2026-07-03

## Problem

We have no reproducible way to answer "is pipeline B better than pipeline A?" for upscale quality. The prior model comparison (`docs/REFERENCE/SR_MODEL_TESTING.md` scores) was estimates, and the in-app comparison endpoint (`/api/export/upscale-comparison`) requires the whole app running and a manually-set-up project. Result: quality decisions are made on gut feel from single clips, and the far-side problem (see [EPIC.md](EPIC.md)) has never been measured. Every subsequent task in this epic is blocked on this one.

## Solution

A standalone evaluation harness at `src/backend/experiments/sr_testbed/`: a fixed set of real test clips + a `Pipeline` plug-in interface + automated metrics + a self-contained HTML side-by-side report. One command runs N pipelines over the clip set and emits a report a human can judge in 10 minutes. See [EPIC.md](EPIC.md) design decisions #1, #2, #5, #6 — do not re-decide those here.

## Context

### Relevant Files (REQUIRED)

All NEW files (nothing in the app changes):
- `src/backend/experiments/sr_testbed/README.md` — how to add clips/pipelines, how to run
- `src/backend/experiments/sr_testbed/manifest.json` — committed clip metadata
- `src/backend/experiments/sr_testbed/pipelines/base.py` — `Pipeline` interface
- `src/backend/experiments/sr_testbed/pipelines/current_prod.py` — exact replica of production
- `src/backend/experiments/sr_testbed/pipelines/lanczos_only.py` — no-AI baseline
- `src/backend/experiments/sr_testbed/degrade.py` — synthetic LR generator
- `src/backend/experiments/sr_testbed/metrics.py` — PSNR/SSIM/LPIPS/MUSIQ/NIQE + flicker
- `src/backend/experiments/sr_testbed/run_eval.py` — CLI entry point
- `src/backend/experiments/sr_testbed/report.py` — HTML report generator
- `src/backend/experiments/sr_testbed/modal_runner.py` — generic Modal GPU wrapper
- `src/backend/experiments/sr_testbed/.gitignore` — ignores `clips/`, `runs/`, `weights/`

READ-ONLY references (replicate logic, don't import the Modal app):
- `src/backend/app/modal_functions/video_processing.py` — `_get_realesrgan_model` (~1076), `_interpolate_crop` (~1117), `process_clips_ai` frame loop (~2583-2649), encode flags (~2745-2792)
- `src/backend/experiments/e6_l4_benchmark.py` — existing Modal benchmark pattern to copy
- `docs/REFERENCE/SR_MODEL_TESTING.md` — eval criteria

### Related Tasks
- Blocks: T4710, T4720, T4730 (they all add pipelines to this harness)
- See [EPIC.md](EPIC.md) for the production-pipeline ground truth and design decisions.

### Technical Notes

- **Python env:** use the backend venv (`src/backend/.venv`). New deps go in a testbed-local `requirements.txt` (do NOT add torch/pyiqa to the app's main requirements — they're eval-only): `torch`, `opencv-python`, `pyiqa`, `numpy`.
- **`pyiqa` gives PSNR, SSIM, LPIPS, MUSIQ, NIQE behind one API** (`pyiqa.create_metric('lpips')` etc.), which avoids hand-rolling metrics. It expects RGB float tensors in [0,1], NCHW. OpenCV reads BGR uint8 — you MUST convert (`cv2.cvtColor(f, cv2.COLOR_BGR2RGB)`, then `torch.from_numpy(...).permute(2,0,1).float()/255`). Getting BGR/RGB wrong silently skews LPIPS/MUSIQ; add a unit check comparing a solid-red frame's channel order.
- **basicsr pin gotcha (from prod):** `basicsr==1.4.2` imports `torchvision.transforms.functional_tensor`, removed in torchvision 0.17+. The prod image pins `torch==2.1.0 torchvision==0.16.0` (see `video_processing.py` image build ~lines 64-83). Use the same pins wherever `realesrgan`/`basicsr` is imported.
- **fp16 (`half=True`) requires CUDA.** The `current_prod` pipeline must take a `device` arg and use `half=(device=='cuda')` so it can smoke-test on CPU (slow but correct).

## Implementation

### Steps

1. [ ] **Scaffold the directory** (layout above) + `.gitignore` with `clips/`, `runs/`, `weights/`. Committed artifacts are code, `manifest.json`, `README.md`, and small metrics JSONs only (EPIC decision #5).

2. [ ] **Curate the clip set (10-12 clips).** Source: our own accounts' game footage (imankh dev/prod). Extract with stream-copy so source pixels are untouched:
   ```bash
   ffmpeg -ss 00:12:31 -to 00:12:41 -i game.mp4 -c copy clips/far_night_01.mp4
   ```
   Required coverage: >= 5 far-side (player < ~90px tall), 2 mid-field, 2 near-side (these double as HR sources for the synthetic track), 1 low-light/evening, 1 high-motion (sprint/shot). 6-12 seconds each.
   `manifest.json` entry per clip — every field below is required:
   ```json
   {
     "id": "far_night_01",
     "file": "clips/far_night_01.mp4",
     "class": "far",                      // far | mid | near
     "lighting": "night",                 // day | night
     "motion": "high",                    // low | high
     "source_resolution": [1920, 1080],
     "crop_keyframes": [                  // frame-indexed, same shape prod uses
       {"frame": 0,  "x": 1210, "y": 320, "w": 206, "h": 366},
       {"frame": 90, "x": 1400, "y": 300, "w": 206, "h": 366}
     ],
     "target": [810, 1440],
     "focus_box": {"x": 60, "y": 90, "w": 80, "h": 140},  // player region IN CROP coords, for zoomed stills + jersey checklist
     "jersey_number_visible": true,
     "notes": "white #14 receiving on far touchline"
   }
   ```
   To pick `crop_keyframes`, open the clip in any player, find the player, and note the rect — it does not need to be pretty, it needs to be FIXED so every pipeline gets identical input.

3. [ ] **`pipelines/base.py`** — the contract every pipeline implements:
   ```python
   class Pipeline(ABC):
       name: str            # unique, used in report + run dirs
       runs_on: str         # "local" | "modal"

       @abstractmethod
       def process(self, input_video: Path, crop_keyframes: list[dict],
                   target: tuple[int, int], out_path: Path) -> PipelineResult:
           """Decode → crop-per-frame → upscale → encode to out_path.
           Returns PipelineResult(seconds_elapsed, gpu_type, notes)."""
   ```
   Also a shared helper module the pipelines use: frame iteration (cv2), crop interpolation, PNG dump, and the ffmpeg encode call — so pipelines only differ in the "upscale one frame / one sequence" part.

4. [ ] **Port crop interpolation EXACTLY.** Copy `_interpolate_crop` (Catmull-Rom) from `video_processing.py:~1117` into `pipelines/shared.py` with a comment `# copied verbatim from app/modal_functions/video_processing.py _interpolate_crop — keep in sync`. If the crop path differs from prod, every comparison in this epic is invalid. Add a unit test: for a 2-keyframe manifest entry, assert interpolated rects at frames 0/mid/end match hand-computed values.

5. [ ] **`pipelines/current_prod.py`** — faithful replica: `realesr-general-x4v3` weights (download to `weights/`, same release URL as the prod image build), `RealESRGANer(scale=4, tile=0, tile_pad=10, pre_pad=0, half=(device=='cuda'))`, `enhance(cropped, outscale=4)`, `cv2.resize(..., INTER_LANCZOS4)` to target, PNG frames, then ffmpeg with prod's EXACT final-encode flags:
   ```
   ffmpeg -y -framerate {fps} -i frame_%06d.png -c:v libx264 -pix_fmt yuv420p -preset fast -crf 23 -movflags +faststart out.mp4
   ```
   (No audio needed in the testbed — quality eval is visual.)
   **`pipelines/lanczos_only.py`** — identical but the upscale step is just `cv2.resize` to target. This is the "did AI help at all" floor.

6. [ ] **`degrade.py`** — synthetic track generator. Input: a `near` clip + its crop keyframes. Output: (a) `hr/` PNG frames of the crop at native size (ground truth), (b) a degraded LR clip: downscale the crop 4x with `cv2.INTER_AREA`, then round-trip through H.264 to simulate camera compression:
   ```bash
   ffmpeg -y -framerate {fps} -i lr_%06d.png -c:v libx264 -crf 32 -preset veryfast lr.mp4
   ```
   CRF 32 approximates Trace/Veo far-side mush; make it a parameter. Pipelines then upscale `lr.mp4` back to the HR size and metrics compare frame-by-frame against `hr/`.

7. [ ] **`metrics.py`:**
   - Synthetic track: mean PSNR, SSIM, LPIPS over frames (via `pyiqa`).
   - Real track: mean MUSIQ (higher=better), NIQE (lower=better) over output frames.
   - **Flicker ratio** (temporal stability, both tracks): `mean(|out[t+1]-out[t]|) / mean(|in_upscaled_lanczos[t+1]-in_upscaled_lanczos[t]|)` using grayscale float frames. ~1.0 = as stable as the source; per-frame GANs typically score > 1; VSR should score <= 1. Document the formula in README.
   - Output: `runs/{run_id}/metrics.json` keyed by `pipeline -> clip_id -> metric`.

8. [ ] **`run_eval.py`** — CLI:
   ```bash
   python run_eval.py --pipelines current_prod,lanczos_only --clips all --device cuda
   python run_eval.py --pipelines current_prod --clips far_night_01 --device cpu   # smoke test
   ```
   Creates `runs/{YYYYMMDD-HHMMSS}/`, runs each (pipeline, clip), writes outputs + `metrics.json` + `report.html`, prints a summary table. Run IDs are timestamps, not random.

9. [ ] **`report.py`** — self-contained HTML (inline CSS/JS, no CDN):
   - Per clip: side-by-side looping `<video>` elements (one per pipeline, labeled), synced play button.
   - Zoomed stills: crop the `focus_box` from 3 evenly-spaced frames per pipeline, shown at 2-3x, side by side — this is where jersey/face judgment happens.
   - **Blind A/B toggle:** a button that hides pipeline labels and shuffles column order (seeded by clip id), plus radio buttons "prefer left/right/tie" and an export-choices-to-JSON button. This is the >= 70% gate mechanic from EPIC decision #3.
   - Metrics table per clip + aggregate, with the flicker ratio column.
   - **Hallucination checklist section** (EPIC decision #4): for each clip with `jersey_number_visible: true`, show source-vs-output focus-box stills with prompts "Same number? Same face? y/n". This defines the checklist T4730 must pass.

10. [ ] **`modal_runner.py`** — copy the shape of `experiments/e6_l4_benchmark.py`: a small Modal stub app whose function takes `(pipeline_name, clip_bytes, manifest_entry, gpu_type)` and returns output bytes + timing. Parameterize `gpu="T4"|"L4"|"L40S"`. This is what T4720/T4730 reuse — keep pipeline code importable by both local and Modal execution (no `app.` imports from the backend).

11. [ ] **Baseline run + commit.** Run `current_prod` + `lanczos_only` over all clips (Modal T4 or local CUDA). Commit `manifest.json`, code, README, and the baseline `metrics.json` (copy into `baseline/metrics-2026-07.json`). Sanity checks before calling it done: `current_prod` must beat `lanczos_only` on LPIPS/MUSIQ on near/mid clips, and prod's known ~1.47 fps on T4 should roughly reproduce.

### Progress Log

**2026-07-03**: Task created from upscale-quality research (pipeline map + web research). Not started.

## Acceptance Criteria

- [ ] `python run_eval.py --pipelines current_prod,lanczos_only --clips all` completes and emits `report.html` + `metrics.json`
- [ ] Clip set has >= 10 clips meeting the coverage matrix; `manifest.json` committed; media gitignored
- [ ] `current_prod` output is flag-for-flag identical to production (model, tile, half, outscale, LANCZOS conform, encode flags)
- [ ] Report has working blind A/B toggle, zoomed focus-box stills, hallucination checklist, flicker column
- [ ] Baseline metrics JSON committed; README explains adding a clip and adding a pipeline in < 1 page each
- [ ] Crop-interpolation unit test passes; CPU smoke-test mode works
