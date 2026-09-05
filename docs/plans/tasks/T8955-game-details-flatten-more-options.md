# T8955: Remove the "More options" disclosure — Game Type always visible

**Status:** STAGING
**Impact:** 3
**Complexity:** 1
**Created:** 2026-09-05
**Follows:** T8930 (added the Unknown default inside the disclosure this task removes)

## Problem

Live-testing feedback, same session as T8930/T8935/T8940/T8945: "no more 'more options',
just show the game type with the rest." T8930 fixed Game Type's silent Home default, but
the field still lived behind a collapsed `<details>` disclosure (`GameDetailsModal`'s
"More options", T8500's video-first redesign) — the user wants it always visible instead,
alongside Opponent Team and Game Date.

## Solution

Deleted the `<details>`/`<summary>` wrapper entirely. Game Type's button row and the
conditional Tournament Name field now render directly inside the same always-visible
`space-y-4` block as Opponent Team and Game Date. No new component, no new state — purely
a JSX flattening; `gameType`/`tournamentName`/`showTournamentDropdown` state and all their
handlers are unchanged.

`EditGameModal.jsx` was NOT touched — it never had a disclosure (Game Type has always been
directly visible there); this task only affected the create-time modal.

## Relevant Files

- `src/frontend/src/components/GameDetailsModal.jsx` — flattened the disclosure; removed
  the now-unused `ChevronRight` import
- `src/frontend/src/components/GameDetailsModal.videoFirst.test.jsx` — rewrote the two
  tests that asserted disclosure presence/closed-by-default into one asserting the
  disclosure is GONE and Game Type is reachable with zero interaction; dropped the
  now-pointless "open the disclosure" click from the opponent-override test
- `src/frontend/e2e/helpers/gameDetails.js` — `openGameDetailsDisclosure` (shared by ~14
  e2e specs) is now a no-op guard when the disclosure doesn't exist, so none of those
  specs needed individual edits
- `src/frontend/e2e/new-user-flow.spec.js` — dropped a direct `.open === false` assertion
  on the now-removed element
- `src/frontend/e2e/cta-visibility.spec.js` — a `test.fixme` (deferred to T8790, not
  currently run) had a locator anchored on the disclosure; repointed to a stable anchor
  (the dropzone heading) for hygiene, even though it doesn't run in CI today

## Acceptance Criteria

- [x] No "More options" text or `game-details-disclosure` testid anywhere in
      `GameDetailsModal`
- [x] Game Type's four buttons (Unknown/Home/Away/Tournament) are visible with zero
      interaction, same as Opponent Team and Game Date
- [x] Tournament Name still appears/disappears correctly based on the Game Type selection
- [x] Existing unit tests updated and green; `vitest related` (86 tests) green; eslint
      clean
- [x] All ~14 e2e specs calling `openGameDetailsDisclosure` continue to work unmodified
      via the helper's no-op guard
