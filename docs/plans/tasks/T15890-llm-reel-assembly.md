# T15890: Suggested reel

## In plain words

After reels exist, a model can suggest which highlights to include, in what order, with a title and section cards, for about a cent per reel. The parent still edits and finishes. Before it is on by default we compare its suggestions with ten reels you build by hand.


**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 6, Highlight reels and recruiting kit (see PLAN.md). After T11300 and T15880.

## The problem

Assembling a reel is a chore: which highlights, what order, what the section cards say. Competitors
sell "AI picks the best" (Klap, NextPlay). The cost is negligible: per-play metadata plus 1 fps
thumbnails for a 10-highlight reel is 20 to 30k tokens, about $0.003 to $0.01 on Haiku 5.5 or Gemini
Flash-Lite.

## What we will do

1. "Suggest a reel" on the Reels tab: the model receives each finished highlight's rating, tag, sport,
   duration, game date and three thumbnails, and returns an ordered pick list with a one-line reason
   per pick, a reel title and section-card text, in a JSON schema with reasoning before scores.
2. The result opens the Arrange step pre-filled; the parent edits as usual. Nothing is exported
   without the parent's Finish.
3. Rank is a rank, not a probability; the Best-first default (T11300 decision 3) stays available.
4. Evaluate on labelled reels: 10 reels the owner would build by hand against the suggestion, scored
   by overlap and order agreement, before the button ships by default.

## How we will know it worked

- [ ] Suggest a reel returns an ordered list with title and section cards for an account with 5 or more finished highlights in under 20 s, on phone and desktop.
- [ ] The owner's 10 hand-built reels overlap the suggestion by at least 70% of picks on average (recorded in the task file).
- [ ] Model name and prompt are config; cost per call is logged.

## For the implementer

### Related Tasks
T11300, T15880, T16150 (shares the model config), T3600 to T3640 (collections ranking).

### Relevant Files (REQUIRED)
- `src/backend/app/routers/reels.py` (new in T11300)
- `src/backend/app/routers/collections.py` (ranking, Glicko order)
- `src/frontend/src/components/reels/` (new in T11300)
