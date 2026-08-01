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
| Frontend | `src/stores/gamesDataStore.test.js::returns cached in-flight promise for same gameId` (and, seen on a later same-day rerun of the full suite: `gamesDataStore.test.js::fires fresh request after previous completes`, `src/stores/profileStore.test.js::switchProfile > calls API and updates currentProfileId`, `src/utils/cacheWarming.test.js::deduplicates same URL across tier1 and games queues`) | Hook/test timeout (5000-10010ms) in the full parallel unit suite; count varies per run (1 to 4 of these fail depending on machine load) | Load-related flake under full-suite parallelism, not a real regression: every one of these passed in an isolated re-run (`npx vitest run <file...>`, 47/47 passed in 6.98s) | Re-run isolated if seen in CI; none of these files are touched by T5700's diff |
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
