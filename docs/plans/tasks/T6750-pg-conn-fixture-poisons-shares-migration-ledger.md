# T6750: `pg_conn` test fixture can permanently poison any Postgres it runs against

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

Found 2026-08-11 running the full backend pytest suite (`tests/test_*.py`, the canonical
`run_tests.py`/CI invocation) against origin/master (`55aa9ed6`, includes PR #250/T6452) in an
isolated container, first against the shared dev Postgres and then against a completely fresh
throwaway `postgres:16` matching `branch-ci.yml`'s CI service exactly. Both runs produced the same
result: 100+ setup errors, all `psycopg2.errors.CheckViolation: check constraint
"shares_share_type_check" of relation "shares" is violated by some row`.

**Root-caused by the expert agent (Opus):** this is NOT a master regression — GitHub Actions CI for
this exact commit is green. It is a **pre-existing bug in the test suite itself** that had never
been triggered before because it requires a Postgres holding real `collection`/`game_link`-type
`shares` rows created outside the fixture's own cleanup scope (e.g. the developer's own
`imankh@gmail.com` account, or any test that doesn't clean up under `_TEST_USER_IDS`).

**Mechanism:**
1. `tests/conftest.py`'s `pg_conn` fixture runs `DELETE FROM schema_migrations WHERE version >= 5`
   then `RUNNER.run(setup, "postgres")` on **every single test** that uses it — replaying migrations
   5+ from scratch each time.
2. `app/migrations/postgres/v003_annotation_playback_share_type.py` adds a **narrow**
   `shares_share_type_check` CHECK (`video`/`game`/`annotation_playback` only); v016 and v020 later
   widen it (adding `collection`, then `game_link`). Replaying v003 against a `shares` table that
   already contains a `collection`- or `game_link`-typed row (real usage, or a prior test that didn't
   clean up) is a **guaranteed CheckViolation** — that row didn't exist yet when v003 was written.
3. Two tests actively make this worse by wiping the ledger further and never restoring it on
   failure:
   - `tests/test_t2930_migrations.py::TestRunAllMigrations::test_postgres_migration_applied_via_runner`
     — `DELETE FROM schema_migrations WHERE version >= 2`, then replays. On a DB with a wide-type
     share row already present, this dies at v003, and because the test doesn't restore the ledger
     in a `finally`, **the ledger is left stuck below v003 permanently** — poisoning every subsequent
     `pg_conn` test in that run AND every future run against that same database, silently, with no
     indication anything is wrong until the next full-suite run.
   - `tests/test_t6345_migration_version_gaps.py`'s `_seed_versions()` does the same kind of full
     `DELETE FROM schema_migrations` with no restore.
4. `pg_conn`'s own cleanup (`DELETE FROM shares WHERE sharer_user_id IN (_TEST_USER_IDS)`) runs
   **after** `RUNNER.run()` (conftest.py:126, vs. the migration replay at :117) — so a leftover
   `collection`/`game_link` row from any test whose teardown didn't fire (e.g. it errored) is still
   present the next time `RUNNER.run()` replays v003, breaking the *next* test. This ordering is the
   one path that could go red in real CI intermittently, not just in ad-hoc local/container runs.

This is a foundational-layer (test-infra) bug: once triggered, it silently and permanently corrupts
the migration bookkeeping of whatever Postgres it touches, and every developer/container run against
that DB then reports mass false failures until someone manually diagnoses and repairs it (as we had
to do for the shared dev Postgres on 2026-08-11 — ledger was stuck at `{1,2}` and the constraint had
been dropped and never restored).

## Solution

Three changes, in priority order (see expert agent's full analysis for exact code):

1. **Snapshot/restore the ledger around the two tests that wipe it.** Add a fixture/helper in
   `tests/conftest.py` that `SELECT version, description FROM schema_migrations` before the test and,
   in a `finally`, restores exactly that set (delete + re-insert). Apply it in
   `test_t2930_migrations.py::TestRunAllMigrations::test_postgres_migration_applied_via_runner` and
   `test_t6345_migration_version_gaps.py`'s version-gap tests.
2. **Make `pg_conn` refuse to replay below v005.** Right after `_SCHEMA_DDL` + the
   `DELETE FROM schema_migrations WHERE version >= 5` at conftest.py:113-114, re-assert versions 1-4
   as already applied (`INSERT ... ON CONFLICT DO NOTHING` for each migration below v5) before calling
   `RUNNER.run()`. `_SCHEMA_DDL` already creates the table with the CURRENT head constraint
   (`video`/`game`/`annotation_playback`/`collection`/`game_link`), so v001-v004 are no-ops on a fresh
   DB anyway — v003's narrow constraint is transient history that must never be replayed against real
   data. This also makes the fixture self-healing against any future ledger-wiping test.
3. **Reorder `pg_conn`'s cleanup before the migration replay**, not after (conftest.py: move the
   `DELETE FROM shares WHERE sharer_user_id IN (...)` line above the `RUNNER.run()` call at line 117).

## Context

### Relevant Files (REQUIRED)
- `src/backend/tests/conftest.py` — `pg_conn` fixture (~lines 85-140)
- `src/backend/tests/test_t2930_migrations.py` — `TestRunAllMigrations::test_postgres_migration_applied_via_runner`
- `src/backend/tests/test_t6345_migration_version_gaps.py` — `_seed_versions()`
- `src/backend/app/migrations/postgres/v003_annotation_playback_share_type.py` (read-only reference — do not change the migration itself, it's correct historical record)

### Related Tasks
- None — pure test-infra fix, no product code touched.

### Technical Notes
- Do NOT change the constraint definitions in v003/v016/v020 — they're correct historical
  migrations. The bug is purely in how tests replay them against non-fresh data.
- The shared dev Postgres was already repaired manually 2026-08-11 (ledger backfilled to v22 by
  running each pending migration's real `up()`, restoring the true `shares_share_type_check`
  constraint) — this task is about preventing recurrence, not the one-time repair.

## Implementation

### Steps
1. [ ] Add ledger snapshot/restore helper in `conftest.py`, apply to both ledger-wiping tests
2. [ ] Have `pg_conn` re-assert versions 1-4 as applied before replaying 5+
3. [ ] Move the `shares` cleanup DELETE above the migration replay in `pg_conn`
4. [ ] Run the full backend suite against a throwaway Postgres seeded with a `collection`-type
   share under a non-`_TEST_USER_IDS` user, confirm no cascade

### Progress Log

**2026-08-11**: Filed after root-causing a 555-error cascade during a full test-suite sweep against
master. Expert agent (Opus) confirmed master/CI are unaffected; this is test-infra only.

## Acceptance Criteria

- [ ] `test_t2930_migrations.py::test_postgres_migration_applied_via_runner` leaves
  `schema_migrations` exactly as it found it, even if the migration replay inside the test fails
- [ ] `pg_conn` never attempts to re-apply v003's narrow constraint against a DB that already has
  wider-type `shares` data
- [ ] Full backend suite run twice in a row against the same throwaway Postgres produces identical
  pass/fail counts (no cross-run poisoning)
- [ ] Relevant tests pass: `test_t2930_migrations.py`, `test_t6345_migration_version_gaps.py`,
  `test_shares.py`, `test_share_playback.py`
