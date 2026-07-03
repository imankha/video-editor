# T4660: open_sqlite Factory + game_display Service (Small Backend Dedup)

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-03
**Source:** Audit item E10 ([audit doc](../audit-2026-07-03-code-quality.md))

## Problem

[DRY] Two small, contained duplications — one of which is a latent reliability bug:

1. **Connection recipe drift.** Canonical `database.py:1045` `get_db_connection()` sets Row factory + WAL + `busy_timeout=30000` + FK enforcement (168 call sites — good adoption). But the recipe is copy-pasted in `services/user_db.py:190/:222-227` and `services/materialization.py:30-35` (+ read-only variant :86-88), and **`routers/privacy.py:65-66/:87-88` connects raw with NO timeout/PRAGMAs** — under R2-sync write load that's `database is locked` errors waiting to happen on the privacy endpoints.
2. **game display naming ~100 lines byte-identical:** `_get_season_for_month` + `_generate_game_display_name` + `_generate_group_key` duplicated between `projects.py:58-160` and `downloads.py:67-166`. Naming rules WILL change (they did in T4160/T4190); next time someone fixes one copy.

## Solution

1. `open_sqlite(path, *, readonly=False)` in `database.py` (or a tiny module) — the one place PRAGMAs live. Migrate user_db.py, materialization.py, privacy.py to it. Check each copy's variance first (materialization's read-only variant becomes the `readonly` flag; user.sqlite may differ deliberately — verify against `_USER_DB_SCHEMA` setup).
2. `services/game_display.py` — move the three functions; both routers import. Pure motion; grep for a THIRD copy while at it (`grep -rn "_generate_game_display_name\|season" src/backend/app`).

## Steps

1. [ ] Diff the connection copies (variance table); factory + migrate; import check.
2. [ ] Manual: privacy endpoints on dev (they now hold PRAGMAs — behavior should only improve under lock contention).
3. [ ] game_display motion commit; both routers' display outputs unchanged (existing tests / snapshot a `list_downloads` response before+after).

## Acceptance Criteria

- [ ] One PRAGMA recipe; privacy.py no longer connects raw
- [ ] One game-display implementation; response parity verified
- [ ] Any third naming copy found is included or filed
