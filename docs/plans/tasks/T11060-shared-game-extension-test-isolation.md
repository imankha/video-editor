# T11060: test_shared_game_extension.py depends on leaked user context

**Status:** STAGING (merged to master in PR #545, `65fd2d67`, 2026-09-30)
**Impact:** 3
**Complexity:** 2
**Created:** 2026-09-24
**Updated:** 2026-09-29

Found by the T10220 proof verifier on 2026-09-24. The same failures happen on master
(242f356d), so T10220 did not cause them.

## Problem

`src/backend/tests/test_shared_game_extension.py` passes in CI's full-suite order but fails when
the file runs on its own. Eight tests fail:

- TestStorageRefIndependence x3
- TestCanExtendCrossUser x3
- TestGracePeriodExtend x2

Each fails with `RuntimeError: No user context set`. The error is raised in test setup
(`insert_game_storage_ref`, then `get_db_connection`, then `ensure_database`), before any code
under test runs. Running only `TestExtendEndpointHandler` fails 3 more tests.

The tests rely on a user context that earlier tests in the session leave behind. That makes them
order-dependent, so a curated relevant-set run of this file (the normal worker test scope) gives
false failures. Any change to test ordering could also hide or reveal them in CI.

## Solution

Give each affected test class, or a module-level fixture, an explicit user context, using the
same setup other per-user tests use (find the existing fixture that sets user context before
`ensure_database`). Don't change the production `get_db_connection` contract. A missing context
is correctly an error there.

## Acceptance Criteria

- [ ] `pytest tests/test_shared_game_extension.py` (CI invocation form) passes when run alone
- [ ] `-k TestExtendEndpointHandler` passes when run alone
- [ ] The file still passes in the full CI suite

## Evidence

- Latest `origin/master` includes the T10340 reset fix (`3026e9036`); the target
  module still has no explicit user context of its own.
- Added one module-scoped fixture that sets and token-restores both user and
  profile context. The existing storage-status fixture now reuses it instead of
  clearing the user context during the class.
- Local execution is currently blocked before the target assertions because the
  repository Postgres fixture requires `DATABASE_URL`, which is not configured
  in this environment.
