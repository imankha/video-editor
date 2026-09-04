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
| Backend | `test_t4050_durable_sync.py::<PATCH /watched R2-async timing test>` | `AssertionError: watched blocked on R2 (1672ms) — should be async, assert 1672ms < 500ms` | CI-runner network flake on a real R2 round-trip timing assertion (500ms budget), not a code regression | Confirmed via same-SHA rerun: T6630 branch commit `06c9111a` failed this ONE test 2026-08-08 04:45 UTC, then passed clean (all tests green) on an identical rerun of the same commit minutes later. T6630's diff touches neither `db_sync.py` nor `downloads.py` at all, so the branch cannot be the cause. Re-run isolated/rerun-the-job if seen again. |
| Backend | `test_vacuum_on_signout.py::test_logout_fires_vacuum_when_user_archived` | `AssertionError: Expected '_vacuum_user_dbs' to be called once. Called 0 times.` — underlying cause: `app/analytics.py::close_session` raised inside `with get_pg() as conn:` ("Failed to close session for user-abc"), a Postgres connection-pool hiccup on the CI runner, not application logic | CI-runner Postgres connectivity flake, not a regression | Hit once on T5230's Branch CI (run 31282360965, commit `fa6fab34`); confirmed via `gh run rerun --failed` on the SAME commit/run — green on retry with zero code changes, proving non-determinism rather than a real failure. T5230's diff never touches `analytics.py`, `vacuum`, or session-close code (grep-confirmed). Re-run isolated if seen again. 2nd confirmation: hit on T4947's Branch CI (run 31854920755, commit `f1c78a78`) 2026-08-15; T4947's diff (`collections.py`, `serve_time_video.py`, `storage.py`) also never touches `analytics.py`/vacuum/session-close (grep-confirmed) — rerun triggered |
| Frontend | `src/stores/gamesDataStore.test.js::returns cached in-flight promise for same gameId` (and, seen on a later same-day rerun of the full suite: `gamesDataStore.test.js::fires fresh request after previous completes`, `src/stores/profileStore.test.js::switchProfile > calls API and updates currentProfileId`, `src/utils/cacheWarming.test.js::deduplicates same URL across tier1 and games queues`) | Hook/test timeout (5000-10010ms) in the full parallel unit suite; count varies per run (1 to 4 of these fail depending on machine load) | Load-related flake under full-suite parallelism, not a real regression: every one of these passed in an isolated re-run (`npx vitest run <file...>`, 47/47 passed in 6.98s) | Re-run isolated if seen in CI; none of these files are touched by T5700's diff |
| Backend | `test_background_sync.py::TestWriteLockDoesNotBlockOnSync::<gather 5 concurrent deletes, assert response time>` | `AssertionError: syncs should still be running when responses return — assert 2 == 0` | Wall-clock timing assertion (5 concurrent 10ms-lock-held requests must return in <250ms while their 200ms background R2 syncs are still in flight) is CI-runner-load sensitive, not a code regression | Confirmed via same-SHA rerun: T4340 branch commit `744a5ddc` failed this ONE test 2026-08-21 ~21:24 UTC (full suite also ran 3x slower than the prior run on the same branch, 13:30 vs 4:44, pointing at a loaded runner), then passed clean (`gh run rerun --failed` on the identical run/commit, conclusion `success`) minutes later with zero code changes. T4340's diff touches `clips.py`/`highlight_transform.py`/migrations/tests only — never `db_sync.py` or `test_background_sync.py` (grep-confirmed). Re-run isolated if seen again. |
| Backend | `test_t6200_concurrency.py::test_authed_burst_larger_than_pool_does_not_503` | `sqlite3.OperationalError: database is locked` | Burst-concurrency test racing SQLite locking is CI-runner-load sensitive, not a code regression | Confirmed via same-SHA rerun: T7910 branch (`feature/T7910-signup-referrer-attribution`) run 33147172811 failed this ONE test 2026-08-28 06:19 UTC, then passed clean on `gh run rerun --failed` of the identical run/commit minutes later. Also passed in an isolated local run. T7910's diff touches `analytics.py`/`auth.py`/`App.jsx`/`PageLayout.astro` only — never SQLite connection/locking code (grep-confirmed). Re-run isolated if seen again. |
| Frontend | `src/screens/__tests__/ProjectsScreen.preload.test.jsx` (both tests: `schedules an idle editor-screen preload on mount`, `cancels the scheduled idle preload on unmount`) | `TypeError: (0 , __vite_ssr_import_12__.useUploadStore) is not a function` thrown from `ProjectsScreen.jsx:132` | Pre-existing module-resolution issue in this test's mock of `useUploadStore` (unrelated to any feature code) | Confirmed on a clean master checkout (`git stash` on the T8490 branch, same failure/stack). T8490's diff touches only `modes/annotate/**` + `components/shared/{clipConstants,TagSelector}.jsx` — never `ProjectsScreen.jsx` or `uploadStore` (grep-confirmed). |
Observed 2026-07-04 during the first /dotask wave (bug27p, T4190, T4100, T3980
workers all independently hit subsets of these).

`gamesDataStore.test.js` row observed 2026-08-01 during the T5700 branch's full
frontend unit run (`npm test`, 148 files); confirmed as a parallel-suite timing
flake via an isolated re-run rather than assumed.

Burned down: the `keyframe-integrity.spec.js` row (stale T340 permanent-boundary
expectation, `g1a_frame0` expected `0` received `50`) was re-pinned to the flat-list
model and removed by T6050 (2026-07-27). The spec now guards the current invariants
(restore round-trips exactly / no manufactured entries; origins normalized to
user/trim; dedup is spatial-identity-based not proximity-based; empty list legal; any
keyframe deletable including the first; min-spacing snap; resolveTargetFrame identity
SSOT). It was never `--deselect`ed in `branch-ci.yml` (that list is pytest-only), so no
CI change was needed.
