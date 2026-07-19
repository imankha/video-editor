# T5450: Detection Signals + Fusion + Smoothing → Decision Gate

**Status:** TODO
**Impact:** 9
**Complexity:** 7
**Created:** 2026-07-19

## Problem

Classical signals (T5440) measure *pixel* motion; they can't distinguish "22 players sprinting" from "wind in the nets + spectators", and they can't see that the pitch is empty at halftime. Semantic features from player detection/tracking — plus a small learned fusion over ALL features and a temporal decode — is the recipe expected to clear the epic's gates. This task builds it, tunes it on the dev split, and renders the epic's go/no-go verdict on the held-out split. See [EPIC.md](EPIC.md): signals S4–S6, gates G1–G6, asymmetric-tuning decision.

## Solution

Add detection/tracking signals (YOLO + ByteTrack at 1–2 fps sampling), optional audio features, a tiny fusion classifier (logistic regression / LightGBM over per-second feature vectors), and an HMM/hysteresis temporal decode with min-duration constraints. Sweep the operating point to satisfy G1 first, then maximize G2. Final deliverable: a frozen `Recipe` ("fusion-v1") + held-out gate table + Modal cost estimate.

## Context

### Relevant Files (REQUIRED)
In `src/backend/experiments/motion_testbed/`:
- `signals/detection.py` — S4: ultralytics YOLO (start with `yolov8x.pt` — the exact model already baked into our Modal `yolo_image`; also measure `yolov8m` for cost) + built-in ByteTrack; per-second features: on-pitch player count, aggregate track displacement, convex-hull area, centroid speed, cluster-tightness
- `signals/pitch_mask.py` — S4b (conditional): HSV dominant-green mask to exclude off-pitch motion; only if error analysis shows spectator noise
- `signals/audio.py` — S5 (optional): whistle-band (2–4 kHz) energy + RMS via librosa; skip if audio quality across the dataset is junk
- `recipes/fusion.py` — S6: feature assembly (reads T5440's npz cache + this task's detection features), classifier (sklearn LogisticRegression baseline, LightGBM comparison), temporal decode (hysteresis with min-duration; hmmlearn/Viterbi comparison)
- `recipes/fusion_v1.json` — frozen weights + thresholds + feature list of the shipped recipe
- `modal_runner.py` — thin Modal T4 runner for detection over the 8-game set (pattern: sr_testbed's runner; testbed-only app, NOT the production `reel-ballers-video-v2`)
- `README.md` — final report

### Related Tasks
- Depends on: T5430 (labels/metrics), T5440 (feature cache — reuse, don't re-extract classical features)
- Blocks: T5460 (implements fusion-v1 as the production Modal job)

### Technical Notes
- **Tuning discipline**: fit/tune ONLY on the 5 dev games (cross-validate within them — leave-one-game-out, never frame-level splits, or leakage inflates everything). The 3 held-out games are scored exactly once by the final frozen recipe.
- **Keep the fuser tiny**: ~8 games ≈ 40k per-second samples but only ~8 independent games — regularize hard, prefer logistic regression unless LightGBM wins clearly on leave-one-game-out. No deep nets (S7 is out of scope without explicit user sign-off, per EPIC.md decision 4).
- **Temporal decode**: hysteresis (enter-DEAD threshold stricter than exit-DEAD) + min-duration (e.g., no DEAD segment < 5 s, no ACTIVE island < 3 s) is the baseline; compare a 3-state HMM. G6 (flips/min) and G4 (boundary error) arbitrate.
- **EMPTY detection**: primarily player-count-near-zero sustained > 60 s + low classical motion; this is what G3 rides on.
- **Error analysis is a deliverable**: for every G1 violation on dev games (active seconds classed skippable), watch the clip and categorize (far-side play missed by YOLO, counterattack right after restart, compensation failure, label error…). This drives S4b and any feature additions.
- **Detection sampling**: YOLO at 1 fps then 2 fps — report gate deltas vs GPU-cost doubling. Track association across 1 fps gaps is fine for displacement features (we need aggregate motion, not clean identities).
- **Cost estimate for T5460**: GPU-seconds per game-hour at chosen sampling (anchor: existing E6 benchmark, T4 ≈ 681 ms/frame for upscale — detection is much lighter; measure, don't extrapolate) + CPU classical pass → projected $/90-min game vs the ≤ $0.50 gate.
- **License note** (EPIC.md decision 8): ultralytics is AGPL — already a shipped Modal dependency today, same exposure; record it. No SoccerNet weights in anything shippable.

## Implementation

### Steps
1. [ ] `modal_runner.py` + detection feature extraction over all 8 games (cache npz alongside T5440's)
2. [ ] Solo-eval detection features (G5 per feature) — sanity: player count must nail EMPTY
3. [ ] Audio features if dataset audio permits; else document skip
4. [ ] Fusion classifier, leave-one-game-out on dev split
5. [ ] Temporal decode + operating-point sweep: G1 ≥ 99.5% first, maximize G2
6. [ ] Error analysis on dev games; add pitch mask / features only if it names them
7. [ ] Freeze `fusion_v1.json`; single scoring run on held-out split; full gate table
8. [ ] README: verdict vs ALL gates (G1–G6 + cost projection) — the epic's go/no-go

### Progress Log

**2026-07-19**: Task created.

## Acceptance Criteria

- [ ] Fusion recipe frozen (weights/thresholds/features committed as `fusion_v1.json`)
- [ ] Held-out gate table reported: G1 ≥ 99.5%, G2 ≥ 65% (floor 50%), G3 = 100%, G4 ≤ 2 s, G5 ≥ 0.92, G6 ≤ 0.5
- [ ] Error analysis writeup committed (categorized G1 violations)
- [ ] Modal cost projection ≤ $0.50 per 90-min game documented with measured numbers
- [ ] Explicit go/no-go recorded in README + EPIC.md; if no-go, named gaps and recommended next experiment
