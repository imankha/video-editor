# T5440: Classical Signal Bake-off (motion vectors / diff / flow + camera compensation)

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-07-19

## Problem

We don't know how far cheap, CPU-only signals get us toward the epic's gates — and cost dominates product viability (a classical-only recipe would land at ~$0.05/game vs $0.30+ with GPU detection). Before spending on detection models, measure what compressed-domain motion vectors, frame differencing, and optical flow (each with camera-motion compensation) actually score on the labeled dataset from T5430. See [EPIC.md](EPIC.md) signal table S1–S3 and camera-reality section.

## Solution

Implement S1–S3 as `Signal` subclasses in the motion testbed, plus a shared camera-motion-compensation module; evaluate each alone and in simple combinations on the dev split; produce a per-signal gate table + cost curve. Cache per-second feature vectors to disk so T5450's fusion work reuses them without re-decoding 12 hours of video.

## Context

### Relevant Files (REQUIRED)
All in `src/backend/experiments/motion_testbed/` (built by T5430):
- `signals/mv_bitstream.py` — S1: motion vectors via PyAV/mv-extractor (ffmpeg `export_mvs` CLI fallback); per-frame aggregate |mv| minus global median
- `signals/frame_diff.py` — S2: downscaled gray `absdiff` + MOG2/KNN variants
- `signals/optical_flow.py` — S3: DIS flow (primary) + Farneback (comparison); residual magnitude after compensation
- `signals/camera_comp.py` — shared global-motion estimation: median-flow and `cv2.estimateAffinePartial2D` on grid features; per-camera-class behavior notes
- `signals/features.py` — per-second feature extraction + npz cache (`runs/features/{game_id}.npz`) with feature-version key
- `run_eval.py` — extended with `--signal` selection
- `README.md` — results summary

### Related Tasks
- Depends on: T5430 (testbed, labels, metrics). Reuse its `Signal` base, metrics, and report unchanged.
- Blocks: T5450 (reads this task's feature cache)

### Technical Notes
- **Sampling**: analyze at 2–5 fps on frames downscaled to ~480 px wide — full-rate full-res is pointless for a per-second signal; measure the accuracy/cost tradeoff at 1, 2, 5 fps.
- **Camera compensation is the experiment**: run every signal with compensation on/off per camera class. Expected: veo-static barely needs it; follow/phone are unusable without it. Report per-class.
- **S1 caveat**: motion vectors depend on encoder settings of uploads; validate across all three camera classes before trusting. If PyAV's MV extraction is painful on Windows, the ffmpeg CLI (`-flags2 +export_mvs` + codecview or ffprobe) is the fallback; note wall-clock.
- **Threshold-free eval first**: G5 (ROC-AUC) is the primary comparison metric per signal; only the best 1–2 signals get a hysteresis decode to attempt G1/G2 solo.
- **Score normalization**: per-game percentile (p5–p95 → 0–255) before any thresholding, per EPIC.md artifact design.
- **Cost curve**: CPU wall-clock per game-hour per signal at each sampling rate, single-threaded and multiprocess. This table feeds T5450's recipe choice and T5460's cost gate.
- Keep everything CPU-only in this task — no Modal, no torch requirement (RAFT quality-reference is optional and may be deferred to T5450's GPU runner).

## Implementation

### Steps
1. [ ] `camera_comp.py` + visual sanity check (render compensated-flow debug video for one game per class)
2. [ ] S2 frame diff (simplest — validates the harness end-to-end against labels)
3. [ ] S3 DIS optical flow + residual scoring
4. [ ] S1 bitstream motion vectors (PyAV; ffmpeg fallback)
5. [ ] Feature cache (`features.py`) writing per-second vectors for ALL signals
6. [ ] Eval matrix: {signal} x {sampling rate} x {compensation on/off} on dev split; report
7. [ ] Best solo signal: hysteresis decode, full gate table on dev split
8. [ ] Write up results + cost curve in README; commit run reports

### Progress Log

**2026-07-19**: Task created.

## Acceptance Criteria

- [ ] All three signal families run via `run_eval.py` and are scored on the dev split
- [ ] Per-camera-class results with compensation on/off reported
- [ ] Feature cache written for all 8 games and documented (T5450 consumes it)
- [ ] Cost curve (wall-clock per game-hour vs sampling rate) committed
- [ ] README states the best solo signal's full gate table and names what's missing vs the gates
