# T4740: Production Integration + Crop-Size Routing

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-07-03
**Updated:** 2026-07-03

## Problem

Once T4720/T4730 name a winning upscaler, it has to reach users without (a) multiplying GPU cost on clips that don't need it, or (b) destabilizing the export path (export = the monetization core; see T4200's durability history). Near-side clips look fine on the cheap pipeline; only small crops need the heavy one.

## Solution

A new Modal function for the winning pipeline + **crop-size routing**: exports whose minimum crop is below a threshold go to the heavy pipeline, everything else stays on the current one. Feature-flagged, staging-first, with cost telemetry. Prerequisite: the T4730 (or T4720) go decision and its frozen config.

## Context

### Relevant Files (REQUIRED)

- `src/backend/app/modal_functions/video_processing.py` — NEW function `process_clips_vsr` (name it for the actual winner); image/volume defs for its deps
- `src/backend/app/services/modal_client.py` — routing in `call_modal_clips_ai` (~line 784) and `call_modal_framing_ai` (~489)
- `src/backend/app/services/multi_clip.py` — `calculate_multi_clip_resolution` (~901-964) already computes min-crop; expose/reuse it for routing, don't recompute
- `src/backend/app/constants.py` — `FAR_SIDE_CROP_THRESHOLD` + flag plumbing (near `AI_UPSCALE_FACTOR`, ~266-270)
- `src/backend/app/routers/exports.py` / `framing.py` — read-only unless progress semantics need a tweak
- Tests: `src/backend/tests/` — routing unit tests; E2E untouched (`test_mode` bypasses Modal entirely, `modal_client.py:~537`)

### Related Tasks
- Depends on: T4730 go/no-go (and T4720's recommendation — if the winner is a GAN, this task ships that instead; same routing shape)
- Reuses: T4700's frozen pipeline config; the scratch-extract/encode/audio scaffolding already in `process_clips_ai`
- See [EPIC.md](EPIC.md) decision gate — this task only starts after a "go".

### Technical Notes

- **Match the generator contract exactly.** `process_clips_ai` is a Modal generator streaming progress dicts consumed by `call_modal_clips_ai` (`.remote_gen()`); the recovery path (exports.py) and WS progress depend on the message shape. The new function must yield the same shapes. Copy `process_clips_ai`'s skeleton: presigned-URL scratch-extract (`-ss/-to -c copy`, NEVER `cv2.VideoCapture` on the URL — comment at ~2527), crop interpolation, audio mux, encode. Only the upscale core differs.
- **Routing decision is data already in hand:** min crop across clips (the same value `calculate_multi_clip_resolution` uses at `multi_clip.py:923-930`). Route in `modal_client`, not in the Modal function: `if VSR_ENABLED and min_crop_w < FAR_SIDE_CROP_THRESHOLD: → heavy path`. Start `FAR_SIDE_CROP_THRESHOLD = 300` (default 9:16 crop is 205 wide → default crops route heavy; a user who zooms out goes cheap). The threshold is a constant, not per-user config.
- **Feature flag:** `VSR_ENABLED` env var read the same way `MODAL_ENABLED` is (`modal_client.py:~327`), default false. Deploys dark, flips on staging first.
- **Failure fallback IS allowed here** (external dependency rule): if the heavy function raises, log loudly and retry the export on the standard pipeline rather than failing the user's paid export. This is a deliberate, logged degradation — not a silent fallback; the log line must say which pipeline produced the output.
- **T4710's denoise finding:** if denoise won on far clips only, the routed heavy/far path is where a nonzero `DENOISE_STRENGTH` belongs (or the VSR model makes it moot — check the T4730 notes).
- **Cost telemetry:** log `{export_id, pipeline, gpu_type, gpu_seconds, frames}` at completion on both paths — we need real cost distribution before prod flip. Grep-able tag: `[UPSCALE_COST]`.
- **Chunk-parallel interaction:** `process_framing_ai_parallel` splits long clips across T4s (`FRAMING_AI_GPU_THRESHOLDS`, thresholds at `modal_client.py:412-416`). For v1, the heavy path runs UNCHUNKED on its bigger GPU (it's ~10x faster per frame; chunking adds seam risk for temporal models — window overlap details in T4730 notes). Guard: if clip duration > the function timeout budget, fall back to the standard path and log.
- **Speed changes (slow-mo segments):** `process_clips_ai` applies segment speed filters at encode. Keep that logic identical; VSR sees the un-retimed frames.

## Implementation

### Steps

1. [ ] Pre-flight: confirm the go decision + frozen config from T4730 (or T4720) is written in its task file. Do not start without it.
2. [ ] Port the winning testbed pipeline into `process_clips_vsr` in `video_processing.py`: new image + weights volume (reuse the T4730 Modal defs), `gpu="L40S"`, generator contract cloned from `process_clips_ai`, encode with the T4710 flags.
3. [ ] Routing in `modal_client.call_modal_clips_ai` + `call_modal_framing_ai` behind `VSR_ENABLED` + `FAR_SIDE_CROP_THRESHOLD`. Single-clip and multi-clip both route; `test_mode` and local (`MODAL_ENABLED=false`) paths untouched.
4. [ ] Deliberate-fallback wrapper + `[UPSCALE_COST]` telemetry on both paths.
5. [ ] Unit tests: routing decision (crop above/below threshold, flag off, flag on), fallback-on-heavy-failure marks the right pipeline in the result. Follow `tests/` patterns; no live Modal calls in tests.
6. [ ] Update the comparison endpoint (`/api/export/upscale-comparison`) to include the new pipeline as an option, so in-app spot checks are possible.
7. [ ] Staging: flag on, export a real far-side clip AND a near-side clip; verify routing via logs; eyeball outputs; confirm export recovery still works (kill the tab mid-export, recover).
8. [ ] Watch staging cost telemetry across a handful of organic exports; write the observed $/clip into this file; leave prod flip to the user (deploy gesture per CLAUDE.md status rules).

### Progress Log

**2026-07-03**: Task created. Not started. BLOCKED until T4730 records a "go".

## Acceptance Criteria

- [ ] Heavy pipeline runs as a Modal function with the identical progress-generator contract (recovery + WS progress verified on staging)
- [ ] Routing by min-crop threshold, flag-gated, default off; near-side clips demonstrably stay on the cheap path (log-verified)
- [ ] Heavy-path failure degrades to standard pipeline with a loud log naming the substitution — never a failed user export
- [ ] `[UPSCALE_COST]` telemetry on both paths; observed staging $/clip recorded here
- [ ] Routing unit tests pass; E2E suite unaffected
- [ ] Comparison endpoint offers the new pipeline
