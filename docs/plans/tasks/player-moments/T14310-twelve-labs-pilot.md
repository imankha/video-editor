# T14310: Prototype 1: hosted video-search slot end to end (upload game, tap-crop query, scored moments)

## In plain words

First prototype: a hosted video-search service that takes a tap on the child and returns scored moments. A one-week pilot with a kill rule.


**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Tier:** S (prototype script under `scripts/prototypes/`, no app code; budget under $50 per candidate, at most two candidates)
**Created:** 2026-10-31
**Updated:** 2026-11-01
**Epic:** [Player Moments](EPIC.md), task 3/6. Retires R4, R12 (terms review). **If this passes, T14320 and T14330 become OBSOLETE and T14340 integrates the winning hosted candidate.**

## Problem

A hosted "query a whole game, get time-stamped scored clips" service would make the epic a thin integration instead of a build. At filing the only such candidate is Twelve Labs (Marengo 3.0; composed image-plus-text query takes the tap crop as identity; sport-agnostic), but all its evidence is broadcast marketing, its score fields were unverifiable, and its pricing changes 2027-01-04. The question is whether any `hosted-video-search` candidate in the registry beats Veo on our games under the cost cap.

## Slot and candidates

Slot `hosted-video-search` from `candidates.json` (T14295). Run the cheapest candidate first; a second only if the first is NEAR. Candidate at filing: Twelve Labs Marengo 3.0 (+ Pegasus for labels). The script takes `--candidate <id>` and reads price, limits and terms from the registry.

## KPIs

| KPI | Definition (EPIC.md) | Pass bar |
|-----|----------------------|----------|
| P@K_veo, R@K_veo | precision and recall at Veo's own count, per game | strictly above Veo's P and R on a majority of games (Veo-team: recall is decisive, precision reported one-sided) |
| R@20 | recall of parent moments in the top 20 | at or above the floor (T14300, proposed 0.6) |
| AP | ranking quality | reported; used for the NEAR decision |
| $/game | plan rate and legacy rate, plus storage share at 50 games/month, at the price in the registry | at or under $5 |
| Wall-clock | upload + index + query per game | reported; over 60 minutes is a R11 note for T14340 |
| Terms | retention, training use, deletion, children's video | can / cannot verdict with the URL and date |

## Setup

1. **Transcode** each T14300 game to the candidate's upload limit (for Twelve Labs: under 2 GB; 720p at 1 to 2 Mbps first; one game also at 1080p to see whether resolution matters) with FFmpeg, locally or on Modal.
2. **Index** on the cheapest plan that holds one game (Twelve Labs: Plus; delete the index after each game to stay inside the plan).
3. **Query** three styles per game and keep every result with its score: (a) text with number and kit color where a number exists; (b) description only; (c) composed query, crop of the child from the tap frame plus action text ("scores", "shoots", "makes a play", "loses the ball"). For each style also the sport-neutral "notable play involving this player".
4. **Labels (optional):** the candidate's analysis model (Pegasus) on the top 20 per game asking highlight / learning / neither; label kappa recorded.
5. **Score** every style with `score.py` against the ground truth and the Veo baseline; results per game in `results/T14310-{candidate}-{game}.md` with raw JSON kept.
6. **Terms review (R12)** written up with the registry entry updated.
- Budget: under $50 per candidate; time box one week per candidate.
- Registry must be under 60 days old (else T14295 refresh mode first).

## Decision

- **PASS** (all pass bars, best query style): T14340 integrates this candidate; T14320 and T14330 set OBSOLETE in PLAN.md.
- **NEAR** (beats Veo on recall but not precision, or $/game between $5 and $10): one tuning round, which is either the second-cheapest candidate or a re-rank of the top 40 results with a `video-vlm` registry candidate (the T14330 prompt), re-scored once. PASS or FAIL after that; no third round without the user.
- **FAIL** (misses the Veo bar or the floor on the majority of games, or terms say cannot): T14320 starts. Record which failure mode (identity, ranking, cost, terms) since it tells T14330 whether a hybrid is worth a later pilot.

## Context

### Relevant Files (REQUIRED)
- `scripts/prototypes/player_moments/hosted_search_pilot.py` (new; `--candidate`, reads ground truth, writes predictions in `score.py`'s format)
- `scripts/prototypes/player_moments/results/T14310-*.md` (new; per candidate per game, numbers plus raw top-20 lists)
- Reference: [EPIC.md](EPIC.md), [research report](../../research/player-moments-research-2026-10-31.md) section on Twelve Labs

### Related Tasks
- Depends on: T14295, T14300
- Decides: whether T14320 and T14330 run at all

### Technical Notes
- Official SDK; API key in `.env` only.
- Record the exact response shape and score fields the API returns (unverified at filing).
- Keep raw responses so numbers can be re-derived.

## Implementation

### Steps
1. [ ] Transcode the T14300 games; record sizes
2. [ ] Index one game on the first candidate; confirm the response shape and score fields
3. [ ] Three query styles on every game; predictions written
4. [ ] Score against ground truth and the Veo bar; results files
5. [ ] Terms review; registry entry updated
6. [ ] Verdict (PASS / NEAR / FAIL) recorded in EPIC.md with the failure mode

### Progress Log

**2026-10-31**: Filed from the research session.
**2026-11-01**: Rewritten as a slot pilot with KPIs, setup, and the PASS / NEAR / FAIL decision.

## Acceptance Criteria

- [ ] Every T14300 game indexed and queried in all three styles on the first candidate, raw responses kept
- [ ] P@K_veo, R@K_veo, R@20, AP, $/game, wall-clock recorded per game next to Veo's numbers
- [ ] Projected $/game at 50 games/month under the plan model recorded
- [ ] R12 terms verdict written and the registry entry updated
- [ ] Verdict recorded in EPIC.md; on PASS, T14320 and T14330 set to OBSOLETE in PLAN.md
