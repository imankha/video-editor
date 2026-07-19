# T5430: Motion Testbed + Labeling Environment + Ground-Truth Dataset

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-07-19

## Problem

We want to detect dead-ball/no-play time in uploaded games, but we have no way to measure whether ANY detector works. Before a single signal is written we need: (1) a standalone testbed where candidate signals run against real games, (2) a labeling environment so a human can produce ground-truth play-state timelines, (3) a labeled dataset spanning our three camera classes, and (4) a metrics harness that scores any candidate against the epic's decision gates (G1–G6). See [EPIC.md](EPIC.md) for the label taxonomy, gates, and design decisions — this task builds the instrument; it makes no claims about which signal wins.

## Solution

Build `src/backend/experiments/motion_testbed/` mirroring the sr_testbed conventions (standalone, no FastAPI, media gitignored). Ship a keyboard-driven HTML labeler, label 8 games (5 dev / 3 held-out), and commit a metrics module + HTML report that turns `(prediction, ground truth)` into the gate table.

## Context

### Relevant Files (REQUIRED)
All new, under `src/backend/experiments/motion_testbed/`:
- `README.md` — how to add a game, label it, run an eval
- `manifest.json` — game inventory: id, local filename, video SHA-256, camera class (veo-static | follow | phone), sport, split (dev | test)
- `labeler/index.html` — the labeling tool (single static page, ~300 LOC, no build step)
- `harness/ground_truth.py` — load/validate label JSON (contiguity, full coverage, taxonomy)
- `harness/signal.py` — `Signal` base class: `analyze(video_path) -> per-second scores` and `Recipe` base: scores → `[{t0,t1,state}]`
- `harness/metrics.py` — G1–G6 implementations (see below)
- `harness/report.py` — HTML report: per-game gate table, score-vs-truth strip charts, transition error histogram
- `run_eval.py` — CLI: `python run_eval.py --recipe X --split test`
- `.gitignore` — `games/`, `runs/` ignored; `labels/*.json` committed
- `labels/` — committed ground-truth JSONs

### Related Tasks
- Blocks: T5440, T5450 (and transitively the whole epic)
- Pattern precedent: `src/backend/experiments/sr_testbed/` (T4700) — copy its manifest/gitignore/report conventions where they fit

### Technical Notes
- **Labeler UX** (decision in EPIC.md — custom over Label Studio/CVAT): `<video>` from a local file picker (no server), speed 1–8x, keys `A`/`D`/`E` stamp state from current time forward, colored state strip under the video, undo stack, export/import ground-truth JSON, and a review mode that jumps between transitions playing ±5 s at 1x. Fallback if custom disappoints: Label Studio video timeline-segmentation template or CVAT (document the import path from their export format in README).
- **Ground-truth JSON**: `{game_id, video_sha, fps, labeled_by, labeled_at, segments:[{t0,t1,state}], notes}`; `ground_truth.py` rejects gaps, overlaps, unknown states.
- **Metrics** (all at 0.5 s resolution, per-game and pooled):
  - G1 play preservation = 1 − (ACTIVE seconds predicted DEAD/EMPTY ÷ true ACTIVE seconds)
  - G2 dead capture = flagged DEAD+EMPTY seconds ÷ true DEAD+EMPTY seconds, at the G1-satisfying operating point
  - G3 long-gap detection: every true EMPTY gap > 120 s must overlap ≥ 80% with predicted EMPTY
  - G4 boundary error: median |Δt| matching predicted↔true ACTIVE/DEAD transitions (greedy match within ±10 s)
  - G5 ROC-AUC of continuous score (ACTIVE vs rest) — requires recipes to expose raw scores, not just states
  - G6 flips/min after smoothing
- **Dataset**: 8 games from OUR OWN accounts only (download via existing R2 access or local originals): ≥2 veo-static, ≥2 follow, ≥2 phone; soccer-weighted, ≥1 other sport if available. Split 5 dev / 3 test recorded in manifest; test games are eval-only forever.
- **Inter-annotator**: double-label 1 game, report Cohen's kappa + boundary deltas in README — this is the human ceiling.
- **Trivial baselines committed with the testbed** (calibration): "always ACTIVE" (G1=100%, G2=0) and "uniform random score". Any real signal must beat these on G5 or something is wired wrong.

## Implementation

### Steps
1. [ ] Scaffold directory, manifest schema, .gitignore, README
2. [ ] `ground_truth.py` + unit tests (validation cases)
3. [ ] `metrics.py` G1–G6 + unit tests on synthetic timelines (known-answer tests)
4. [ ] Labeler HTML tool; label one game end-to-end to shake out UX; iterate
5. [ ] `report.py` HTML report with strip charts (score over time vs truth bands)
6. [ ] Acquire + label 8 games per protocol; double-label 1; commit labels + manifest
7. [ ] Run trivial baselines through `run_eval.py`; commit their report as the floor

### Progress Log

**2026-07-19**: Task created.

## Acceptance Criteria

- [ ] `run_eval.py` scores an arbitrary `Recipe` against dev or test split and emits the gate table + HTML report
- [ ] 8 games labeled and committed (labels only; media gitignored), manifest pins SHAs and splits
- [ ] Inter-annotator kappa + boundary agreement reported in README
- [ ] Known-answer unit tests pass for every metric
- [ ] Trivial-baseline report committed
