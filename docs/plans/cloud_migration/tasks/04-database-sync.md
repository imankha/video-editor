# Task 04: Database Sync (COMPLETE)

## Overview
Implement robust database synchronization between local SQLite and R2 storage with version tracking and batched writes.

## Owner
**Claude** - Code generation task

## Status
**COMPLETE** - Implemented in commit `24c5d2e`

---

## What Was Implemented

### Version-Based Sync

Instead of checking if the database file exists, we now track versions:

- Each database upload includes version number in R2 metadata (`x-amz-meta-db-version`)
- On request start: compare local version vs R2 version
- Only download if R2 has newer version
- On upload: increment version number

### Batched Writes

Multiple database writes in a single request result in only one R2 upload:

- `TrackedConnection` wrapper auto-detects write operations (INSERT, UPDATE, DELETE, etc.)
- `DatabaseSyncMiddleware` checks for writes at end of request
- Only syncs to R2 if writes actually occurred

### Conflict Detection

Uses optimistic locking with last-write-wins:

- Before upload, check if R2 version has changed
- If conflict (R2 version > local version), log warning but allow write
- Future: could add WebSocket notification to refresh stale tabs

### Database Size Monitoring

Automatic monitoring to know when to migrate to Durable Objects:

```
INFO:  Database size notice: 600KB - approaching 1MB migration threshold
WARN:  DATABASE MIGRATION RECOMMENDED: Database size (1.2MB) exceeds 1MB.
       Consider migrating archived data to Durable Objects.
```

---

## Files Modified

| File | Changes |
|------|---------|
| `storage.py` | Added `get_db_version_from_r2`, `sync_database_from_r2_if_newer`, `sync_database_to_r2_with_version` |
| `database.py` | Added `TrackedConnection`, `TrackedCursor`, size monitoring, version tracking |
| `middleware/__init__.py` | New file - middleware package |
| `middleware/db_sync.py` | New file - `DatabaseSyncMiddleware` |
| `main.py` | Register `DatabaseSyncMiddleware` |

---

## How It Works

### Request Flow

```
Request starts
  │
  ▼
UserContextMiddleware sets user ID
  │
  ▼
DatabaseSyncMiddleware.init_request_context()
  │
  ▼
Request handler uses TrackedConnection
  │ ─── cursor.execute("INSERT...") ───► TrackedConnection._mark_write()
  │
  ▼
Response generated
  │
  ▼
DatabaseSyncMiddleware.sync_db_to_cloud_if_writes()
  │ ─── If writes occurred ───► Upload to R2 with new version
  │
  ▼
clear_request_context()
```

### TrackedConnection

```python
with get_db_connection() as conn:
    cursor = conn.cursor()
    cursor.execute("INSERT INTO projects...")  # Automatically tracked as write
    cursor.execute("SELECT * FROM games")      # Not tracked (read only)
    conn.commit()
# On exit: middleware checks conn.has_writes and syncs if true
```

---

## Configuration

No additional configuration needed. The feature is automatically enabled when `R2_ENABLED=true`.

Size thresholds (can be adjusted in `database.py`):

```python
DB_SIZE_WARNING_THRESHOLD = 512 * 1024   # 512KB - info log
DB_SIZE_MIGRATION_THRESHOLD = 1024 * 1024  # 1MB - warning log
```

---

## Testing

### Verify Version Sync

1. Make a change in the app
2. Check R2 metadata: `wrangler r2 object info reel-ballers-users/a/database.sqlite`
3. Version should increment

### Verify Batched Writes

1. Watch backend logs during a multi-write operation (e.g., creating a project)
2. Should see only ONE "Uploaded DB to R2" log, not multiple

### Verify Size Monitoring

1. Check backend logs after sync
2. If DB > 512KB, should see info message
3. If DB > 1MB, should see warning message

---

## Known Limitations

1. **Last-write-wins**: If two tabs write simultaneously, second write wins (conflict logged)
2. **No real-time sync**: Other tabs won't see changes until page refresh
3. **Memory usage**: Full DB loaded on each request (acceptable for <1MB)

These are acceptable for current scale. DO migration (Task 18) addresses them if needed.
