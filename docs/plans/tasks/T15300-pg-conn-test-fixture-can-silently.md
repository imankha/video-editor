# T15300: pg_conn test fixture can silently drop and empty the shared dev Postgres analytics tables

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-08
**Updated:** 2026-11-08

## Problem

Found by the /dotask verifier on group g-t15200-1 at 166a15f34, which judged it unrelated to that branch. Impact and complexity are unscored defaults.

**Steps:** Run any backend pytest file that uses the pg_conn fixture (tests/conftest.py) against this container's shared dev Postgres (DATABASE_URL points at host.docker.internal:5432/reelballers_dev, the same DB the live backend serves from). conftest.py's _build_pg_schema() runs `DROP TABLE IF EXISTS user_actions, user_flow_events, user_segments, user_milestones CASCADE` whenever _analytics_schema_is_stale() detects any column drift on those tables versus a fresh _SCHEMA_DDL build, then recreates them via CREATE TABLE IF NOT EXISTS with no data restore.

**Expected:** Running this branch's new, scoped pytest files (test_admin_spend_readiness.py, test_t13980_campaigns.py, test_t15120_channel_readout.py) should not affect unrelated real dev data.

**Actual:** During this verification session, after running the 3 new T15200 test files, user_segments was found to no longer exist in the live dev Postgres (to_regclass returned NULL), breaking every admin endpoint that reads it (users list, channels, journey, spend-readiness) with 500s. I repaired the table structurally by calling app.services.pg.init_pg_schema() directly (idempotent CREATE TABLE IF NOT EXISTS), which restored the admin panel to working order, but the table came back EMPTY (count=0) -- all real dev user_segments rows that existed before this session (acquisition origin, acquired_at, etc. for every dev account) are permanently lost. This mechanism and exact failure mode (T14210) is pre-existing in tests/conftest.py, which this branch's diff does not touch at all, and the staleness trigger is about user_segments/user_actions column shape, unrelated to the `campaigns` table columns T15200 actually changed -- so this would reproduce identically running any pre-existing pg_conn-based test file against a dev DB with the same drift, on origin/master too. Flagging as unrelated/pre-existing but noting it because it is a real, currently-live data-loss landmine in the shared dev environment this session used.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
