# T13850: Game card reel_count never refreshed by restore, delete or move

**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-28
**Updated:** 2026-10-28
**Milestone:** Release check bugs (bugs first), see PLAN.md
**Blocked by:**

## Found by

T13820 sync QA matrix (Playwright + `window.__syncCheck` + `GET /api/qa/sync-state`). The spec stays in `src/frontend/e2e/sync/` as `test.fixme('T13850 ...')` with the assertion intact; landing the fix flips it green (remove the `fixme` and the `known` entry).

## Evidence
- S2 (restore), S4 (delete), S5 (move), S6/S12 (restore): after the gesture `__syncCheck` reports `gamesDataStore.games` client `reel_count` 1 (S6: 2) vs server 0 (S6: 1); newer write = `restore` / `delete-highlight` / `move`; last refresh = none. Correct again after reload, so class (a): holder never refreshed by this gesture.
- Files: `qa/sync/S2/chromium/2-after-restore/`, `qa/sync/S4/chromium/2-after-delete/`, `qa/sync/S5/chromium/2-after-move-source/`, `qa/sync/S6/chromium/2-after-first-restore/` (screen.png, check.json, trace.json, probe.json).
- [STATE]: `gesture=restore req_id=2f1982d7 ... downloads_count=1 game_reel_count=1:1 outcome=ok` (server already correct).
- Holder: `gamesDataStore.games[].reel_count` read by `GameTile.jsx:109-115`; no gesture calls `invalidateGames`/`fetchGames` after publish/restore/delete/move.

## Fix direction
Call `useGamesDataStore.getState().invalidateGames('<gesture>')` (or `fetchGames({force:true, reason})`) in the restore (`useReEditReel`), delete (`PublishedReelsPanel.confirmDelete`) and move handlers, next to the existing count refreshes. Publish is covered by the same handler pattern.

## Acceptance Criteria

- [ ] The `T13850` fixme spec is un-fixmed and passes on chromium and iphone-sync (`npx playwright test e2e/sync --project=chromium --project=iphone-sync --workers=1`)
- [ ] Fix stays in the paradigm: refresh in the gesture handler (or subscribe the copy to the store); no `useEffect` that persists
