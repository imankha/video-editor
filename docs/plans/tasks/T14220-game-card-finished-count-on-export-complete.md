# T14220: Game card "finished" count does not update when a highlight finishes

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-10-31
**Updated:** 2026-10-31

## Problem

QA sweep 2026-10-31 (390x844 and 1440x900). After a highlight finishes, returning to Games
through in-app navigation shows the OLD "{n} finished" count on that game's card, while the
overall Finished tab count has already gone up. A full browser refresh corrects it.

- Vs legends Sep 5: stayed at 1 finished after finishing "QA sweep Oct 31"; refresh showed 2.
- Vs LA Breakers May 9: stayed at 6 after finishing "dfsadf"; refresh showed 7.

A returning parent sees the two counts disagree and can doubt the highlight saved or landed on
the right game. Data is correct; only the client view is stale.

## Root cause (confirmed by code read)

T13850 added `applyReelCountDelta(reel, delta, reason)` in
`src/frontend/src/stores/gamesDataStore.js` as the change event for game-card `reel_count`.
It is called with -1 on restore (`hooks/useReEditReel.js`), delete and move
(`components/PublishedReelsPanel.jsx`), but NOTHING calls it with +1 when an export completes
and a new published highlight appears. The gallery store count updates; the games store does not.

## Solution

On the export-complete change event (the same place the gallery count learns of the new
highlight), call `useGamesDataStore.getState().applyReelCountDelta(reel, +1, 'export-complete')`
with the reel's frozen `game_ids`. Localized delta per event; no refetch, no reload
(user rule: UI updates on change events, never refresh). The single-game rule
(`game_ids.length === 1`) already lives in the action and mirrors backend `_compute_reel_counts`.

Check that re-exporting an EXISTING highlight ("dfsadf" case) that replaces a final video is
counted the same way the backend counts it (a re-export that only replaces should not double
count; the QA data says the backend count did go up by 1, so confirm what the backend does).

## Context

### Relevant Files
- `src/frontend/src/stores/gamesDataStore.js` - `applyReelCountDelta`
- `src/frontend/src/stores/gamesDataStore.reelCount.test.js` - existing T13850 tests
- Export completion handler: find where the gallery store count is bumped on completion
  (`GlobalExportIndicator.jsx` / export WebSocket handling / `galleryStore`)
- `src/frontend/src/components/GameTile.jsx` - renders `reel_count`
- `src/backend/app/routers/games.py` - `_compute_reel_counts` (reference only)

### Knowledge Docs
- `.claude/knowledge/export-pipeline.md`

## Acceptance Criteria

- [ ] Failing test first: an export-complete event for a single-game reel bumps that game's
      `reel_count` by 1 in `games` and `readyGames`; a mix (2+ game_ids) bumps nothing
- [ ] Finishing a highlight then navigating to Games shows the new count without a refresh
- [ ] Re-export of an existing highlight matches the backend count after refresh
- [ ] No refetch of the games list introduced
