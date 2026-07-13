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

| Layer | Test | Failure | Root cause | Handling |
|-------|------|---------|-----------|----------|
| Backend | `test_shared_game_extension.py::TestStorageStatusDerivation` (4 pg-backed cases) | `RuntimeError: No user context set` in fixture setup (`insert_game_storage_ref -> get_db_connection`) | Test class never calls `set_current_user_id()` in a bare pytest run; fails before the code under test | **Deselected in CI** (whole class; also skips its 2 passing pure cases). Burn-down: set user context in the class fixture |
| Backend | `test_collection_metadata.py::test_stamps_aspect_ratio_and_tags` | ffprobe not found | Needs ffmpeg on PATH | CI installs ffmpeg; local Windows devs need it on PATH |
| Frontend | `profileStore` switchProfile timeout | Intermittent timeout under full-suite load; passes in isolation | Flaky async test | CI runs vitest with `--retry=2`. Burn-down: fix the race in the test |
| Frontend | `tests/perf/load-perf.spec.js` collected by vitest | Playwright spec has no vitest context | vitest include pattern picked up the perf spec | **Fixed** in vite.config.js (`tests/perf` excluded) -- remove this row after confirming on CI |
| Backend | `test_t4050_missing_source_reexport.py` | `AssertionError` / product gap: source clip not re-exported after update | Intentional product gap tracked in T4990; also fails on master (confirmed 2026-07-12 derisk sweep) | **Deselected in CI**. Burn-down: implement T4990 |
| Backend | `test_tutorial_quest_steps.py::test_definitions_endpoint_tutorial_step_first` | `AssertionError: expected first step to be tutorial` | Test-order pollution: passes in isolation, fails full-suite (prior test mutates shared state) | **Deselected in CI** (CI run 29273804525, 2026-07-13). Burn-down: isolate shared state in test fixture |

Observed 2026-07-04 during the first /dotask wave (bug27p, T4190, T4100, T3980
workers all independently hit subsets of these).
