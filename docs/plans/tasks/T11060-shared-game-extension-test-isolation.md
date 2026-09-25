# T11060: test_shared_game_extension.py depends on leaked user context

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-09-24
**Updated:** 2026-09-24

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
