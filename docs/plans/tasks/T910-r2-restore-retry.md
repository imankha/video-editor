# T910: R2 Restore Failure — Empty DB With No Retry

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-04-02

## Problem

On cold start (Fly.io machine restart, local data wiped), each user's database is restored from R2 on first access. If R2 is unreachable during this restore, the user gets an **empty database** and the version is locked to 0, **preventing all future retry attempts**.

The user's data still exists in R2 but the code gives up permanently after one failed attempt.

### Code Path

1. `ensure_database()` (database.py:440) — first access, `local_version is None`
2. `sync_database_from_r2_if_newer(user_id, db_path, None)` (database.py:449)
3. `get_db_version_from_r2()` (storage.py:524) — R2 HEAD request
4. R2 unreachable → exception caught → returns `None` (storage.py:558-560)
5. `sync_database_from_r2_if_newer` sees `r2_version is None` → returns `(False, None)` (storage.py:588-590)
6. Back in `ensure_database()` (database.py:467-478): `new_version is None` → **sets version to 0**
7. All future requests: `local_version = 0` (not None) → **skips R2 check entirely** (database.py:440)
8. User sees empty account. Data is in R2. No code path ever fetches it.

### Root Cause

`get_db_version_from_r2()` returns `None` for two very different situations:
- **404**: File doesn't exist in R2 (genuinely new user)
- **Exception**: R2 is unreachable (transient network failure)

Both are treated identically: "start fresh, set version to 0, never retry."

## Solution

### Step 1: Distinguish "not found" from "error" in `get_db_version_from_r2()`

Return a sentinel or use a result type that separates:
- `version: int` — R2 has this version
- `NOT_FOUND` — 404, file doesn't exist (genuine new user)
- `ERROR` — transient failure, should retry later

```python
# Option: Return (version, found) tuple
def get_db_version_from_r2(user_id, client=None) -> Tuple[Optional[int], bool]:
    """Returns (version, was_reachable). (None, True) = not found. (None, False) = error."""
```

### Step 2: Don't lock version to 0 on transient failure

In `ensure_database()`, if the R2 check failed transiently:
- **Don't set version to 0** — leave `local_version` as `None`
- On the next request, `local_version is None` → retry R2 check
- This means repeated slow R2 HEAD requests until R2 recovers — acceptable tradeoff vs permanent data loss

To avoid hammering R2, add a **cooldown** (e.g., don't retry for 30s after a failure):
```python
_r2_restore_failures: dict[str, float] = {}  # user_id → last_failure_timestamp

if local_version is None:
    last_fail = _r2_restore_failures.get(cache_key)
    if last_fail and (time.time() - last_fail) < 30:
        return  # Skip retry, too soon
    # ... attempt R2 restore ...
    if r2_error:
        _r2_restore_failures[cache_key] = time.time()
        return  # Don't set version to 0
```

### Step 3: Set version to 0 ONLY on confirmed 404

Only lock the version when we're certain the user has no R2 data:
```python
if r2_result == NOT_FOUND:
    set_local_db_version(user_id, profile_id, 0)  # Genuinely new user
elif r2_result == ERROR:
    # Don't set version — retry on next request
    logger.warning(f"[Restore] R2 unreachable for user={user_id}, will retry on next request")
```

## Relevant Files

- `src/backend/app/database.py` — Lines 435-478: `ensure_database()` restore logic
- `src/backend/app/storage.py` — Lines 524-560: `get_db_version_from_r2()`, Lines 563-602: `sync_database_from_r2_if_newer()`

## Acceptance Criteria

- [ ] `get_db_version_from_r2()` distinguishes 404 (not found) from transient errors
- [ ] Transient R2 failure does NOT lock version to 0
- [ ] Retry on next request after transient failure (with cooldown to avoid hammering)
- [ ] Confirmed 404 still locks version to 0 (no change for genuine new users)
- [ ] Existing tests pass — no behavior change for happy path
