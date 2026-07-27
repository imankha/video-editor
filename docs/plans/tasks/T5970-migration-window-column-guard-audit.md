# T5970: Audit hot-path SELECTs for columns a not-yet-run migration adds (migration-window 500s)

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-07-26
**Found by:** the 2026-07-26 full unit + staging-E2E sweep (one instance found and fixed; the class was not audited)

## The bug class

Versioned migrations **do NOT auto-run on deploy or startup** (CLAUDE.md § Migration System) —
they are triggered afterwards via `POST /api/admin/migrate`. So between a deploy and that
admin action, every per-user SQLite DB is still at the OLD schema while the NEW code is live.

A hot-path `SELECT` that names a column the pending migration adds therefore raises
`sqlite3.OperationalError: no such column: <x>` for **every** user in that window — not a
degraded read, a 500.

**Confirmed instance (already fixed, commit `6cc0c2a1` — do NOT redo it):**
`GET /api/export/projects/{id}/overlay-data` (`app/routers/export/overlay.py`) named
`working_videos.detections_data` (added by `profile_db/v027`) unconditionally. Caught because
`tests/test_highlight_persistence_bug.py::TestAPICodePath::test_api_endpoint_integration`
hits a live local server whose profile DB was below v027 and got a 500.

## The sanctioned guard (use it, don't invent a new one)

- `column_exists(cursor, table, column)` — `app/database.py:164`. Its docstring states the
  contract: "a hot read path must not crash on a column a not-yet-run migration will add.
  Callers SELECT the column only when present and default it otherwise (the column's own
  default is the correct value during the window)."
- `_has_stage_columns(conn)` — `app/routers/exports.py:44` (T5630's precedent for a
  two-column probe).

Existing correct call sites to copy: `routers/clips.py` (`working_clips.rotation`, 3 sites),
`routers/export/framing.py:398`, `routers/export/multi_clip.py:2096`, and the new
`routers/export/overlay.py` guard.

## Scope — audit these ADD COLUMN migrations

`grep -rn "ADD COLUMN" src/backend/app/migrations/` gives the full list. The **profile_db**
and **user_db** tracks are the ones that matter (Postgres uses `ADD COLUMN IF NOT EXISTS`
and a shared DB, so it does not have this failure mode).

Known-guarded already (verify, don't re-fix): `v028` stage/output_key, `v029` rotation,
`v027` detections_data.

**To audit** — for each, find every SELECT naming the column and decide guard-or-not:

| Migration | Column(s) | Table |
|---|---|---|
| profile_db/v005 | `highlight_shape` | working_videos |
| profile_db/v007 | collection metadata cols | (see file) |
| profile_db/v008 | `game_ids` | (see file) |
| profile_db/v009 | season-rank cols | (see file) |
| profile_db/v010 | ranking cols | (see file) |
| profile_db/v013 | `auto_export_attempts` | games |
| profile_db/v015 | `last_playhead_position` | (see file) |
| profile_db/v016 | `clip_game_start_time` | (see file) |
| profile_db/v024 | `poster_filename` | games |
| profile_db/v025 | `slowmo_section_start`, `slowmo_section_end` | (see file) |
| profile_db/v026 | `shared_by` | games |
| user_db/v004 | `total_usage_seconds` | (see file) |

A column only needs a guard if it is read on a path a user can hit **before** the migrate —
i.e. reachable from normal app load / list / open flows. A column read only by the migration
itself, by an admin-only endpoint, or by a path gated behind the migrate does not.
**Do not blanket-guard everything**: each guard is a branch, and CLAUDE.md forbids defensive
code for states that cannot occur. Justify each one in the commit.

## Second deliverable: is v027 actually migrated?

The 500 above was reproduced on a REAL local profile DB, which means at least one live DB was
below v027. Determine whether v027 (and everything up to head) has actually been run on
**staging** and **prod**, and run it if not.

- Runner: `POST /api/admin/migrate` (admin session), or the `fly ssh` fallback in CLAUDE.md.
- Gotcha (memory `reference_running_migrations`): only migrations with version > the DB's
  current `PRAGMA user_version` are applied, and `run_all_migrations` walks EVERY user's R2 DB.
- Gotcha (memory `reference_migration_runner_rowfactory`): `up(conn)` gets a **tuple** row
  factory, not `sqlite3.Row` — index positionally. A past migration (v017) crashed on this for
  4 prod users.
- There is a known gap (memory `project_migration_tracking_gap`): no endpoint reports what has
  been run. If cheap, add a read-only migration-status endpoint as part of this task — that is
  what makes the audit checkable next time instead of re-derivable.

## Acceptance criteria

1. Every profile_db/user_db ADD COLUMN column above is classified: guarded, or justified as
   not-needing-a-guard (written down, per column).
2. Any unguarded hot-path read found is fixed with `column_exists`, defaulting to the column's
   own default during the window.
3. A regression test that a below-head profile DB does NOT 500 on the audited read paths —
   test WITH data (build a DB at the pre-migration schema and hit the endpoint), not just a
   schema assertion. Mirror `test_t5600_detections_data_migration.py`'s approach.
4. Head-schema status of staging and prod stated with evidence; migrate run if behind.
5. `.claude/knowledge/backend-services.md` (and `persistence-sync.md` if touched) updated with
   the audit result so the next task does not re-derive it.

## Out of scope

- The `overlay.py` detections_data fix itself (already landed).
- Changing when migrations run (auto-run on deploy is a separate, bigger decision).
