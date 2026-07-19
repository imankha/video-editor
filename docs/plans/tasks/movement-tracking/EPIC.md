# Movement Tracking Epic (Activity Timeline for Annotate)

**Status:** TODO
**Started:** —
**Created:** 2026-07-19

## Goal

When a user uploads a game they can opt into **Movement Tracking** (a paid add-on that subsidizes a Modal job). The job analyzes the full game and produces a per-game **movement profile**: a per-second activity score plus a discrete play-state timeline (`ACTIVE` / `DEAD` / `EMPTY`). Annotate renders this as a new layer over the timeline (y proportional to movement at that moment), and a **smart playback** mode speeds through dead-ball time and skips long empty periods (halftime) entirely.

Why: annotating a full game is the single largest time cost in the product. Only ~55–65% of a soccer match is effective playing time (FIFA's own ball-in-play stats: ~55 min of a 98-min match); the rest is throw-in walks, goal-kick resets, fouls, subs, injuries, and halftime. Every sport has this. We are NOT ready to auto-trim those moments — but we can make them *visible* and let assisted playback blast through them while the human stays in control. This is the stepping stone toward eventual auto-trim: the same signal, surfaced conservatively.

**This is a science project as much as a feature.** The AI must be tuned and proven in an isolated testbed against human-labeled ground truth BEFORE any of it touches the app. The upscale-quality epic established this pattern (`src/backend/experiments/sr_testbed/`); this epic follows it.

## The Prime Directive: Testbed First

**No detector ships to the app without a testbed run against labeled held-out games proving it clears the decision gates below.** Every signal, fusion recipe, threshold, or smoothing change is expressed as a testbed pipeline, run against the standard labeled game set, and evaluated on the standard report. "It looked right on the game I scrubbed" is not evidence. T5430 (testbed + labeling environment) is ordered first and blocks everything.

## Camera Reality (signals must survive all three)

Our game footage comes from three source classes with very different motion characteristics:

| Source class | Camera motion | Implication |
|---|---|---|
| Veo-style static panoramic | none (stitched wide view), but lens warp at edges | frame differencing works almost raw |
| Trace-style auto-follow | continuous pan/zoom tracking play | **global camera motion dominates pixel change** — must be compensated or every frame looks "active" |
| Handheld phone | shake + pan + zoom, worst case | compensation mandatory; expect the noisiest scores |

Additional confounders: spectators and warm-up players near the sideline (motion that isn't play), wind-blown nets/trees, rain, exposure flicker, far-side players at 30–80 px, and the scoreboard/watermark overlays some cameras burn in. The labeled dataset (T5430) must include all three source classes or we will tune a detector that only works on one.

## Signal Candidates (the bake-off)

Ordered roughly by cost. The end recipe is likely a **fusion** of a cheap dense signal (S1–S3) with a semantic signal (S4), smoothed by S6.

| # | Signal | How | Libraries | Cost (90-min game) | Risk |
|---|---|---|---|---|---|
| S1 | **Compressed-domain motion vectors** | Read H.264/H.265 motion vectors straight out of the bitstream — no full decode. Aggregate |mv| per frame, subtract global median (camera motion). | [mv-extractor](https://github.com/LukasBommes/mv-extractor), PyAV (`export_mvs`), ffmpeg `-flags2 +export_mvs` | ~free (CPU, minutes) | MVs are encoder-dependent noise, not true motion; B-frame handling; may be enough anyway |
| S2 | **Frame differencing / background subtraction** | `cv2.absdiff` on downscaled gray frames; or MOG2/KNN background models. Score = fraction of changed pixels. | OpenCV (`absdiff`, `createBackgroundSubtractorMOG2/KNN`) | ~free (CPU) | Useless under camera motion unless stabilized first; lighting flicker |
| S3 | **Dense optical flow + global-motion subtraction** | DIS optical flow (fast) or Farneback on downscaled frames; estimate global/camera motion (median flow or `estimateAffinePartial2D`/ECC on grid features), subtract it; score = residual flow magnitude. RAFT (torchvision) as the quality reference, not the runtime. | OpenCV `DISOpticalFlow` / `calcOpticalFlowFarneback`, `cv2.estimateAffinePartial2D`, torchvision RAFT | low (CPU at 2–5 fps sampling) | Compensation quality on zoom; still fooled by spectator motion |
| S4 | **Player detection + tracking** | YOLO on sampled frames (1–2 fps), track with ByteTrack/BoT-SORT; features: player count on pitch, aggregate displacement, team spread (convex-hull area), centroid speed, "clustered around a point" (free-kick/injury signature). **`yolov8x.pt` is already baked into our Modal `yolo_image`** — reuse it. | ultralytics (det + built-in ByteTrack/BoT-SORT), [supervision](https://github.com/roboflow/supervision), [norfair](https://github.com/tryolabs/norfair), [roboflow/sports](https://github.com/roboflow/sports) (pitch keypoints, examples) | ~$0.10–0.30 GPU at 1–2 fps sampling | Cost; far-side misses; detects spectators too (need pitch masking — S4b) |
| S4b | **Pitch masking** | One-time-per-game field segmentation (dominant-green mask or pitch keypoint homography from roboflow/sports) so S1–S4 only count motion ON the field. | OpenCV HSV masking; roboflow/sports pitch model | ~free | Non-grass sports/dirt fields; worth it only if spectator noise shows up in error analysis |
| S5 | **Audio energy (optional, complementary)** | Whistle-band energy (2–4 kHz bandpass), crowd RMS. Whistles mark stop/start transitions; silence marks halftime. | librosa/torchaudio; optionally YAMNet/PANNs "whistle" class | ~free | Wind noise, music, sideline chatter; many uploads have poor audio |
| S6 | **Learned fusion + temporal smoothing** | Per-second feature vector from S1–S5 → small classifier (logistic regression / LightGBM, or tiny 1D-conv/GRU) trained on our labels → per-second P(active) → HMM/hysteresis decode with min-duration constraints. | scikit-learn / LightGBM, hmmlearn (or hand-rolled Viterbi/hysteresis) | ~free | Needs the labeled set (that's what T5430 builds); overfit risk with ~8 games — keep the model tiny |
| S7 | **End-to-end video classifier (reference only)** | X3D / MoViNet / VideoMAE-2 fine-tuned on 2–4 s windows for active-vs-dead. | pytorchvideo, timm, HF transformers | GPU, highest | Almost certainly unnecessary; only if S1–S6 fusion fails the gate. Data-hungry. |

**Prior art to mine (ideas, not shipped weights):** broadcast play–break segmentation literature (Ekin et al. 2003 dominant-color/camera-view methods — built for broadcast cutting, mostly N/A to our single fixed panorama, but the play/break taxonomy is useful); [SoccerNet](https://www.soccer-net.org/) action-spotting and game-state-reconstruction challenges + baselines (**check licenses — much of it is research-only; use for benchmarking ideas, do not ship weights without license review**); [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) for coarse content-change detection (halftime static scenes); Roboflow's sports pipelines for detection/tracking recipes.

## Ground Truth: Label Taxonomy

Per-second (0.5 s resolution internally) state, exactly three classes:

| State | Definition | Examples |
|---|---|---|
| `ACTIVE` | Ball in play, or restart imminent enough that an annotator must watch | open play; free kick from the start of the run-up; throw-in from the moment the thrower is set |
| `DEAD` | Ball out of play, players present, nothing annotatable happening | walking to a throw-in, goal-kick reset, foul aftermath, substitutions, injury stoppage, goal celebrations |
| `EMPTY` | No meaningful play possible | pre-game, halftime, post-game, weather delay, camera left running |

**Boundary conventions (annotators must follow these or metrics are noise):**
- A restart flips to `ACTIVE` ~2 s before the ball is struck (preserves lead-in; smart playback returns to 1x here).
- Goal celebrations are `DEAD` — but playback-side protected zones (below) guarantee we never speed away from the goal itself.
- When unsure, label `ACTIVE`. The whole system is asymmetric: false-ACTIVE only wastes time; false-DEAD can hide a goal.

**Ground-truth format** (one JSON per game, produced by the labeler): `{game_id, video_sha, fps, labeled_by, labeled_at, segments: [{t0, t1, state}], notes}` — contiguous, non-overlapping, covering the full duration.

## Labeling Environment

**Decision: build a custom keyboard-driven labeler inside the testbed** (~300 LOC static HTML). We build video annotation UIs for a living; Label Studio/CVAT are heavyweight for a 3-state timeline. If it disappoints, fall back to [Label Studio](https://labelstud.io/)'s video timeline-segmentation template or [CVAT](https://www.cvat.ai/) — both are documented in T5430 as plan B, along with zero-install [VIA](https://www.robots.ox.ac.uk/~vgg/software/via/).

The labeler: single HTML page, `<video>` element pointed at a local game file, speed control 1–8x, keys **A/D/E** stamp the state from the current time forward (state persists until the next keypress — you label by *toggling while watching at 4x*, not by dragging segments), a colored timeline strip shows the state track, undo, export/import of the ground-truth JSON. A second **review mode** jumps between transitions ±5 s at 1x to fix boundaries.

**Labeling protocol (T5430):**
- **Dataset: 8 games** (~12 h footage) from our own accounts: 2+ Veo-static, 2+ follow-cam, 2+ phone; soccer-weighted (target audience) with at least 1 non-soccer if available. Split **5 dev / 3 held-out test** — held-out games are never used for tuning, thresholds, or model fitting; they are touched only by the final report of each task.
- Expected effort: one watch-through pass at ~4x + a transition-review pass ≈ 25–35 min per game hour → **~5–7 h total**. Budget it; it's the irreplaceable asset of this epic.
- **Double-label one game** (two annotators) and report agreement (Cohen's kappa + boundary deltas). That number is the human ceiling — no gate below may demand more than humans agree with each other.
- Test media is **never committed to git** (same rule as sr_testbed): `games/`, `runs/`, `labels/` gitignored except `labels/*.json` (labels are small and precious — commit them), plus `manifest.json` pinning video SHAs.

## KPIs & Decision Gates

**The core asymmetry:** classifying real play as skippable is catastrophic (a parent misses their kid's goal); classifying dead time as active merely wastes time. All tuning fixes the play-preservation gate first, then maximizes dead-time capture at that operating point.

### Signal-quality gates (measured on the 3 held-out games; must pass ALL to productize — T5450 is the go/no-go)

| # | KPI | Gate | Rationale |
|---|---|---|---|
| G1 | **Play preservation**: % of true `ACTIVE` seconds NOT classified DEAD/EMPTY | **≥ 99.5%** | ≤ ~16 s of misclassified play per game-hour; a missed goal ends trust in the feature |
| G2 | **Dead-time capture**: % of true `DEAD`+`EMPTY` seconds flagged, at the G1 operating point | **≥ 65%** (floor 50%) | 65% of ~35 min/game dead time ≈ 23 min saved/game |
| G3 | **Long-gap detection**: `EMPTY` gaps > 120 s (halftime etc.) detected | **100%** | halftime skip is the single biggest, safest win |
| G4 | **Boundary error**: median \|Δt\| at ACTIVE↔DEAD transitions | **≤ 2 s** | smart playback lead-in depends on it |
| G5 | **Score quality**: ROC-AUC of continuous score, ACTIVE vs rest | **≥ 0.92** | threshold-independent health metric; tracks signal quality across iterations |
| G6 | **Stability**: state flips per game-minute after smoothing | **≤ 0.5** | a strobing timeline layer reads as broken |

### Cost gates (T5450 estimates, T5460 verifies on Modal)

| KPI | Gate |
|---|---|
| Modal cost per 90-min game | **≤ $0.50** (the add-on is priced above this; classical-only recipe should land ≤ $0.05) |
| Wall-clock per 90-min game | **≤ 20 min** (runs alongside upload processing; not user-blocking) |
| Movement profile artifact size | **≤ 200 KB** |

### Product KPIs (instrumented post-ship, not gates)

- Annotation session time per game hour, before vs after (the metric this feature exists to move).
- % of playback time in smart mode; smart-mode disable rate mid-session (proxy for "it skipped something it shouldn't have").
- Opt-in rate at upload; complaints/refunds attributable to the add-on.

## Movement Profile (the artifact)

One per game, written by the Modal job to R2 (exact key scheme defined in T5460, alongside the game's storage refs), msgpack:

```
{
  version: 1,
  generator: {recipe: "fusion-v1", model_versions: {...}, thresholds: {...}},
  sample_hz: 2,                      // scores sampled at 2 Hz
  scores: bytes,                      // uint8 per sample, per-game percentile-normalized 0-255
  states: [{t0, t1, state}],          // RLE, state in {active, dead, empty}
  normalization: {p5: .., p95: ..},   // raw-score anchors for debugging
}
```

90 min @ 2 Hz = 10,800 samples ≈ 11 KB of scores — trivially small. The per-game percentile normalization means the Annotate layer always uses the full y-range regardless of camera type. Profile presence/status is tracked in the profile DB (schema + migration in T5460; Migration agent included).

## Smart Playback Semantics (product spec — T5470/T5480)

- **Activity layer (T5470):** area-sparkline over the Annotate timeline, y proportional to score. `DEAD` spans tinted, `EMPTY` spans hatched. Toggleable; read-only (no persistence — it's derived data rendered from the profile).
- **Smart playback (T5480):** toggle in Annotate. `ACTIVE` → user's chosen speed; `DEAD` → ramp to skim speed (default 4x, configurable 2–8x); `EMPTY` > 2 min → hard skip with toast ("Skipped 12:04 — halftime") + one-click undo/seek-back. Return to normal speed 2 s before a predicted `ACTIVE` transition (G4 makes this safe). **Protected zones:** never skim/skip within ±10 s of a top-decile score spike, belt-and-suspenders around goals. Implementation is pure `video.playbackRate` + `currentTime` manipulation — no re-encode, no persistence, fully client-side.

## Design Decisions (reference from task files, don't duplicate)

1. **Testbed at `src/backend/experiments/motion_testbed/`** — mirrors `sr_testbed` conventions (standalone, no FastAPI/frontend/per-user DB; `Signal`/`Recipe` plug-in classes; manifest-pinned inputs; HTML report; media gitignored, labels committed).
2. **Three-state taxonomy** (`ACTIVE`/`DEAD`/`EMPTY`) with the boundary conventions above. Do not add states without re-labeling everything.
3. **Asymmetric tuning:** fix G1 (play preservation) first, maximize G2 at that operating point. Every report states the full gate table.
4. **Fusion recipe over end-to-end model:** cheap dense signal + semantic detection features + tiny learned fuser + temporal decode. S7 (video transformer) only if fusion fails, with explicit user sign-off (cost).
5. **Reuse existing Modal infra:** same app (`reel-ballers-video-v2`), same generator-progress contract, same `modal_client.py` unified-dispatch pattern, same recovery scheme (`modal_call_id`). YOLO reuses the baked `yolov8x.pt` in `yolo_image`. Deploys stay manual (ask user).
6. **Visualization before automation:** this epic ships a layer + assisted playback. Auto-trim is explicitly out of scope; the profile schema is designed so a future auto-trim epic consumes it unchanged.
7. **Paid add-on gating ships LAST** (T5490) — everything is dogfooded free on internal accounts via an admin/dev trigger first.
8. **License review is part of library selection:** ultralytics is AGPL (already a shipped dependency in Modal — same exposure as today, but note it); SoccerNet assets are research-only; anything GPL-viral stays in the testbed and out of the product path unless cleared.

## Tasks (implement strictly in order — each builds on the last)

| ID | Task | Status |
|----|------|--------|
| T5430 | [Motion Testbed + Labeling Environment + Ground-Truth Dataset](T5430-motion-testbed-labeling.md) | TODO |
| T5440 | [Classical Signal Bake-off (motion vectors / diff / flow + camera compensation)](T5440-classical-signal-bakeoff.md) | TODO |
| T5450 | [Detection Signals + Fusion + Smoothing → Decision Gate](T5450-detection-fusion-tuning.md) | TODO |
| T5460 | [Modal Movement Job + Profile Persistence](T5460-modal-movement-job.md) | TODO |
| T5470 | [Annotate Activity Layer](T5470-annotate-activity-layer.md) | TODO |
| T5480 | [Smart Playback](T5480-smart-playback.md) | TODO |
| T5490 | [Upload Opt-in + Paid Add-on Gating](T5490-upload-optin-pricing.md) | TODO |

Overlap map (what's shared vs new per science task):

| Concern | T5440 (classical) | T5450 (detection + fusion) |
|---|---|---|
| Runs inside testbed | yes (new `Signal` subclasses) | yes (new `Signal` subclasses + `Recipe` fuser) |
| Ground truth / metrics / report | reuses T5430 unchanged | reuses T5430 unchanged |
| Feature cache | WRITES per-second feature vectors (npz) | READS T5440's cache, adds detection features |
| GPU | none (CPU only) | Modal T4 via a thin runner (pattern from sr_testbed's `modal_runner.py`) |
| Output | per-signal gate table + cost curve | final recipe + go/no-go vs ALL gates + Modal cost estimate |

## Completion Criteria

- [ ] Testbed + labeler exist; 8 games labeled (5 dev / 3 held-out); inter-annotator kappa reported
- [ ] Classical bake-off report committed (per-signal gate table + cost curve)
- [ ] Fusion recipe passes ALL signal-quality gates on held-out games; go/no-go recorded
- [ ] Modal job produces movement profiles end-to-end on staging; cost gate verified with real telemetry
- [ ] Annotate activity layer + smart playback live on staging behind the profile-exists check
- [ ] Paid opt-in gating wired; internal dogfood period completed with product KPIs instrumented
- [ ] `.claude/knowledge/` docs updated (modal-gpu.md, annotate.md) with the new surface

## References

- Pattern precedent: [upscale-quality/EPIC.md](../upscale-quality/EPIC.md) (testbed-first), `src/backend/experiments/` (e1/e3/e6/e7)
- Existing YOLO surface: `video_processing.py` `detect_players_modal` (:797), `yolo_image` (:42), `modal_client.py:1252`
- Libraries: [mv-extractor](https://github.com/LukasBommes/mv-extractor) · [PyAV](https://github.com/PyAV-Org/PyAV) · OpenCV DIS flow / MOG2 / ECC · [torchvision RAFT](https://pytorch.org/vision/stable/models/raft.html) · [ultralytics](https://github.com/ultralytics/ultralytics) · [supervision](https://github.com/roboflow/supervision) · [norfair](https://github.com/tryolabs/norfair) · [roboflow/sports](https://github.com/roboflow/sports) · [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) · [librosa](https://librosa.org/) · [hmmlearn](https://github.com/hmmlearn/hmmlearn) · [LightGBM](https://github.com/microsoft/LightGBM) · [Label Studio](https://labelstud.io/) · [CVAT](https://www.cvat.ai/) · [VIA](https://www.robots.ox.ac.uk/~vgg/software/via/)
- Research: [SoccerNet](https://www.soccer-net.org/) (action spotting, game-state reconstruction; license-restricted) · Ekin et al. 2003, "Automatic soccer video analysis and summarization" (play–break taxonomy) · FIFA effective-playing-time statistics (ball-in-play ~55 min)
