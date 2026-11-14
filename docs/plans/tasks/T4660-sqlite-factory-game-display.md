# T4660: One game name builder

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

The name shown for a game, such as the opponent and the date, is built by three separate pieces of server code, and two of them have already drifted in how they write the date. Keep one and use it everywhere. Worked when the same game reads the same on Home, in downloads and in collections, checked by one test over all three.

## Implementer details

- `src/backend/app/routers/projects.py` and `downloads.py` each carry about 100 lines of game display naming; `downloads.py` uses `short_game_date()` while `projects.py` still has an inline `strptime` block. A third implementation is `generate_game_display_name` in `games.py` with five callers.
- One `services/game_display.py` used by projects, downloads, collections and `download_metadata`. First check whether the two date formats differ on screen today; if they do, the owner picks which one stays.
- The remaining `game_type` string literals sit inside the duplicated code and go with it.
- The per-user database opener half of the old scope is done (`services/db_residency.py` `connect_db`).

## Acceptance Criteria

- [ ] One function builds a game's display name; `projects.py` and `downloads.py` hold no copy.
- [ ] A test feeds the same game through the project list, the downloads list and a collection and gets the same name.
