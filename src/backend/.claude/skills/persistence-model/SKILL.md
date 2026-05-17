---
name: persistence-model
description: "Per-user SQLite + R2 cloud sync architecture. Version-based sync, batched writes, conflict detection. Apply when working with per-user data (clips, projects, credits). Does NOT apply to auth/sharing/sessions -- those use Fly Postgres via get_pg()."
license: MIT
author: video-editor
version: 2.0.0
---

# Persistence Model

## Two Database Systems

| System | What it stores | Technology | Access pattern |
|--------|---------------|------------|----------------|
| **Fly Postgres** | Users, sessions, shares, admin, game_ref_counts, r2_grace_deletions | `psycopg2` via `get_pg()` context manager | `%s` params, `RealDictCursor`, `row["col"]` |
| **Per-user SQLite** | Clips, projects, credits, game_storage, transactions | `sqlite3` via `get_user_db_connection()` | `?` params, `sqlite3.Row`, `row["col"]` |

**This skill covers the per-user SQLite + R2 sync system only.** For Postgres auth/sharing, see `app/services/pg.py`, `app/services/auth_db.py`, `app/services/sharing_db.py`.

## Data Locality Boundary (T2930)

**Rule: All per-user data belongs in profile.sqlite. Postgres is only for global or cross-user data.**

| Data | Location | Rationale |
|------|----------|-----------|
| Per-user game expiry | `profile.sqlite` → `game_storage` table | Per-user, syncs to R2 automatically |
| Global ref counts | Postgres → `game_ref_counts` (blake3_hash, ref_count, latest_expiry) | Cross-user dedup for R2 cleanup |
| Grace deletions | Postgres → `r2_grace_deletions` | Global R2 lifecycle |
| Auth, sessions | Postgres | Must be accessible pre-sync from any device |
| Shares | Postgres | Recipients query by token/email without knowing sharer |

**When adding new per-user data:** Put it in profile.sqlite. If a global view is needed (e.g., for a sweep), store a lightweight index in Postgres (like `game_ref_counts`) while keeping the full data in SQLite.

## Per-User SQLite Architecture

Single source of truth: SQLite per-user, synced to Cloudflare R2 with version tracking.

## When to Apply
- Creating per-user database operations (clips, projects, credits)
- Implementing per-user data persistence
- Working with user data that syncs to R2
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

## Storage Locations

```
# Per-user SQLite
user_data/{user_id}/profiles/{profile_id}/profile.sqlite              # Local
{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite        # R2

# Game videos (deduplicated, shared across ALL environments)
games/{blake3_hash}.mp4                                               # R2 (global, no env prefix)
{APP_ENV}/games/{blake3_hash}.mp4                                     # R2 (env-prefixed, used by r2_global_key())
```

**R2 bucket:** `reel-ballers-users` (all envs share one bucket, separated by `{APP_ENV}/` prefix for user data).

**Game videos are global:** All environments share the same `games/` folder in R2. The game files are deduplicated by blake3 hash — multiple users and environments reference the same physical file.

**Finding user_id:** Always query Postgres `users` table (`SELECT user_id FROM users WHERE email = %s`). Never use `user_data/auth.sqlite` — it is a stale pre-migration artifact.

**Finding profile_id:** Check `user_data/{user_id}/user.sqlite` → `user_settings` table → `selected_profile` key.

**Note:** `auth.sqlite` and `sharing.sqlite` no longer exist. Auth/sharing data lives in Fly Postgres. Email-named directories in `user_data/` (e.g. `imankh@gmail.com/`) are also stale artifacts — real user directories use UUID user_ids from Postgres.

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
