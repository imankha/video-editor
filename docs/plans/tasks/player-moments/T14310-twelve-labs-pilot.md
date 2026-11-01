# T14310: Prototype 1: Twelve Labs end to end (upload game, tap-crop query, scored moments)

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Tier:** S (prototype script under `scripts/prototypes/`, no app code; budget under $50 total)
**Created:** 2026-10-31
**Updated:** 2026-10-31
**Epic:** [Player Moments](EPIC.md), task 2/5. Retires R4, R12 (terms review). **If this passes, T14320 and T14330 become OBSOLETE and T14340 integrates Twelve Labs.**

## Problem

Twelve Labs is the only hosted product whose API is literally "query a whole game, get time-stamped, confidence-scored clips", and its composed image-plus-text query accepts a crop from the parent's tap as the identity. It is sport-agnostic. But every piece of evidence is vendor marketing on broadcast footage, the Search API reference returned 404 during research, and pricing is moving to storage plans on 2027-01-04. One week and under $50 settles whether the whole epic can be a thin integration instead of a build.

## Solution

A standalone script that runs the full loop on the T14300 games and scores it with T14300's `score.py`.

1. **Transcode** each game to under 2 GB (1 to 2 Mbps, 720p is fine for a first pass; keep a 1080p run for one game to see whether resolution matters) with FFmpeg, locally or on Modal.
2. **Index** on a Twelve Labs Plus plan (storage-based; delete the index after each game to stay inside the plan) with Marengo 3.0, on-screen text modality enabled.
3. **Query** three styles per game and record every result with its score: (a) text only, "player in {kit color} number {N} ..." where a number exists; (b) description only, no number; (c) composed query, crop of the child from the tap frame plus action text ("scores", "shoots", "makes a play", "loses the ball"). For each style, also try the sport-neutral generic prompt "notable play involving this player".
4. **Optionally** run Pegasus Analyze on the top 20 clips per game asking "is this a highlight, a learning opportunity, or neither for the player in the crop" to see whether its labels agree with the parent's.
5. **Measure** with `score.py`: recall@10/@20, top-10 precision, time per game, dollars per game at the plan rates and at the legacy per-minute rates, and what the per-game storage cost would be at 50 games per month.
6. **Terms review (R12):** read Twelve Labs' data retention, training-use, and deletion terms; record whether children's game video can be sent under the landing's kids'-privacy stance and what the UI would have to disclose.

## Context

### Relevant Files (REQUIRED)
- `scripts/prototypes/player_moments/twelvelabs_pilot.py` (new; reads ground truth from T14300, writes predictions in `score.py`'s format)
- `scripts/prototypes/player_moments/results/T14310-*.md` (new; one results file per game with the numbers and the raw top-20 lists)
- Reference: [EPIC.md](EPIC.md), [research report](../../research/player-moments-research-2026-10-31.md) section "Twelve Labs is the one API built for query to scored timestamps"

### Related Tasks
- Depends on: T14300
- Decides: whether T14320 and T14330 run at all

### Technical Notes
- Use the official Twelve Labs SDK; API key in `.env` only, never in the script.
- The research could not verify the Search result's score fields from the primary docs; record the exact response shape the API returns.
- Keep raw responses (JSON) in the results folder so the numbers can be re-derived.

## Implementation

### Steps
1. [ ] Transcode the T14300 games; record sizes
2. [ ] Index one game; confirm the response shape and the score fields
3. [ ] Run the three query styles on every game; write predictions
4. [ ] Score; write the results files
5. [ ] Terms review written up
6. [ ] Verdict against the T14300 kill criterion recorded in EPIC.md

### Progress Log

**2026-10-31**: Filed from the research session.

## Acceptance Criteria

- [ ] Every T14300 game indexed and queried in all three styles, raw responses kept
- [ ] recall@20, top-10 precision, time and dollars per game recorded per game
- [ ] Projected cost per game at 50 games/month under the plan model, including storage retention, recorded
- [ ] R12 terms review written with a clear can/cannot verdict
- [ ] PASS or FAIL against the kill criterion written in EPIC.md; on PASS, T14320 and T14330 set to OBSOLETE in PLAN.md
