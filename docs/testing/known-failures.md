# Known Test Failures Baseline (master)

Purpose: stop re-litigating pre-existing failures. Workers and CI compare
against THIS list instead of arguing "it was already broken" per task.

Rules:
1. An entry may be added only with evidence it fails on **master** (run it on
   a clean master checkout, paste the failure line).
2. Every entry is debt: each should eventually become a task and be burned
   down. Delete the row when fixed.
3. `branch-ci.yml`'s `--deselect` list must stay in sync with the rows marked
   "deselected in CI".

Note (fresh throwaway Postgres): the conftest `pg_conn` fixture requires the
`schema_migrations` table to exist before the migration RUNNER runs. It handles
this by executing `_SCHEMA_DDL` (idempotent `CREATE TABLE IF NOT EXISTS`) first,
so a brand-new throwaway PG (`docker run postgres:16`, or a local
`initdb`-created cluster) is schema-first safe out of the box — no manual
`init_pg_schema()` call needed before the first pg-backed test.

| Layer | Test | Failure | Root cause | Handling |
|-------|------|---------|-----------|----------|
| Backend | `test_shared_game_extension.py::TestStorageStatusDerivation` (4 pg-backed cases) | `RuntimeError: No user context set` in fixture setup (`insert_game_storage_ref -> get_db_connection`) | Test class never calls `set_current_user_id()` in a bare pytest run; fails before the code under test | **Deselected in CI** (whole class; also skips its 2 passing pure cases). Burn-down: set user context in the class fixture |
| Backend | `test_collection_metadata.py::test_stamps_aspect_ratio_and_tags` | ffprobe not found | Needs ffmpeg on PATH | CI installs ffmpeg; local Windows devs need it on PATH |
| Frontend | `profileStore` switchProfile timeout | Intermittent timeout under full-suite load; passes in isolation | Flaky async test | CI runs vitest with `--retry=2`. Burn-down: fix the race in the test |
| Backend | `test_tutorial_quest_steps.py::test_definitions_endpoint_tutorial_step_first` | `AssertionError: expected first step to be tutorial` | Test-order pollution: passes in isolation, fails full-suite (prior test mutates shared state) | **Deselected in CI** (CI run 29273804525, 2026-07-13). Burn-down: isolate shared state in test fixture |

Observed 2026-07-04 during the first /dotask wave (bug27p, T4190, T4100, T3980
workers all independently hit subsets of these).
