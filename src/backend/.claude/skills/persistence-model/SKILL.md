---
name: persistence-model
description: "SQLite + R2 cloud sync architecture. Version-based sync, batched writes, conflict detection. Apply when working with database operations, user data persistence, or cloud sync."
license: MIT
author: video-editor
version: 1.0.0
---

# Persistence Model

Single source of truth architecture: SQLite per-user, synced to Cloudflare R2 with version tracking.

## When to Apply
- Creating database operations
- Implementing data persistence
- Working with user data
- Debugging sync issues
- Understanding data flow

## Architecture Overview

```
Frontend                    Backend                     R2 Storage
   │                          │                            │
   │── HTTP Request ──────────►│                            │
   │                          │── Check R2 version ────────►│
   │                          │◄── Return version ──────────│
   │                          │                            │
   │                          │── If R2 newer, download ───►│
   │                          │◄── SQLite file ─────────────│
   │                          │                            │
   │                          │── TrackedConnection ───────│
   │                          │   (marks writes)           │
   │                          │                            │
   │◄── Response ─────────────│                            │
   │                          │                            │
   │                          │── If writes: upload ───────►│
   │                          │   with version++           │
```

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Sync Rules | CRITICAL | `sync-` |
| 2 | Write Tracking | HIGH | `write-` |
| 3 | Version Control | HIGH | `version-` |
| 4 | Conflict Handling | MEDIUM | `conflict-` |

## Quick Reference

### Sync Rules (CRITICAL)
- `sync-r2-always` - All user data syncs to R2, never local only
- `sync-no-localstorage` - Never use localStorage/sessionStorage
- `sync-on-mutation` - Upload to R2 after any write operation

### Write Tracking (HIGH)
- `write-tracked-connection` - Use TrackedConnection wrapper
- `write-batched` - Multiple writes in one request = one upload
- `write-detect-operations` - Auto-detect INSERT/UPDATE/DELETE

### Version Control (HIGH)
- `version-metadata` - Store version in R2 object metadata
- `version-compare-on-start` - Compare local vs R2 on request start
- `version-increment-on-write` - Increment version after each sync

### Conflict Handling (MEDIUM)
- `conflict-last-write-wins` - Current strategy: last write wins
- `conflict-log-warning` - Log when conflict detected
- `conflict-future-websocket` - Future: WebSocket notifications

---

## Database Location

```
user_data/{user_id}/database.sqlite   # Local
reel-ballers-users/{user_id}/database.sqlite   # R2
```

Dev default: `C:\Users\imank\projects\video-editor\user_data\a\database.sqlite`

---

## Request Flow

```python
# 1. UserContextMiddleware sets user ID
# 2. DatabaseSyncMiddleware.init_request_context()
# 3. Request handler uses TrackedConnection

with get_db_connection() as conn:
    cursor = conn.cursor()
    cursor.execute("INSERT INTO projects...")  # Marked as write
    cursor.execute("SELECT * FROM games")      # Not marked (read)
    conn.commit()

# 4. On response: if writes occurred, sync to R2 with version++
```

---

## Size Thresholds

```python
DB_SIZE_WARNING_THRESHOLD = 512 * 1024   # 512KB - info log
DB_SIZE_MIGRATION_THRESHOLD = 1024 * 1024  # 1MB - warning log
```

When DB exceeds 1MB, consider migrating archived data to Durable Objects.

---

## Complete Rules

See individual rule files in `rules/` directory.
