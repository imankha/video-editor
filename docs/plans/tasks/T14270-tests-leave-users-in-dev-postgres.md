# T14270: Backend tests leave fake users ("org", "fin", "u1") in dev Postgres

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Tier:** S
**Created:** 2026-11-01
**Updated:** 2026-11-01

Found while verifying T14020 in the admin UI (2026-11-01).

## Problem

The dev Postgres holds users with ids like `org`, `fin` and `u1`, left behind by older backend
tests. They show up in admin user lists and analytics (journey map, step inspector People
list) alongside real dev accounts. They also skew whole-DB ratios, the same failure class as
T14200.

The `pg_conn` fixture only cleans up ids in `_TEST_USER_IDS` (T13965/T14210). Tests that
insert other ids are never cleaned.

## Solution

1. Find which tests insert these ids. Candidates by grep: `test_revenue_reconciliation.py`,
   `test_export_worker_sync.py`, `test_move_reels_stale_target.py`,
   `test_t8650_revenue_from_ledger.py`, `test_upload_lock.py`, and others.
2. Have each one either use an id from `_TEST_USER_IDS` or register its ids for the fixture's
   per-test cleanup. Never delete non-test rows.
3. Remove the existing leftover rows from the dev DB, after confirming with the user the exact
   ids to delete (CLAUDE.md Data Safety Rules).

## Context

### Relevant Files (REQUIRED)
- `src/backend/tests/conftest.py` - `pg_conn`, `_TEST_USER_IDS`
- The offending test files (step 1)

### Related Tasks
- Related: T14200, T14210 (shared-dev-DB test hygiene)

## Acceptance Criteria

- [ ] Running the backend suite against a dev DB adds no new user rows
- [ ] The leftover rows are removed (exact ids confirmed by the user)
