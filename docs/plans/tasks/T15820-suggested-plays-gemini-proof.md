# T15820: Suggested plays proof

## In plain words

Today a parent who uploads a whole game must scrub up to ninety minutes to mark plays, and only 19 of 100 game uploaders go on to pay for a highlight, against 45 of 100 who arrive with clips already cut. Hosted video models can now watch a game at one frame per second with the audio and list likely plays with timestamps for about 16 to 41 cents a game; published tests suggest they find roughly three quarters of real plays while suggesting two to four times too many. Before building anything we spend one day and about five dollars running two such models on ten games that parents already marked by hand, and score how many marked plays were found and how many candidates came back. The bar, which you confirm first: three quarters found, sixty or fewer candidates per game. The result is a short note with a go or a no-go.


**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 3, Suggested plays by AI (see PLAN.md)

## How we got here

Owner 2026-11-09: "what users really want is for the AI to just mark all of the plays itself";
viability must be technical and economic (the charge passes to users after 3 free games). Research
the same day (docs/plans/research/player-moments-research-2026-10-31.md plus the 2026-11-09 web
sweep): hosted Gemini at 1 frame per second with audio found 10 to 12 of 16 shots on a broadcast
clip; the one full-game amateur study (youth hockey, Sci. Reports 2026-03) got recall 0.79 at
precision 0.25; no open spotter is trained on amateur wide-shot footage. Cost per 90-minute game:
Gemini 3.5 Flash-Lite about $0.16 at low media resolution with audio, 3.8 Flash $0.41 (doubles
2027-01-01). Prod: game uploaders reach a paid highlight at 19%, clip-only users at 45%; the 90-minute
scrub is the structural gap.

## The problem

Nobody has measured recall and candidate count on our footage. Everything else (UI, table, accept
gesture) already exists from the Veo import (T13210 `play_suggestions`, T13220 suggestions list).

## What we will do

A script and a scorecard, no product code.

1. Ground truth: 10 games already hand-marked by parents, from the dev fixture account and owner
   accounts (no other user's footage without consent). Export each game's `raw_clips` boundaries
   and ratings as the truth set.
2. Transcode each game on Modal or locally to 720p at 1 to 2 Mbps (Gemini samples at 1 fps anyway;
   Files API cap is 2 GB), split into 15-minute chunks with `start_offset` / `end_offset` to avoid the
   known timestamp drift on long videos.
3. Prompt for timestamped goals, shots, saves, tackles, big runs, turnovers, with a reasoning field
   before a 0 to 1 confidence in a JSON `response_schema`; sport given as text. Run 3.5 Flash-Lite and
   3.8 Flash at low media resolution with audio; one game also at high resolution.
4. Score: recall of parent-marked plays within 5 s, candidate count per game, precision, cost per
   game, and wall-clock. Record per sport and per camera (phone, Veo wide shot, DJI).
5. Write `docs/plans/research/suggested-plays-proof-2026-11.md` with the table and a GO / NO-GO.

GO threshold (owner to confirm before the run): recall 75% or better with 60 or fewer candidates per
game on at least the soccer games. If candidate count is the only failure, note whether a cheap audio
energy prefilter would fix it; do not build it here.

## How we will know it worked

- [ ] `scripts/prototypes/suggested_plays/` holds the transcode, chunk, prompt and scoring script with a README; runs end to end on one game from a clean checkout with an API key.
- [ ] The research note has recall, precision, candidates and cost for 10 games, two models, by sport and camera.
- [ ] A GO / NO-GO against the stated threshold, and the recommended model and settings for T15830.
- [ ] Total API spend recorded (expected under $10).

## For the implementer

### Related Tasks
T15830 (the feature, gated on GO), T13200 to T13240 (Veo import, the UI this lands in), T14300
(per-player ground truth games can be the same games), T14295 to T14340 (Player Moments, the
per-player tier after this).

### Relevant Files (REQUIRED)
- `src/backend/app/routers/suggestions.py` (the contract the output must fit)
- `src/backend/app/migrations/profile_db/v059_play_suggestions.py`
- `src/backend/app/routers/clips.py` (raw_clips as ground truth)
- `scripts/prototypes/` (new folder; `scripts/prototypes/player_moments/candidates.json` is where T14295 will write its registry)
- `docs/plans/research/player-moments-research-2026-10-31.md`
