# T14300: Ground truth and the Veo bar: parent-marked moments on 3 to 5 real games, Veo's precision and recall on the same games

## In plain words

Mark one child's moments by hand on three to five real games and score what Veo's own feature finds on the same games, so every prototype can be judged against a number. Can reuse the games from the suggested-plays proof.


**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Tier:** S (no app code; a labeled dataset, the Veo baseline files, a scoring script, and the thresholds every prototype is judged against)
**Created:** 2026-10-31
**Updated:** 2026-11-01
**Epic:** [Player Moments](EPIC.md), task 2/6. Retires R1, R15; sets the floors for R2, R5, R14.

## Problem

Every prototype has to be judged with a number, and the user's bar (2026-11-01) is "beat Veo's AI on precision and recall". That needs two things nobody has yet: parent-marked moments for one child on real games, and Veo's own output for that child on the same games, scored the same way.

## Solution

1. **Pick the games.** 3 to 5 full games already in the product. At least 2 sports (soccer plus one of basketball, lacrosse, hockey, volleyball). At least one phone-shot game and one Veo wide shot. For every Veo game, obtain the Veo highlights zip (team-level, T13200 parser) and, if the recording has the Player Spotlight add-on, the Player Moments for the child. Record per game: sport, camera, resolution, fps, duration, file size, target child's description (kit color, number if any), and **which Veo baseline exists (Veo-Spotlight, Veo-team, or none)**. Candidates: the dev fixture account's 8 prod-derived soccer games (existing plays and ratings become labels) and one non-soccer game the user supplies.
2. **Label.** Per game, `ground_truth/{game_id}.json`: the child's first click (frame time + normalized x,y) plus 2 to 3 later clicks to seed re-anchoring tests; moments `{start_s, end_s, label in {highlight, learning, interesting}, note}` marked by the parent; a per-second presence track for at least 10 minutes. Existing ReelBallers plays for that child are converted; anything the parent adds by hand is flagged as such.
3. **Veo baseline files** `baselines/{game_id}-veo-spotlight.json` and `baselines/{game_id}-veo-team.json` in the prediction format (`{start_s, end_s, score, label}`; Veo gives no score, so score = 1 and the ranking is by Veo's own order). Scored with `score.py` like any prototype. Their P, R and K_veo per game are written into EPIC.md as **the bar**.
4. **Scoring script** `scripts/prototypes/player_moments/score.py` (standalone, no app imports) implementing exactly EPIC.md's KPI definitions: hit rule, P@K, R@K (K = 10, 20, and K_veo), AP, label kappa, presence accuracy, lost-then-recovered, wrong-child seconds. Input: a ground-truth file, a prediction file, optionally a baseline file; output: a markdown table plus JSON. Same script for every prototype so results are comparable.
5. **Floors, written before any prototype runs**, confirmed by the user and recorded in EPIC.md: absolute R@20 floor (proposed 0.6), presence-accuracy floor (proposed 0.85 on the labeled minutes), re-click budget (proposed at most 4 per 90-minute game, R14). The Veo numbers are relative bars on top of these floors.

## KPIs for this task

| KPI | Pass |
|-----|------|
| Coverage | 3 to 5 games, 2+ sports, 1+ phone shot, 1+ Veo wide shot; at least 2 games with a Veo baseline, at least 1 with Veo-Spotlight if the user can obtain it |
| Label size | At least 8 parent-marked moments per game; at least 10 labeled presence minutes per game |
| Veo bar | Veo P, Veo R, K_veo recorded per game, per baseline type |
| Script | `score.py` reproduces hand-computed numbers on a synthetic file and runs on every real ground-truth file |

## Setup

- Labeling is the parent's judgment (the user). The AI lists candidate games, writes the JSON schema, converts existing plays, imports the Veo zips through the existing parser logic, builds `score.py`; the user marks moments, confirms Veo-Spotlight availability, and confirms the floors.
- Video stays in R2 / the dev fixture account; the repo gets JSON only.
- Time box: one session of AI work plus the user's labeling time.

## Decision

- Veo-Spotlight available on at least one game -> the bar is like for like; proceed.
- Only Veo-team available -> proceed, with precision reported as one-sided in every later results file; the user decides whether to buy the add-on for one future recording to get a fair bar (R15).
- Fewer than 3 games labeled -> do not start T14310; the labels are the whole basis of the epic.

## Context

### Relevant Files (REQUIRED)
- `scripts/prototypes/player_moments/score.py` (new; standalone)
- `scripts/prototypes/player_moments/ground_truth/*.json`, `baselines/*.json` (new; no video checked in)
- `src/frontend/src/utils/veoHighlights/` (T13200 parser; reuse its name parsing for the zip, do not copy logic)
- Reference: [EPIC.md](EPIC.md), [veo-import/EPIC.md](../veo-import/EPIC.md) "The format" table

### Related Tasks
- Depends on: T14295
- Blocks: T14310, T14320, T14330

### Technical Notes
- 3 to 5 games can kill a prototype, not prove a product metric; every results file says so.
- Veo zips have two halves on separate timelines; map stamps onto the game timeline the same way the import epic does.
- `scripts/` is not run by CI; `score.py` ships with a self-test on a synthetic prediction file.

## Implementation

### Steps
1. [ ] Candidate game list with sport, camera, duration, size, Veo baseline availability; user picks 3 to 5
2. [ ] JSON schema; convert existing plays; user marks the rest
3. [ ] Presence labels for 10+ minutes per game
4. [ ] Veo baseline files; score them; write the bar into EPIC.md
5. [ ] `score.py` with self-test
6. [ ] User confirms floors; write them into EPIC.md

### Progress Log

**2026-10-31**: Filed from the research session.
**2026-11-01**: Veo baseline and KPI/setup/decision sections added (user: beat Veo on precision and recall).

## Acceptance Criteria

- [ ] 3 to 5 games labeled, 2+ sports, 1+ phone and 1+ wide shot, Veo baseline type recorded per game
- [ ] Veo P, R, K_veo per game written into EPIC.md
- [ ] `score.py` self-test passes and runs on every real file
- [ ] Floors confirmed by the user and written into EPIC.md
