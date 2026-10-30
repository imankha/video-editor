# T13965: pg_conn fixture: build the Postgres schema once per session, not per test

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-10-30
**Updated:** 2026-10-30

## Problem

`pg_conn` (`src/backend/tests/conftest.py`) runs for ~1,194 tests in 78 files. For every test it
drops the analytics tables, runs `_SCHEMA_DDL`, deletes `schema_migrations` rows >= 5 and replays
the Postgres migrations, then cleans test users. Those tests cost 154 ms each versus 67 ms for the
rest: ~100 s of the ~426 s backend suite. Data: [ci-pr-speed-design-2026-10-30.md](../ci-pr-speed-design-2026-10-30.md).

## Solution

Split the fixture:
1. A session-scoped fixture builds the schema once (drop analytics tables, `_SCHEMA_DDL`,
   migration replay, seed).
2. The per-test part only restores data: the existing per-user DELETEs and TRUNCATEs, the seed
   and the `credit_migration_state` reset.
3. Tests that alter schema or wipe `schema_migrations` (the comment at the replay mentions a
   "ledger-wiping test") must keep working: find them, and either give them their own
   function-scoped rebuild fixture or have them mark the session schema dirty so the next
   `pg_conn` rebuilds it. A test must never see a schema another test changed.
4. Keep the staging/prod DSN refusal.

Characterize first: run the `pg_conn` files before and after and compare pass/fail sets
(identical) plus timing. Report per-test cost before/after.

## Context

### Relevant Files (REQUIRED)
- `src/backend/tests/conftest.py` - `pg_conn`
- tests that drop or rewrite Postgres schema or `schema_migrations` (grep `schema_migrations`, `DROP TABLE`, `ALTER TABLE` under `src/backend/tests/`)

### Related Tasks
- T13964 (sharding; this task shortens every shard)

## Acceptance Criteria

- [ ] The schema DDL and migration replay run once per session (plus any explicit rebuild), not once per test
- [ ] The pass/fail set of the `pg_conn` test files is identical before and after
- [ ] Per-test cost of `pg_conn` tests drops by >= 50 ms (measured in CI logs)
