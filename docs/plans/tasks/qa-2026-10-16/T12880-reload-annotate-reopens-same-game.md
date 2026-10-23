# T12880: Reloading the game editor reopens the same game instead of returning to Games

**Status:** STAGING
**Impact:** 3
**Complexity:** 3
**Tier:** M (frontend routing, 2-4 files)
**Created:** 2026-10-16
**Milestone:** Next build (external QA 2026-10-16). Present on prod (by design today), so it does not block the deploy.

## Problem

External QA B03 ([report](../../ux/2026-10-16-external-qa/QA-REPORT.md), screenshots
`screenshots/B03_game_1440x900_before-reload.png`, `B03_reload_1440x900_editor-returns-home.png`).
Reloading `/annotate` lands on `/home/games`. Nothing is lost, but the parent has to find and reopen
the game. Phones reload tabs on their own when backgrounded, so this happens without a deliberate reload.

## Current code

The URL is `/annotate` with no game id. On a cold load the mode comes from the URL
(`editorStore.js:168-172`); the game arrives only through the one-shot `pendingGameId` breadcrumb
(`AnnotateScreen.jsx:571` `consumePendingGame`). With no video after reload, `AnnotateScreen.jsx:709-715`
`redirectToMode(PROJECT_MANAGER)`. Identical on prod (`:675-682`).

## Solution options

- A (recommended): game id in the URL (`/annotate/:gameId`): editorStore MODE_PATHS/modeFromPath, App
  routing, AnnotateScreen. ~60-100 LOC. Deep links and reload both work.
- B: remember the last game id in sessionStorage and re-seed `pendingGameId` on cold load. ~20-30 LOC,
  reload only.

Pick at classification; check whether Focus/Spotlight reload has the same gap and fold it in if so.

## Acceptance Criteria

- [ ] Red-first test: cold load of the editor route for a saved game opens that game, not Games
- [ ] Live: reload in the game editor on desktop and phone reopens the same game with its plays
