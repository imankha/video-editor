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
| Backend | `test_vacuum_on_signout.py::test_logout_fires_vacuum_when_user_archived` | `AssertionError: Expected '_vacuum_user_dbs' to be called once. Called 0 times.` — underlying cause: `app/analytics.py::close_session` raised inside `with get_pg() as conn:` ("Failed to close session for user-abc"), a Postgres connection-pool hiccup on the CI runner, not application logic | CI-runner Postgres connectivity flake, not a regression | Hit once on T5230's Branch CI (run 31282360965, commit `fa6fab34`); confirmed via `gh run rerun --failed` on the SAME commit/run — green on retry with zero code changes, proving non-determinism rather than a real failure. T5230's diff never touches `analytics.py`, `vacuum`, or session-close code (grep-confirmed). Re-run isolated if seen again |
| Frontend | `src/stores/gamesDataStore.test.js::returns cached in-flight promise for same gameId` (and, seen on a later same-day rerun of the full suite: `gamesDataStore.test.js::fires fresh request after previous completes`, `src/stores/profileStore.test.js::switchProfile > calls API and updates currentProfileId`, `src/utils/cacheWarming.test.js::deduplicates same URL across tier1 and games queues`) | Hook/test timeout (5000-10010ms) in the full parallel unit suite; count varies per run (1 to 4 of these fail depending on machine load) | Load-related flake under full-suite parallelism, not a real regression: every one of these passed in an isolated re-run (`npx vitest run <file...>`, 47/47 passed in 6.98s) | Re-run isolated if seen in CI; none of these files are touched by T5700's diff |
| Backend | `test_t6920_intro_geometry_import_depth.py::test_js_path_raises_clear_error_at_fly_image_depth` | `Failed: DID NOT RAISE <class 'RuntimeError'>` | The T6920 loud-failure guard in `intro_card_geometry.py::_js_path()` no longer raises at the mocked deployed-image depth; not caused by T6990 (diff touches only overlay text burn/preview code, zero overlap with intro-card geometry) | Confirmed failing on Master CI itself (run 31745204680, commit at/near `7266f41f`, 2026-08-13 21:26 UTC) and independently on T6990's Branch CI (run 31747448745, same date) — same failure line both times, proving it predates and is unrelated to T6990. Hit a THIRD time 2026-08-15 on T7040's Branch CI (run 31828595280, commit `a159c6cd`) — T7040's diff touches only `exports.py`/`collections.py`, zero overlap with intro-card geometry, reinforcing this is environment/import-caching, not a per-branch regression. Filed as T7000 to root-cause (guard regression, not a flake — violates the project's no-silent-fallbacks invariant). Re-run isolated if seen again in the meantime. |
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
