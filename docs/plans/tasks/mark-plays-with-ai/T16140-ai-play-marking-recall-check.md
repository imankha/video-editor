# T16140: AI play marking recall check

## In plain words

Today a working prototype can send a soccer game to the chosen video model in five-minute pieces and get back a list of plays (marked moments) with tags, ratings and notes. It has only been run on clips of twenty minutes or less, on a free key, and nobody has compared an answer with the video. Before we charge parents for it, we run it on three full games that were already marked by hand and count how many of the hand-marked plays the model found, how many strong plays it returns per team, what it really cost and how long it really took. We check a paid feature against the truth once because a missed highlight is the failure parents will not forgive. Done when a short note gives those four numbers for three games, confirms or corrects the price of 1.5 credits a minute, and says go or no-go.

**Status:** WAITING ON USER (design review: https://claude.ai/artifact/AfoPPibjtfSS3HKx5ktoh9)
**Impact:** 8
**Complexity:** 2
**Tier:** M (scripts and a research note; no product code)
**Created:** 2026-11-12
**Updated:** 2026-11-12

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 2 of 8.

## Problem

The epic's price, wait times and import rule all rest on numbers measured on short clips. The prototype's own handoff lists what is unknown: recall of highlights, plays that straddle two windows, calls that stop early without an error, each call choosing its own team colours, and the limits of a paid key for 18 calls at once.

## Solution

Extend the prototype in `gemini_analysis_test/` into a full-game runner and a scorecard. Read `gemini_analysis_test/HANDOFF_PROMPT.md` first.

1. **Full-game runner.** Upload once, analyse consecutive 5-minute windows in parallel with `run_interactions.py`'s call shape (`--processing static`, `start_offset` / `end_offset`). Add the four behaviours production needs, so T16150 can lift them:
   - coverage check: if the last play ends well before the window's end, ask again for the uncovered remainder;
   - team colours: run the first window alone, then pass its two kit colours into the prompt of every other window;
   - window overlap: windows overlap by 10 seconds; plays that overlap by half or more across a boundary are merged;
   - empty or implausibly short answers count as failures and are retried.
2. **Three games.** Full soccer games from `formal annotations/` that have hand-marked plays, at least one per camera type present (Veo wide shot, DJI). Owner's own footage only.
3. **Score.** For each game: hand-marked plays found (a model play overlapping the marked play by half of the shorter one), plays returned in total, plays with relevance 4 or 5 for the marked team, how many windows needed a second request, total tokens and dollars, wall-clock time split into upload, preparation and analysis.
4. **Spot check.** Watch 20 imported-grade plays per game and note wrong tags, wrong team, timestamps off by more than 3 seconds, and whether the rating rule in T16190 gives a sensible star rating.
5. **Note.** `docs/plans/research/ai-play-marking-recall-2026-11.md` with the table, the measured cost per minute, the recommended relevance threshold, the recommended price, and GO or NO-GO.

GO bar (owner may change before the run): three quarters of hand-marked plays found, and no more than 80 imported-grade plays per team per game.

## Why this and not something else

Shipping first and reading complaints was ruled out because the feature is paid and sold as coach-level. A larger study (ten games, several models) was ruled out because the model is already decided; this only checks that the decided design holds on full games.

## For the implementer

### Relevant Files (REQUIRED)
- `gemini_analysis_test/run_interactions.py`, `run_analysis.py`, `prompts.py`, `estimate_cost.py`, `pricing.py`
- `gemini_analysis_test/run_full_game.py` (new), `score_recall.py` (new)
- `formal annotations/u14 adonis/`, `formal annotations/u14 phillips/` (ground truth)
- `docs/plans/research/ai-play-marking-recall-2026-11.md` (new)

### Technical Notes
- Needs a paid Gemini key: the free tier allows 20 requests a day and 2 GB per file. The owner enables billing; the key stays in `gemini_analysis_test/.env`, never printed or committed.
- `gemini_analysis_test/` is untracked today. Commit the code and `HANDOFF_PROMPT.md`; keep `.env`, `videos/` and large `outputs/` out of git.
- API facts that bite: `api_version="v1beta"`, set a timeout, retry 503 and 403 SERVICE_DISABLED, never retry 429.
- Expected spend: about $9 for three games plus retries.

### Related Tasks
- Feeds: T16150 (the four behaviours), T16160 (price), T16190 (threshold and rating rule).

## Acceptance Criteria

- [ ] `run_full_game.py` analyses one full game end to end from a clean checkout with a paid key, and reports every window as covered.
- [ ] The note has, for three games: hand-marked plays found, total plays, imported-grade plays per team, second requests, dollars, and the three wall-clock times.
- [ ] The note states the measured cost per minute of video and whether 1.5 credits a minute stays profitable on the Season pack.
- [ ] The note states GO or NO-GO against the bar and recommends the relevance threshold for import.
- [ ] Total API spend is recorded.
