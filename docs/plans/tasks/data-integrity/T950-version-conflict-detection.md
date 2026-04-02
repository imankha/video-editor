# T950: Version Conflict Detection

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-02
**Depends On:** T920

## Problem

When uploading database.sqlite to R2, `sync_database_to_r2_with_version()` uses optimistic locking: it checks if the R2 version matches the version we loaded from. If there's a mismatch (another server/request uploaded a newer version), the code logs a warning and uploads anyway — **last-write-wins, silently overwriting the other version's data**.

### Code (storage.py lines 663-669):
```python
if r2_version is not None and current_version is not None:
    if r2_version > current_version:
        logger.warning(f"Version conflict: R2 has v{r2_version}, we loaded v{current_version}")
        # Falls through and uploads anyway — DATA LOSS
```

### Scenario:
1. Tab A loads project (version 10), edits clip names
2. Tab B loads project (version 10), edits crop keyframes
3. Tab A saves → R2 version becomes 11 (has clip name changes)
4. Tab B saves → sees R2 is v11 but loaded v10 → **overwrites with v11** that has crop changes but LOST clip name changes

## Solution

### Step 1: Fail on conflict instead of overwriting

```python
if r2_version > current_version:
    logger.error(f"Version conflict: R2 v{r2_version} > loaded v{current_version}, NOT uploading")
    return False, current_version  # Signal conflict to caller
```

### Step 2: Surface conflict to user

When sync returns conflict, set a header or response field:
```python
response.headers["X-Sync-Status"] = "conflict"
```

Frontend shows: "Your changes couldn't be saved because someone else made changes. Please reload."

### Step 3: Re-download on conflict

After detecting conflict, re-download the newer version from R2 to local, so the next request uses fresh data:
```python
if conflict:
    sync_database_from_r2_if_newer(user_id, db_path, current_version)
    set_local_db_version(user_id, profile_id, r2_version)
```

## Relevant Files

- `src/backend/app/storage.py` — `sync_database_to_r2_with_version()` (lines 622-687)
- `src/backend/app/middleware/db_sync.py` — sync after response, header setting
- `src/backend/app/database.py` — version tracking

## Acceptance Criteria

- [ ] Version conflict does NOT overwrite R2 (fail instead)
- [ ] `X-Sync-Status: conflict` header set on conflict
- [ ] Local DB re-downloaded from R2 after conflict
- [ ] Frontend can distinguish "conflict" from "failed" sync status
- [ ] Same logic for user.sqlite version conflicts
