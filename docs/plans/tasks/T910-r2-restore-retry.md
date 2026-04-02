# T910: R2 Restore Failure — Empty DB With No Retry

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-04-02
**Depends On:** T920

## Problem

On cold start, if R2 is unreachable during database restore, the user gets an empty database and the version is locked to 0, preventing all future retry attempts. The user's data exists in R2 but the code gives up permanently after one failed attempt.

After T920, this applies to **both** user.sqlite and database.sqlite — both need the same retry-on-failure logic.

### Code Path

1. `ensure_database()` (database.py:440) — first access, `local_version is None`
2. `get_db_version_from_r2()` (storage.py:524) — R2 HEAD request
3. R2 unreachable → exception → returns `None` (storage.py:558-560)
4. `sync_database_from_r2_if_newer` sees `r2_version is None` → returns `(False, None)`
5. `ensure_database()` (database.py:467-478): sets version to 0 — **never retries**

### Root Cause

`get_db_version_from_r2()` returns `None` for both:
- **404**: File doesn't exist (genuinely new user) — correct to set version 0
- **Exception**: R2 unreachable (transient failure) — should retry, not give up

## Solution

### Step 1: Distinguish "not found" from "error"

```python
from enum import Enum

class R2VersionResult(Enum):
    NOT_FOUND = "not_found"
    ERROR = "error"

def get_db_version_from_r2(user_id, client=None) -> Union[int, R2VersionResult]:
    """Returns version int, NOT_FOUND, or ERROR."""
    try:
        response = retry_r2_call(client.head_object, ...)
        return int(metadata.get("db-version", "0"))
    except ClientError as e:
        if e.response['Error']['Code'] == '404':
            return R2VersionResult.NOT_FOUND
        return R2VersionResult.ERROR
    except Exception:
        return R2VersionResult.ERROR
```

### Step 2: Only lock version to 0 on confirmed 404

```python
if r2_result == R2VersionResult.NOT_FOUND:
    set_local_db_version(user_id, profile_id, 0)  # Genuinely new user
elif r2_result == R2VersionResult.ERROR:
    # Don't set version — retry on next request
    logger.warning(f"[Restore] R2 unreachable, will retry on next request")
```

### Step 3: Cooldown to avoid hammering R2

```python
_r2_restore_cooldowns: dict[str, float] = {}  # cache_key → last_failure_timestamp
RESTORE_COOLDOWN_SECONDS = 30

# In ensure_database():
if local_version is None:
    cache_key = f"{user_id}:{profile_id}"
    last_fail = _r2_restore_cooldowns.get(cache_key)
    if last_fail and (time.time() - last_fail) < RESTORE_COOLDOWN_SECONDS:
        return  # Too soon to retry
    ...
    if r2_error:
        _r2_restore_cooldowns[cache_key] = time.time()
```

### Step 4: Apply same logic to user.sqlite

After T920, `ensure_user_database()` has the same restore pattern. Apply the same NOT_FOUND vs ERROR distinction and cooldown.

## Relevant Files

- `src/backend/app/database.py` — Lines 435-478: `ensure_database()` restore logic
- `src/backend/app/storage.py` — Lines 524-560: `get_db_version_from_r2()`, Lines 563-602: `sync_database_from_r2_if_newer()`

## Acceptance Criteria

- [ ] `get_db_version_from_r2()` returns NOT_FOUND vs ERROR (not both as None)
- [ ] Transient R2 failure does NOT lock version to 0
- [ ] Retry on next request with 30s cooldown
- [ ] Confirmed 404 still locks version to 0 (no change for new users)
- [ ] Same logic applied to user.sqlite restore (after T920)
- [ ] Existing tests pass
