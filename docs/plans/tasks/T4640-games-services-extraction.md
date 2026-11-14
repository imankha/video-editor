# T4640: One share flow for games

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

Sharing a game with another parent and sharing a game's playback are two copies, about 240 lines each, of the same steps on the server. One sync bug has already had to be fixed in both. Merge them into one flow with the two real differences passed in. Nothing a parent sees changes. Worked when both share buttons behave as before under the existing tests and a new test runs the same cases through both.

## Implementer details

- `share_game` and `share_playback` in `src/backend/app/routers/games.py` are parallel, including the same `RefreshFailed, RecipientProfileBelowHead, MigrationBlocked` to `create_pending_share` block. Both are live (`ShareGameModal.jsx`, `SharePlaybackDialog.jsx`).
- One `share_game_flow` in a service, with the email function and the existing-share lookup as parameters. Characterization tests for both endpoints first.
- Not in scope: extracting `activate_game` or `create_game`; that is code motion with no path removed.
- Knowledge docs: `.claude/knowledge/backend-services.md`, `.claude/knowledge/persistence-sync.md`.

## Acceptance Criteria

- [ ] Both endpoints call one shared flow; the pending-share fallback exists once.
- [ ] Characterization tests written before the change pass unchanged after it.
