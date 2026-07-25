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
| Backend | `test_collection_metadata.py::test_stamps_aspect_ratio_and_tags` | ffprobe not found | Needs ffmpeg on PATH | CI installs ffmpeg; local Windows devs need it on PATH |
| Frontend E2E | `keyframe-integrity.spec.js › all guards verified with a project in framing mode` | `g1a_frame0` expected `0`, received `50` (RESTORE no longer reconstitutes a permanent frame-0 boundary from the nearest keyframe) | Keyframe-controller `restoreKeyframes` / `removeBoundaryDuplicates` behavior drifted away from the T340 spec's expectation; the spec is stale, not the app (needs a task to re-pin the expected invariants). Verified on a clean `master` checkout 2026-07-17 (`git show master:...` run: Expected 0, Received 50). | Pre-existing; NOT introduced by T5320. Spec also now skips on a deployed target (Vite-dev module import — see targetEnv.js). Burn down with a dedicated task. |
| Backend | `test_t4820_expired_source_status.py::TestSweepPhase2ExpiresGameStorage::test_phase2_delete_expires_remaining_game_storage` | `Expected past expiry after R2 delete, got <now+30d>` | Sweep Phase-2 now ABORTs the delete because T5850 (`03d2d03b`, live-ref guard) treats the ref as live across profiles, so storage is never expired. Test predates T5850. Verified on a master-clean backend 2026-07-25. | Pre-existing; NOT introduced by T5760/T5780. Deselected in CI. Burn down with a task to re-pin T4820 vs T5850 behavior. |
| Backend | `test_t4820_expired_source_status.py::TestSweepPhase2ExpiresGameStorage::test_phase2_syncs_to_r2_after_expire` | `sync_db_to_r2_explicit Called 0 times` | Same T5850 live-ref ABORT: Phase-2 never mutates/syncs the profile, so the expected R2 sync never fires. Test predates T5850. Verified master-clean 2026-07-25. | Pre-existing; NOT introduced by T5760/T5780. Deselected in CI. Burn down with the same task. |

Observed 2026-07-04 during the first /dotask wave (bug27p, T4190, T4100, T3980
workers all independently hit subsets of these).
