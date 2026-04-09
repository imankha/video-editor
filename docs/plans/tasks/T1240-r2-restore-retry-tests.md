# T1240: R2 Restore Retry & Cooldown Tests

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

The R2 restore retry logic (T910) distinguishes NOT_FOUND (genuinely new user) from transient ERROR, with cooldown-based retry. This logic is critical for data integrity -- a wrong classification means either:
- Locking version to 0 on a transient failure (user loses their data until manual intervention)
- Retrying infinitely on a genuinely missing database

None of this behavior has automated test coverage.

## Solution

Add `src/backend/tests/test_r2_restore_retry.py` with 19 tests covering all R2 restore code paths across both profile.sqlite and user.sqlite.

**Functions under test (all confirmed present on master with matching signatures):**
- `app.storage.R2VersionResult` (enum: NOT_FOUND, ERROR)
- `app.storage.get_db_version_from_r2(user_id, client=None) -> Union[int, R2VersionResult]`
- `app.storage.get_user_db_version_from_r2(user_id, client=None) -> Union[int, R2VersionResult]`
- `app.storage.sync_database_from_r2_if_newer(user_id, local_db_path, local_version) -> (bool, Optional[int], bool)`
- `app.storage.sync_user_db_from_r2_if_newer(user_id, local_db_path, local_version) -> (bool, Optional[int], bool)`
- `app.database.ensure_database()` -- uses `_r2_restore_cooldowns` dict
- `app.services.user_db.ensure_user_database(user_id)` -- uses `_r2_user_restore_cooldowns` dict

## Test Coverage

### Test: `test_r2_version_result_members`

Verifies `R2VersionResult` enum has distinct `NOT_FOUND` ("not_found") and `ERROR` ("error") members.

```python
from app.storage import R2VersionResult
assert R2VersionResult.NOT_FOUND.value == "not_found"
assert R2VersionResult.ERROR.value == "error"
assert R2VersionResult.NOT_FOUND is not R2VersionResult.ERROR
```

---

### Test: `TestGetDbVersionFromR2.test_404_returns_not_found`

When `retry_r2_call` raises `ClientError` with code "404", `get_db_version_from_r2` returns `R2VersionResult.NOT_FOUND`.

- Mock `get_r2_client` to return a mock client whose `exceptions.ClientError = BotoClientError`
- Patch `app.utils.retry.retry_r2_call` to raise `BotoClientError({"Error": {"Code": "404"}}, "HeadObject")`
- Assert result is `R2VersionResult.NOT_FOUND`

### Test: `TestGetDbVersionFromR2.test_500_returns_error`

Same setup but code "500". Assert result is `R2VersionResult.ERROR`.

### Test: `TestGetDbVersionFromR2.test_generic_exception_returns_error`

Patch `retry_r2_call` to raise `ConnectionError("timeout")`. Assert result is `R2VersionResult.ERROR`.

### Test: `TestGetDbVersionFromR2.test_success_returns_version_int`

Patch `retry_r2_call` to return `{"Metadata": {"db-version": "42"}}`. Assert result is `42` (int).

### Test: `TestGetDbVersionFromR2.test_no_version_metadata_returns_zero`

Patch `retry_r2_call` to return `{"Metadata": {}}`. Assert result is `0` (legacy upload without version metadata).

### Test: `TestGetDbVersionFromR2.test_no_client_returns_error`

Patch `get_r2_client` to return `None`. Assert result is `R2VersionResult.ERROR`.

---

### Test: `TestSyncDatabaseFromR2IfNewer.test_not_found_returns_false_none_no_error`

Patch `get_db_version_from_r2` to return `R2VersionResult.NOT_FOUND`. Call `sync_database_from_r2_if_newer("user123", Path("/tmp/test.db"), None)`.

Assert returns `(False, None, False)` -- not an error, just no data in R2.

### Test: `TestSyncDatabaseFromR2IfNewer.test_error_returns_false_none_with_error`

Patch `get_db_version_from_r2` to return `R2VersionResult.ERROR`. Same call.

Assert returns `(False, None, True)` -- `was_error=True` signals retry needed.

---

### Test: `TestGetUserDbVersionFromR2.test_404_returns_not_found`

Same pattern as `TestGetDbVersionFromR2.test_404_returns_not_found` but for `get_user_db_version_from_r2`. Uses `_user_db_r2_key` internally.

### Test: `TestGetUserDbVersionFromR2.test_500_returns_error`

Code "500" -> `R2VersionResult.ERROR`.

### Test: `TestGetUserDbVersionFromR2.test_success_returns_version_int`

Return `{"Metadata": {"db-version": "7"}}` -> assert result is `7`.

### Test: `TestGetUserDbVersionFromR2.test_no_client_returns_error`

`get_r2_client` returns `None` -> `R2VersionResult.ERROR`.

---

### Test: `TestSyncUserDbFromR2IfNewer.test_not_found_returns_false_none_no_error`

Same pattern as profile.sqlite version. Assert `(False, None, False)`.

### Test: `TestSyncUserDbFromR2IfNewer.test_error_returns_false_none_with_error`

Assert `(False, None, True)`.

---

### Test: `TestEnsureDatabaseRestore.test_not_found_locks_version_to_zero`

Tests the critical behavior: when `sync_database_from_r2_if_newer` returns `(False, None, False)` (NOT_FOUND), `ensure_database` calls `set_local_db_version(user_id, profile_id, 0)` to lock version.

- Clear `_initialized_users` and `_r2_restore_cooldowns` in setup
- Patch `R2_ENABLED=True`, `get_local_db_version` returning `None`, `sync_database_from_r2_if_newer` returning `(False, None, False)`
- Mock `db_path.exists()=False`
- Assert `set_local_db_version` called with `(user_id, profile_id, 0)`

### Test: `TestEnsureDatabaseRestore.test_error_does_not_lock_version`

When sync returns `(False, None, True)` (ERROR), version must NOT be locked. Instead, cooldown is set.

- Same setup, but sync returns `(False, None, True)`
- Assert `set_local_db_version` NOT called
- Assert `cache_key` present in `_r2_restore_cooldowns`

---

### Test: `TestCooldownBehavior.test_cooldown_prevents_retry_within_30s`

After an ERROR sets cooldown, a second call to `ensure_database` within 30s skips the R2 check entirely.

- First call: sync returns ERROR, `mock_sync.call_count == 1`
- Second call (immediate): `mock_sync.call_count` still `1`

Note: Second call works because `_initialized_users` is populated but `local_version` is still `None` (version was never locked), so the code re-enters the R2 check path but hits the cooldown guard.

### Test: `TestCooldownBehavior.test_cooldown_expires_after_30s`

After manually setting `_r2_restore_cooldowns[key] = time.time() - 31`, the next call retries R2.

- Assert `mock_sync.call_count == 2` after expiry

---

### Test: `TestEnsureUserDatabaseRestore.test_not_found_locks_version_to_zero`

Same pattern for `ensure_user_database`. When sync returns NOT_FOUND `(False, None, False)`, calls `set_local_user_db_version(user_id, 0)`.

- Patch at source modules: `app.storage.R2_ENABLED`, `app.database.get_local_user_db_version`, `app.storage.sync_user_db_from_r2_if_newer`, `app.database.set_local_user_db_version`
- Also patch `app.services.user_db._migrate_from_auth_db` to avoid side effects

### Test: `TestEnsureUserDatabaseRestore.test_error_does_not_lock_version`

Sync returns ERROR `(False, None, True)`. Assert `set_local_user_db_version` NOT called, `user_id` in `_r2_user_restore_cooldowns`.

### Test: `TestEnsureUserDatabaseRestore.test_user_db_cooldown_prevents_retry`

After ERROR, remove user from `_initialized_user_dbs` to re-enter init path. Second call skips R2 (cooldown active). Assert `mock_sync.call_count == 1`.

### Test: `TestEnsureUserDatabaseRestore.test_user_db_cooldown_expires`

Set `_r2_user_restore_cooldowns[user_id] = time.time() - 31`, remove from `_initialized_user_dbs`. Assert `mock_sync.call_count == 2`.

## Implementation Notes

- All functions exist on master with the exact signatures the tests expect
- `R2VersionResult` lives in `app.storage`, not `app.database`
- `_r2_restore_cooldowns` is module-level in `app.database`; `_r2_user_restore_cooldowns` is module-level in `app.services.user_db`
- Cooldown constants: `RESTORE_COOLDOWN_SECONDS = 30` (database.py), `USER_RESTORE_COOLDOWN_SECONDS = 30` (user_db.py)
- Tests manipulate `time.time() - 31` to simulate cooldown expiry rather than actually sleeping
- `ensure_database` second-call cooldown test works because `_initialized_users` caching and `local_version is None` checks interact: the function re-enters the R2 path on second call but hits the cooldown guard
- `ensure_user_database` requires explicit `_initialized_user_dbs.discard()` to re-enter the init path for cooldown tests
- The branch diff test code patches `app.utils.retry.retry_r2_call` for low-level tests and `app.storage.get_db_version_from_r2` for higher-level sync tests

## Acceptance Criteria

- [ ] All 19 tests pass: `cd src/backend && pytest tests/test_r2_restore_retry.py -v`
- [ ] R2VersionResult enum has NOT_FOUND and ERROR members
- [ ] 404 -> NOT_FOUND, 500/exception -> ERROR for both `get_db_version_from_r2` and `get_user_db_version_from_r2`
- [ ] NOT_FOUND -> `(False, None, False)`, ERROR -> `(False, None, True)` for both sync functions
- [ ] `ensure_database`: NOT_FOUND locks version to 0, ERROR sets cooldown without locking version
- [ ] `ensure_user_database`: same NOT_FOUND vs ERROR behavior
- [ ] Cooldown prevents retry within 30s for both database types
- [ ] Cooldown expires after 30s allowing retry for both database types
- [ ] No actual R2 calls or network access in tests (all mocked)
