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
Observed 2026-07-04 during the first /dotask wave (bug27p, T4190, T4100, T3980
workers all independently hit subsets of these).

Burned down: the `keyframe-integrity.spec.js` row (stale T340 permanent-boundary
expectation, `g1a_frame0` expected `0` received `50`) was re-pinned to the flat-list
model and removed by T6050 (2026-07-27). The spec now guards the current invariants
(restore round-trips exactly / no manufactured entries; origins normalized to
user/trim; dedup is spatial-identity-based not proximity-based; empty list legal; any
keyframe deletable including the first; min-spacing snap; resolveTargetFrame identity
SSOT). It was never `--deselect`ed in `branch-ci.yml` (that list is pytest-only), so no
CI change was needed.
