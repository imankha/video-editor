# T14320: Prototype 2: click-seeded tracking bake-off (ByteTrack, ARC-SORT, Deep-EIoU) through exits and re-entries

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Tier:** M (Modal prototype functions under `scripts/prototypes/`, no app code)
**Created:** 2026-10-31
**Updated:** 2026-10-31
**Epic:** [Player Moments](EPIC.md), task 3/5. Runs only if T14310 failed. Retires R2, R3, R10, R14.

## Problem

Tier 1 of the self-hosted design is "the parent taps the child once, the system knows where the child is every second". The user's own earlier attempt with ByteTrack lost the player the moment he left the frame, and the published numbers say every tracker struggles there (off-screen re-acquisition 8.7 percent in the one football study; 1,400+ identity switches per SportsMOT test split). Nobody has measured any tracker on phone or Veo youth footage. This prototype measures it on our footage and decides whether a click-plus-re-click UX is viable.

## Solution

One Modal function per tracker, same detector, same frames, same clicks, scored with T14300's presence labels.

1. **Detector.** One permissive-license person detector shared by all trackers (RF-DETR or YOLOX; not Ultralytics, R10), run at 5 and 10 fps on 1080p frames, with and without 2x2 tiling (R3). Record recall on the labeled child per setting.
2. **Trackers.** ByteTrack (baseline, the one that failed before), ARC-SORT (Apache-2.0, offline appearance-based tracklet merging for leave and re-enter), Deep-EIoU (sports-tuned), and BoT-SORT with camera-motion compensation OFF plus an OSNet re-ID model (the Roboflow reelcut finding: CMC on phone footage caused 4x the identity switches).
3. **Click seeding.** The T14300 first click selects the track id. The 2 to 3 later clicks are used two ways and both are measured: (a) as a re-anchor only when the tracker has lost the child (simulating "tap again"), and (b) as identity constraints when stitching tracklets offline (ARC-SORT style), which repairs history without rerunning the tracker.
4. **Metrics** via `score.py`: per-second presence accuracy on the labeled minutes; number of lost-then-recovered stretches; number of re-clicks needed to stay above the presence threshold for the whole game (R14); wrong-child seconds (identity switched to a teammate); GPU minutes and dollars per game on an L4 and an A100 (prices in EPIC.md).
5. **Confidence signal.** Record whether each tracker exposes a per-frame confidence usable to trigger "tap your player again" in the editor.

## Context

### Relevant Files (REQUIRED)
- `scripts/prototypes/player_moments/modal_tracking.py` (new; Modal app with one function per tracker, reads frames from R2, writes per-second presence JSON)
- `scripts/prototypes/player_moments/results/T14320-*.md` (new; results per tracker per game)
- Reference: [EPIC.md](EPIC.md), [research report](../../research/player-moments-research-2026-10-31.md) addendum, tier 1; Obsidian note `click_seeded_tracking.md` for the per-tracker evidence
- Existing Modal patterns: `.claude/knowledge/modal-gpu.md`

### Related Tasks
- Depends on: T14300; T14310 verdict = FAIL
- Blocks: T14330

### Technical Notes
- Do not evaluate SAM 2 / SAM 3 as the backbone: they need full 30 fps (stride 6 loses 11 benchmark points), which is $3 to $8.50 per game on an A100, and they have the same exit/re-entry failure. They may be revisited for a short re-anchor window around a click if the detector-based trackers fail.
- Frame subsampling (5 to 10 fps) is safe for detect-then-associate, which is why this family is the candidate.
- Keep every tracker behind the same interface (frames in, per-second boxes out) so the winner drops into T14340 unchanged.
- Local mock shortcuts are not acceptable here; the point is real GPU numbers.

## Implementation

### Steps
1. [ ] Frame extraction from R2 at 5 and 10 fps on Modal; detector recall per setting, with and without tiling
2. [ ] Four trackers wired behind one interface
3. [ ] Click seeding (a) re-anchor and (b) stitching constraints
4. [ ] Score every tracker on every T14300 game; results files
5. [ ] Verdict against the presence and re-click thresholds recorded in EPIC.md; name the winner

### Progress Log

**2026-10-31**: Filed from the research session.

## Acceptance Criteria

- [ ] Presence accuracy, lost-then-recovered count, wrong-child seconds, re-clicks needed, and dollars per game recorded for each tracker on each game
- [ ] Tiling and fps trade-off recorded (accuracy vs cost)
- [ ] A per-frame confidence signal identified for the winner, or its absence recorded
- [ ] PASS or FAIL against the T14300 thresholds in EPIC.md; on FAIL the epic stops and the result is reported to the user before any further work
