# T750: R2 Retry Resilience

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-03-28
**Updated:** 2026-03-28

## Problem

All R2/S3 operations in the backend have zero retry logic. A transient network hiccup (connection timeout, DNS blip, connection pool exhaustion) causes immediate failure. This was observed in production when a 3.3GB upload saturated the connection pool, causing a subsequent export download to fail with `Could not connect to the endpoint URL`.

The app currently has ~40+ R2 call sites with no retries, while Modal GPU calls already have proper retry logic (3 attempts, exponential backoff) that we can use as a reference pattern.

### Observed failures
- Export pipeline: R2 download timeout → 500 → export fails (credit refunded but UX is bad)
- DB sync: R2 upload timeout → user data not persisted to cloud
- Auth DB: R2 sync timeout → auth state not backed up

## Solution

Add retry with exponential backoff to all R2 operations, tiered by criticality.

### Retry Strategy

Use a shared retry utility (decorator or wrapper) with exponential backoff + jitter:

```python
def retry_r2(max_attempts=3, initial_delay=1.0, backoff=2.0, max_delay=30.0):
    """Retry decorator for R2 operations with exponential backoff + jitter."""
```

Retry on these transient errors only:
- `botocore.exceptions.ConnectTimeoutError`
- `botocore.exceptions.ReadTimeoutError`
- `botocore.exceptions.EndpointConnectionError`
- `urllib3.exceptions.ConnectionError`
- `ConnectionError` (generic)
- HTTP 500, 502, 503, 429 from R2

Do NOT retry on:
- `NoSuchKey` (404) — not transient
- `AccessDenied` — not transient
- Client-side errors (400) — not transient

### Connection Pool Fix (do first — prevents starvation)

The current `get_r2_client()` uses default `max_pool_connections=10`. A 3.3GB multipart upload uses `max_concurrency=10` threads, consuming the **entire pool**. Any concurrent operation (export download, DB sync) must create throwaway connections — if those timeout, we get `Could not connect to the endpoint URL`.

**Fix 1 — Increase pool size:**
```python
Config(max_pool_connections=25)  # 10 for upload threads + 15 headroom
```

**Fix 2 — Separate clients (more robust):**
- `get_r2_client()` — metadata, presigned URLs, small ops (pool=10)
- `get_r2_sync_client()` — DB sync in middleware (already exists, short timeouts)
- `get_r2_transfer_client()` (NEW) — large uploads/downloads (pool=20, read_timeout=120)

**Fix 3 — Increase multipart chunk size:**
```python
TransferConfig(multipart_chunksize=25 * 1024 * 1024)  # 25MB vs default 8MB
```
Reduces 3.3GB upload from 412 parts to ~132, less connection churn.

### Retry Tiers

**Tier 1 — Critical path (3 retries, 1s initial delay):**
- `download_from_r2()` / `download_from_r2_global()` — export pipeline
- `upload_to_r2()` / `upload_bytes_to_r2()` — data persistence
- `sync_database_to_r2_with_version()` — DB sync
- `sync_auth_db_to_r2()` / `sync_auth_db_from_r2()` — auth persistence
- Google OAuth token verification (`httpx.get` in auth.py)

**Tier 2 — Important but not blocking (2 retries, 0.5s initial delay):**
- `get_db_version_from_r2()` — sync version check
- `get_r2_file_size()` — file size lookup
- `file_exists_in_r2()` — existence check
- `head_object` calls in games router
- Presigned URL streaming proxies (clips.py, downloads.py)

**Tier 3 — Best-effort (1 retry, 0.5s delay):**
- `list_objects_v2` operations
- `delete_objects` operations
- Profile JSON operations (`save_profiles_json`, etc.)
- Multipart upload operations

### Implementation approach

1. Create `app/utils/retry.py` with the retry decorator
2. Apply to `storage.py` functions (biggest bang — covers most call sites)
3. Apply to `auth_db.py` sync functions
4. Apply to `auth.py` Google OAuth call
5. Apply to streaming proxy calls in clips.py/downloads.py

### Reference: existing Modal retry pattern

```python
# From modal_client.py — already working well
NETWORK_RETRY_ATTEMPTS = 3
NETWORK_RETRY_DELAY = 2.0
NETWORK_RETRY_BACKOFF = 2.0

for attempt in range(NETWORK_RETRY_ATTEMPTS):
    try:
        result = call_function()
        break
    except Exception as e:
        if is_transient_error(e) and attempt < NETWORK_RETRY_ATTEMPTS - 1:
            delay = NETWORK_RETRY_DELAY * (NETWORK_RETRY_BACKOFF ** attempt)
            await asyncio.sleep(delay)
            continue
        raise
```

## Context

### Relevant Files

**New file:**
- `src/backend/app/utils/retry.py` — retry decorator/utility

**Tier 1 (critical):**
- `src/backend/app/storage.py` — `download_from_r2`, `upload_to_r2`, `upload_bytes_to_r2`, `sync_database_to_r2_with_version`, `download_from_r2_global`
- `src/backend/app/services/auth_db.py` — `sync_auth_db_to_r2`, `sync_auth_db_from_r2`
- `src/backend/app/routers/auth.py` — Google OAuth `httpx.get`

**Tier 2 (important):**
- `src/backend/app/storage.py` — `get_db_version_from_r2`, `get_r2_file_size`, `file_exists_in_r2`
- `src/backend/app/routers/clips.py` — presigned URL streaming proxy
- `src/backend/app/routers/downloads.py` — final video streaming proxy

**Tier 3 (best-effort):**
- `src/backend/app/storage.py` — `list_objects_v2`, `delete_objects`, `save_profiles_json`, multipart operations

**Reference (already has retries):**
- `src/backend/app/services/modal_client.py` — existing retry pattern to follow

### Related Tasks
- Triggered by: T415 testing (export failed due to R2 timeout)
- Related: T230 (Pre-warm R2 on Login)

## Acceptance Criteria

- [ ] Retry utility created with configurable attempts, delay, backoff, jitter
- [ ] All Tier 1 R2 operations retry on transient errors (3 attempts)
- [ ] All Tier 2 R2 operations retry on transient errors (2 attempts)
- [ ] All Tier 3 R2 operations retry on transient errors (1 retry)
- [ ] Google OAuth verification retries on network errors (2 attempts)
- [ ] Retries are logged at WARNING level (so we can monitor flakiness)
- [ ] Non-transient errors (404, 403) are NOT retried
- [ ] DB sync middleware timeout thresholds account for retry delays
- [ ] Existing tests still pass
