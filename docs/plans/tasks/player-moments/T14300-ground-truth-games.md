# T14300: Ground-truth set: parent-marked moments on 3 to 5 real games across at least two sports

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Tier:** S (no app code; a labeled dataset, a scoring script, and the thresholds the prototypes are judged against)
**Created:** 2026-10-31
**Updated:** 2026-10-31
**Epic:** [Player Moments](EPIC.md), task 1/5. Retires R1; sets the kill thresholds for R2, R5, R14.

## Problem

Every prototype in this epic has to be judged with a number, and there is no amateur-footage benchmark anywhere (research report, R1). Without our own labeled games, "the Twelve Labs demo looked good" or "the tracker mostly followed him" cannot be told apart from "works".

## Solution

Assemble 3 to 5 full games the product already holds, each with ONE target child chosen and that child's notable moments marked by a parent, and write the scoring script every later prototype runs.

1. **Pick the games.** At least 2 sports (soccer plus one of basketball, lacrosse, hockey, volleyball). At least one phone-shot game and one Veo-style wide shot. Candidates: the dev fixture account's 8 prod-derived games (soccer, already annotated with plays and ratings, so the existing annotations are the labels), and one non-soccer game the user supplies. Record for each: sport, camera, resolution, fps, duration, file size, the target child's description (kit color, number if any).
2. **Label.** For each game, a single JSON file `ground_truth/{game_id}.json` with: the target child's click (frame time + normalized x,y, and 2 to 3 extra clicks at later points to seed re-anchoring tests); a list of moments `{start_s, end_s, label in {highlight, learning, interesting}, note}` marked by the parent; and a per-second presence track for at least 10 minutes of each game (is the child in frame, yes/no, sampled every second) so T14320 has a presence metric. Where the game already has ReelBallers plays for that child, convert them; mark anything the parent adds by hand.
3. **Scoring script** `scripts/prototypes/player_moments/score.py` (standalone, no app imports) that takes a prediction file of `{start_s, end_s, score, label}` and reports: recall@10 / @20 of ground-truth moments (a hit = overlap at least 50 percent), precision of the top 10, Spearman between score and a ground-truth rank, and for presence predictions, per-second accuracy and the count of lost-then-recovered stretches. Same script for every prototype so results are comparable.
4. **Thresholds, written down before any prototype runs** and recorded in EPIC.md's prototype table: minimum recall@20 for a hosted or self-hosted path to be worth productizing; minimum presence accuracy; maximum re-clicks per game (R14, a product call by the user). Proposed starting points for the user to confirm: recall@20 at least 0.6, presence accuracy at least 0.85 on the labeled minutes, at most 4 re-clicks per 90-minute game.

## Context

### Relevant Files (REQUIRED)
- `scripts/prototypes/player_moments/score.py` (new; standalone)
- `scripts/prototypes/player_moments/ground_truth/*.json` (new; small, no video checked in)
- Game video stays in R2 / the dev fixture account; the task records R2 keys, never copies video into the repo
- Reference: [EPIC.md](EPIC.md), [research report](../../research/player-moments-research-2026-10-31.md)

### Related Tasks
- Blocks: T14310, T14320, T14330

### Technical Notes
- Labeling is a user activity (the parent's judgment is the ground truth). The AI prepares the game list, the JSON schema, converts existing plays, and builds the scoring script; the user confirms or edits the moments and the thresholds.
- Keep the label set small and honest: 3 to 5 games is enough to kill a prototype, not enough to claim a product metric. Say so in the file.
- `scripts/` is not run by CI; the scoring script gets a tiny self-test on a synthetic prediction file.

## Implementation

### Steps
1. [ ] List candidate games with sport, camera, duration, size; user picks 3 to 5
2. [ ] Define the JSON schema; convert existing plays for the chosen child; user marks the rest
3. [ ] Presence labels for at least 10 minutes per game
4. [ ] Write and self-test `score.py`
5. [ ] User confirms thresholds; write them into EPIC.md's prototype table

### Progress Log

**2026-10-31**: Filed from the research session.

## Acceptance Criteria

- [ ] 3 to 5 games labeled, at least 2 sports, at least one phone-shot and one wide-shot game
- [ ] `score.py` runs on a synthetic prediction and on one real ground-truth file and prints the metrics above
- [ ] Thresholds for recall@20, presence accuracy, and re-clicks per game are written in EPIC.md and confirmed by the user
