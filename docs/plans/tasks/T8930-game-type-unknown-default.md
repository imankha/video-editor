# T8930: Game Type defaults to Unknown, not Home

**Status:** STAGING
**Impact:** 3
**Complexity:** 1
**Created:** 2026-09-05

## Problem

Live-testing feedback on staging (T8810's universal dropzone): `GameDetailsModal`'s Game
Type selector (Home/Away/Tournament) lives inside the collapsed "More options" disclosure
(T8500's video-first redesign). A user who never opens that disclosure silently gets
`GameType.HOME` as the recorded type — the backend then names the game "Vs {Opponent}" as
if it were confirmed to be a home game, which is misleading when nobody ever chose that.

## Solution

Add a fourth `GameType.UNKNOWN` value and make it the actual default (both at create-time
in `GameDetailsModal` and for existing games with no recorded type in `EditGameModal`), so
silence means "we don't know," not a fabricated "Home."

- `gameConstants.js`: add `UNKNOWN: 'unknown'` to the `GameType` enum.
- `GameDetailsModal.jsx`: default state `GameType.UNKNOWN` (was `GameType.HOME`); add an
  "Unknown" button to the Game Type row (leftmost, matching its default-state role);
  `resetForm` resets to `GameType.UNKNOWN`.
- `EditGameModal.jsx`: initial state `GameType.UNKNOWN`; `game.game_type || GameType.HOME`
  fallback becomes `game.game_type || GameType.UNKNOWN` (an existing game with no recorded
  type shows Unknown, not a silently-assumed Home); add the same "Unknown" button.
- Backend: no change needed. `game_type` is `str | None` (not enum-validated) in
  `CreateGameRequest`/games.py, and `generate_game_display_name`'s `else: # home or
  default -> prefix = "Vs"` branch already handles any non-away/non-tournament value
  safely, including `"unknown"`.

## Relevant Files

- `src/frontend/src/constants/gameConstants.js`
- `src/frontend/src/components/GameDetailsModal.jsx`
- `src/frontend/src/components/EditGameModal.jsx`
- Existing tests referencing `GameType.HOME` as the create-time default (grep before
  editing): `GameDetailsModal.videoFirst.test.jsx` and any `EditGameModal` test file.

## Acceptance Criteria

- [ ] A game created without opening "More options" records `game_type: 'unknown'`, not
      `'home'`
- [ ] Game Type row shows four options: Unknown (default/selected), Home, Away, Tournament
- [ ] Editing an existing game with no recorded type shows "Unknown" selected, not "Home"
- [ ] Display name generation is unaffected (still "Vs {Opponent}" for unknown/home,
      "at {Opponent}" for away, tournament format unchanged)
- [ ] Curated test set green
