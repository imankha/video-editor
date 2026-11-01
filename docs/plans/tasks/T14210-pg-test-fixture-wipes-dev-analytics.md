# T14210: Backend test runs wipe every dev user's analytics data

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** S
**Created:** 2026-10-31
**Updated:** 2026-10-31

Found during T14010 (2026-10-31).

## Problem

`src/backend/tests/conftest.py` `_build_pg_schema` runs `DROP TABLE IF EXISTS user_actions, user_flow_events, user_segments, user_milestones CASCADE` the first time `pg_conn` is used in each pytest process (`_pg_schema_state` is per process, so in practice every session). `pg_conn` refuses only staging/prod DSNs, so this runs against the SHARED dev Postgres that the local app also uses. Every backend test session therefore:

- deletes every dev user's `user_actions` rows (observed 2026-10-31: 75 seeded rows -> 0; the dev DB held 1 action row total), and
- drops `user_segments`, which the v009 migration then backfills with `acquired_at` = today and default origins, erasing every signup date, origin and build.

So the admin analytics views (Journey, cohorts, campaigns, builds) can never be exercised on dev data that survives a test run, and anyone seeding dev data for a manual check loses it silently. Every other `pg_conn` cleanup is scoped to `_TEST_USER_IDS`; this one is not.

## Solution

Make the schema rebuild non-destructive for rows the tests did not create: drop and recreate only when the analytics tables' schema is actually stale (compare columns against `_SCHEMA_DDL`), otherwise leave them and rely on the `_TEST_USER_IDS`-scoped deletes. Alternatively point the test suite at its own database. Decide with the user; either way the fixture must never delete non-test rows on the shared dev DB.

## Context

### Relevant Files
- `src/backend/tests/conftest.py` (`_build_pg_schema`, `pg_conn`)
- `src/backend/app/migrations/postgres/v009_normalize_analytics.py` (the segment backfill that hides the drop)

### Notes
Load: backend-services.md. Related: T13965 (pg_conn builds the schema once per session), T14200 (another shared-dev-DB test hazard).

## Acceptance Criteria

- [ ] A user_actions / user_segments row for a non-test user survives a backend test session (regression test that seeds one, runs the fixture setup, and checks it)
- [ ] Stale-schema rebuild still works on a fresh or outdated DB
