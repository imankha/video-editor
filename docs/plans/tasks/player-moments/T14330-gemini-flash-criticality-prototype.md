# T14330: Prototype 3: Gemini Flash on the child's windows ("is this interesting, a highlight, a learning opportunity?")

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Tier:** M (prototype script, no app code; budget under $20 of API spend)
**Created:** 2026-10-31
**Updated:** 2026-10-31
**Epic:** [Player Moments](EPIC.md), task 4/5. Runs only if T14320 passed. Retires R5, R6, R7, R9, R13 (collects the data for the product decision).

## Problem

Tier 2 takes the seconds where tier 1 says the child is in frame, and asks a better model whether the moment matters for that child. The research says this is cheap on Gemini Flash-class models ($0.06 to $0.46 per game for 240 windows, Batch halves it) but has a real quality ceiling (human raters only moderately agree, best published VLM result MCC 0.50 on soccer), LLM timestamps drift on long video, and drawing a box on the child can halve accuracy while the same box as text helps. This prototype measures ranking quality and cost on our games, with the questions the user wants asked.

## Solution

1. **Windows.** From T14320's winning tracker, cut the game into 15-second windows where the child is present (merge adjacent ones, cap at 30 s). Record how many windows per game survive and what fraction of the game that is. Optionally run the nearly free audio pre-filter (frozen AST audio tagger on CPU) and record what fraction it keeps on our crowd-and-whistle audio (R9); it is an optimization, not a requirement.
2. **Prompts.** Per window, one structured-JSON call with reasoning before scores, asking exactly the user's questions: "Is this interesting for the player at {box as text coordinates, kit color, direction of play}? If so, which time ranges inside this window?", "Is this a highlight?", "Is this a learning opportunity?", each with a 0 to 1 score and a one-line reason. Timestamps the model returns are relative to the window and are snapped to the tracker's timeline (R6); the model never sees more than 30 s at a time.
3. **Visual prompting A/B (R7).** The same windows with (a) the child's box as text coordinates and (b) a drawn box or circle on the frames, per model. Keep whichever ranks better; expect (a).
4. **Models.** Gemini 2.5 Flash-Lite, 3.5 Flash-Lite, 3.8 Flash, and 3.1 Pro on the top candidates only; record tokens and dollars per game for each, standard and Batch. Low media resolution first; one game at high resolution to see whether it changes the ranking.
5. **Ranking.** Scores are ranks, not probabilities (R5). After the per-window pass, a listwise pass over the top 10 to 15 windows in one call ("order these by how notable they are for the player"); fit a simple Bradley-Terry or just use the listwise order. Score with T14300's `score.py`: recall@10/@20 of parent-marked moments, top-10 precision, Spearman against the parent's order, and per-label agreement for highlight vs learning.
6. **Sanity baseline.** One whole-game Gemini call per game at low resolution with no tracking ("list every notable moment for the player in {description}") to confirm that tier 1 is earning its cost.

## Context

### Relevant Files (REQUIRED)
- `scripts/prototypes/player_moments/gemini_criticality.py` (new; reads T14320 presence JSON and the transcoded game, writes predictions)
- `scripts/prototypes/player_moments/results/T14330-*.md` (new)
- Reference: [EPIC.md](EPIC.md), [research report](../../research/player-moments-research-2026-10-31.md) addendum, tier 2; Obsidian note `criticality_scoring_tier.md`

### Related Tasks
- Depends on: T14300, T14320 (PASS)
- Blocks: T14340

### Technical Notes
- Gemini Files API: 2 GB per file, 48-hour retention; clip one uploaded transcode by start and end offsets rather than uploading each window.
- Provider: Google Gemini (the user's choice for this tier); Claude Haiku 5.5 on sampled frames (about $0.22 per game, no audio) and a self-hosted Qwen3-VL-8B on Modal are recorded as alternatives in the research, not run here unless Gemini fails.
- Keep raw JSON responses for every window so scores can be re-derived.
- "Learning opportunity" results are collected but the product decision on showing them (R13) belongs to the user in T14340.

## Implementation

### Steps
1. [ ] Window extraction from T14320 output; counts per game
2. [ ] Prompt and JSON schema; text-coordinate vs drawn-box A/B
3. [ ] Run the four models; record tokens and dollars
4. [ ] Listwise refinement pass; score everything
5. [ ] Whole-game no-tracking baseline
6. [ ] Verdict against the T14300 ranking threshold recorded in EPIC.md

### Progress Log

**2026-10-31**: Filed from the research session.

## Acceptance Criteria

- [ ] recall@20, top-10 precision, Spearman, and per-label agreement recorded per model per game
- [ ] Dollars per game per model recorded (standard and Batch), including the tier 1 cost from T14320, with the total under $5
- [ ] Text-coordinates vs drawn-box result recorded
- [ ] Whole-game baseline recorded next to the two-tier result
- [ ] PASS or FAIL against the kill criterion written in EPIC.md
