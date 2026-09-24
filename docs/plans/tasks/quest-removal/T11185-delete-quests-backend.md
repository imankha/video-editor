# T11185: Delete the quest system, backend (+ optional table drops)

**Status:** TODO
**Impact:** 4
**Complexity:** 4
**Created:** 2026-09-24
**Epic:** [Remove the Quest System](EPIC.md)

## Solution (pure deletion, ~2,200 LOC)

- `routers/quests.py` (all), `main.py:113,285`, `routers/__init__.py:33,39`.
- `quest_config.py` (after T11170 moved the credit constant), incl. `TUTORIAL_VIDEOS_ENABLED` (`:44`).
- `bootstrap.py:27,88-127,273` (`quests_progress`, `quest_panel_collapsed`).
- `db_sync.py:650-661` (skip-sync), `:673-674` (auth allowlist).
- `user_db.py` helpers `:490-568` (mark/get/backfill), `:651-675` (panel-collapsed KV);
  `session_init.py:359-364` (per-login backfill, a Postgres query on every login).
- Tests to delete: `test_quest_migration`, `test_quests_progress_connections`,
  `test_t5970_quest_shared_by_migration_window`, `test_overlay_quest_move`,
  `test_quest_reward_reference_id`, `test_rate_clip_step`, `test_return_home_step`,
  `test_achievement_post_returns_progress`, `test_t9410_tutorial_step_gating`,
  `test_tutorial_quest_steps`, `test_t9850_playback_step_gating`. Edit
  `test_performance.py:59-134`, `test_auto_materialize.py:357`, `test_t7890`; fix imports in
  `test_t8120`, `test_t9760`, `test_delete_reregister_newuser_flow`.

**Keep:** user_db migrations v005/v006 (mid-list, cannot be pruned), the `quest_completed` and
`watched_*_tutorial` `FLOW_EVENTS` entries (`analytics.py:172,248-251`, label history),
`games.shared_by` / `raw_clips.shared_by`, all Postgres `credit_transactions` and
`user_actions` rows.

**Tables (G5):** if "drop": guard v005/v006 with a table-exists check FIRST (they read
`completed_quests`; a user.sqlite below v005 would otherwise 503), then a `user_db` migration
drops `completed_quests` + deletes the panel-collapsed setting, and a `profile_db` migration
drops `achievements` (`database.py:1461-1467`). Both JIT, no operator step. Include the
Migration agent. If "inert": keep the DDL, stop reading/writing.

Also amend T7620 §13.1 / T7630 / T10330:40-41 (G3) and the knowledge docs.

## Related Tasks
- Depends on: T11170, T11175, T11180 (never deploy before the frontend deletion)

## Acceptance Criteria

- [ ] `/api/quests/*` returns 404; no quest symbols remain
- [ ] A user.sqlite at v004 still migrates to head (test), whatever G5 rules
- [ ] Session init runs no quest backfill query
