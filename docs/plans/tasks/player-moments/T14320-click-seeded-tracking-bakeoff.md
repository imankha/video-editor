# T14320: Tracking bake-off

## In plain words

Second prototype, only if the first fails: our own detector and tracker, seeded by the parent's tap.


**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Tier:** M (Modal prototype functions under `scripts/prototypes/`, no app code)
**Created:** 2026-10-31
**Updated:** 2026-11-01
**Epic:** [Player Moments](EPIC.md), task 4/6. Runs only if T14310 FAILED. Retires R2, R3, R10, R14.

## Problem

Tier 1 of the self-hosted design is "the parent taps the child once, the system knows where the child is every second". The user's earlier ByteTrack attempt lost the player the moment he left the frame, and the published numbers say every tracker struggles there (off-screen re-acquisition 8.7 percent in the one football study; 1,400+ identity switches per SportsMOT test split). Nobody has measured any tracker on phone or Veo youth footage. This prototype measures the registry's tracker candidates on our footage and decides whether a click-plus-re-click UX is viable.

## Slots and candidates

- Slot `person-detector`: one permissive-license detector shared by all trackers. Candidates at filing: RF-DETR, YOLOX (not Ultralytics, R10).
- Slot `tracker`: every `candidate` entry in the registry (2 to 4). Candidates at filing: ByteTrack (baseline, the one that failed), ARC-SORT (offline appearance-based tracklet merging), Deep-EIoU (sports-tuned), BoT-SORT with camera-motion compensation OFF plus OSNet re-ID (the Roboflow reelcut finding: CMC on phone footage caused 4x the identity switches).
- SAM 2 / SAM 3 family is `excluded` in the registry as a backbone (needs 30 fps, $3 to $8.50 per game on an A100, same exit failure); may be revisited for a short re-anchor window around a click if every detect-then-associate candidate fails.
- Every candidate sits behind one interface (frames in, per-second boxes and track ids out), selected by `--detector <id> --tracker <id>`, so the winner drops into T14340 unchanged.

## KPIs

| KPI | Definition (EPIC.md) | Pass bar |
|-----|----------------------|----------|
| Presence accuracy | per-second child-in-frame agreement on the labeled minutes | at or above the floor (proposed 0.85) |
| Re-clicks | extra taps needed to stay above the floor for the whole game | at or under the budget (proposed 4) |
| Lost-then-recovered | stretches lost and correctly re-acquired | reported; higher is better at equal presence |
| Wrong-child seconds | seconds following a teammate | reported; the main failure mode to explain |
| Detector recall on the child | per fps and tiling setting | reported; drives the fps/tiling choice |
| $/game | GPU minutes on an L4 and an A100 at the registry price | tier 1 under $2 |
| Confidence signal | per-frame confidence usable to prompt "tap again" | present or absent, recorded |

## Setup

1. **Frames** from R2 at 5 and 10 fps on 1080p, with and without 2x2 tiling (R3); detector recall per setting.
2. **Trackers** wired behind the one interface; same frames, same detections, same clicks.
3. **Click seeding**, both ways measured: (a) the first T14300 click selects the track id; later clicks re-anchor only when the tracker has lost the child (simulating "tap again"); (b) the later clicks act as identity constraints when stitching tracklets offline (ARC-SORT style), repairing history without rerunning the tracker.
4. **Score** every detector x tracker x fps x tiling combination on every T14300 game with `score.py`; results in `results/T14320-{detector}-{tracker}-{game}.md`.
- Environment: Modal, real GPU numbers (local mocks are not acceptable here); existing Modal patterns in `.claude/knowledge/modal-gpu.md`.
- Budget: under $100 of Modal time; time box two weeks.
- Registry under 60 days old, else T14295 refresh mode first.

## Decision

- **PASS** (one combination meets presence and re-click bars at tier 1 cost under $2): name the winner and its settings; T14330 starts with its presence output.
- **NEAR** (presence at or above floor but re-clicks over budget): the re-click budget is a product call; present the user the number per game and the UX it implies. Raised budget -> PASS; kept -> FAIL.
- **FAIL**: the epic STOPS and reports. It parks until a T14295 refresh adds a new tracker candidate; no tier 2 without tier 1. The results files stay as the reusable benchmark.

## Context

### Relevant Files (REQUIRED)
- `scripts/prototypes/player_moments/modal_tracking.py` (new; Modal app, one function per candidate behind the interface, reads frames from R2, writes per-second presence JSON)
- `scripts/prototypes/player_moments/results/T14320-*.md` (new)
- Reference: [EPIC.md](EPIC.md), research addendum tier 1, Obsidian note `click_seeded_tracking.md`

### Related Tasks
- Depends on: T14295, T14300; T14310 verdict = FAIL
- Blocks: T14330

### Technical Notes
- Frame subsampling (5 to 10 fps) is safe for detect-then-associate, which is why this family is the candidate set.
- Record wrong-child seconds by team (same kit vs other kit) since kit confusion is the expected systematic error.

## Implementation

### Steps
1. [ ] Frame extraction at 5 and 10 fps, with and without tiling; detector recall per setting
2. [ ] Registry trackers wired behind one interface
3. [ ] Click seeding (a) re-anchor and (b) stitching constraints
4. [ ] Score every combination on every game; results files
5. [ ] Verdict (PASS / NEAR / FAIL) recorded in EPIC.md; winner named with settings

### Progress Log

**2026-10-31**: Filed from the research session.
**2026-11-01**: Rewritten as a slot bake-off with KPIs, setup, and the PASS / NEAR / FAIL decision.

## Acceptance Criteria

- [ ] Every KPI above recorded for each detector x tracker x setting on each game
- [ ] Tiling and fps trade-off recorded (accuracy vs cost)
- [ ] Confidence signal identified for the winner, or its absence recorded
- [ ] Verdict recorded in EPIC.md; on FAIL the epic stops and the result is reported to the user before any further work
