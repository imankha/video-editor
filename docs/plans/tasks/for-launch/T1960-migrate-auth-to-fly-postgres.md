# T1960: Migrate Global SQLite to Fly Postgres

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-04-27
**Updated:** 2026-05-01

## Problem

Global SQLite databases (auth.sqlite, sharing.sqlite) are the only shared state in a system that otherwise scales correctly with per-user SQLite files. These global databases have fundamental correctness problems:

1. **Concurrent write contention**: All users share one SQLite file. Session creation, `last_seen_at` writes, and `credit_summary` updates all contend on the same file. SQLite serializes writes — this becomes a bottleneck.
2. **Multi-machine impossible**: With fly-replay (T1190), auth requests must always route to the machine holding auth.sqlite. A hosted DB eliminates machine affinity for auth entirely.
3. **Restart fragility**: Local SQLite is lost on machine restart. Current mitigations (R2 backup/restore, T1195 session persistence) are workarounds for a database that shouldn't be local.
4. **Full-file sync is O(users)**: `sync_auth_db_to_r2()` uploads the entire file on every write. Every user registration pays the cost of every existing user.
5. **sharing.sqlite has the same problems**: Added for the Core Sharing Epic (T1750), sharing.sqlite follows auth.sqlite's R2 sync pattern.

**This task gates alpha exit.** sharing.sqlite (Option C) was chosen as a temporary solution to ship sharing features fast; this task provides the durable persistence strategy.

### Why Postgres (not Redis)

Auth and sharing data is relational:
- `users` table needs unique constraints on email AND google_id, with lookups by three keys
- `shared_videos` needs four indexed columns (token, video_id, sharer, recipient)
- Impersonation audit is a relational log queried by admin_user_id and target_user_id

Redis would require manually maintaining secondary indexes for each lookup pattern — if one is missed, data is silently inconsistent. Postgres gives us all of this with `CREATE INDEX`.

Redis also charges per-command ($0.20/100K on Upstash). Session validation on every request at 100K DAU = 90M lookups/month = $180/month. Postgres on a $2-4/month Fly machine handles the same workload at fixed cost.

### Why per-user SQLite stays

Per-user databases (profile.sqlite, user.sqlite) are correct as-is with session pinning (T1190):
- Only one user reads/writes each database
- Per-user write lock serializes all requests
- R2 sync completes before response — no false durability
- Local reads at ~0.1ms are unbeatable
- $0/month scaling (R2 operations are negligible at current scale)

Moving per-user data to Postgres would add ~5-20ms latency per read for zero correctness benefit.

## Solution

Migrate global SQLite tables to **Fly Postgres (unmanaged)** — a self-hosted PostgreSQL instance on a Fly machine (~$2-4/month).

### What migrates

**From auth.sqlite:**

| Table | Current | After (Postgres) |
|-------|---------|-------------------|
| users | SQLite, full-file R2 sync | Postgres table, indexed by email/google_id/user_id |
| sessions | Lost on restart without T1195 workaround | Postgres table, cleanup via scheduled DELETE |
| otp_codes | No cleanup, accumulate forever | Postgres table, cleanup via scheduled DELETE |
| admin_users | Rarely written | Postgres table |
| impersonation_audit | Append-only log | Postgres table, indexed by admin/target |

**From sharing.sqlite:**

| Table | Current | After (Postgres) |
|-------|---------|-------------------|
| shared_videos | SQLite, R2 sync on every write | Postgres table, indexed by token/video/sharer/recipient |

**New (from Storage Credits epic, T1580):**

| Table | Current | After (Postgres) |
|-------|---------|-------------------|
| game_storage_refs | Auth SQLite (interim until T1960) | Postgres table, cross-user game expiry tracking for R2 cleanup |

### What stays as SQLite

Per-user databases (`profile.sqlite`, `user.sqlite`) remain as local SQLite synced to R2. The per-user pattern is correct with session pinning — each DB is small, isolated, and only accessed by one user at a time.

## Changes

### Infrastructure
1. Create Fly Postgres app (unmanaged): `fly postgres create --name reelballers-db`
2. Attach to backend app: `fly postgres attach reelballers-db`
3. `DATABASE_URL` secret automatically set on staging and production apps
4. Add HA replica at 10K+ DAU (~$4/month additional)

### Backend
1. Add `asyncpg` or `psycopg2` dependency + connection pool in app startup
2. Create Postgres schema (DDL migration script with all tables + indexes)
3. Migrate `auth_db.py` functions from SQLite to Postgres queries
4. Migrate `sharing_db.py` functions from SQLite to Postgres queries
5. Remove `restore_auth_db_or_fail()` and `restore_sharing_db_or_fail()` — no longer needed
6. Remove `sync_auth_db_to_r2()` and `sync_sharing_db_to_r2()` — no longer needed
7. Remove session cache (`_session_cache`) — Postgres is fast enough for direct lookups
8. Update `validate_session()` to query Postgres (indexed lookup, ~5ms)
9. Remove auth.sqlite and sharing.sqlite from `SKIP_SYNC_PATHS`
10. Remove T1195 session R2 persistence subsystem

### Postgres Schema

```sql
-- Users
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    google_id TEXT UNIQUE,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    picture_url TEXT,
    credit_summary JSONB
);

-- Sessions
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    impersonator_user_id TEXT,
    impersonation_expires_at TIMESTAMPTZ
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- OTP codes
CREATE TABLE otp_codes (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_codes_email ON otp_codes(email);

-- Admin
CREATE TABLE admin_users (
    email TEXT PRIMARY KEY
);

-- Impersonation audit
CREATE TABLE impersonation_audit (
    id SERIAL PRIMARY KEY,
    admin_user_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_impersonation_audit_admin ON impersonation_audit(admin_user_id);
CREATE INDEX idx_impersonation_audit_target ON impersonation_audit(target_user_id);

-- Game storage references (cross-user)
--
-- Tracks per-user storage expiry for deduped game videos.
-- The daily cleanup sweep queries this to find R2 objects safe to delete:
-- all user references expired → delete from R2.
--
-- ACCESS PATTERNS:
--
-- READ  Cleanup sweep (daily cron):
--       SELECT blake3_hash FROM game_storage_refs
--         GROUP BY blake3_hash HAVING MAX(storage_expires_at) < now()
--       → idx_game_refs_hash covers GROUP BY; Postgres scans all rows but table is small
--
-- READ  Check if game expired for a user (on game list load):
--       SELECT storage_expires_at WHERE user_id = $1 AND blake3_hash = $2
--       → UNIQUE constraint covers this (single-row lookup)
--
-- READ  Extension modal (show current expiry + compute cost):
--       SELECT storage_expires_at, game_size_bytes WHERE user_id = $1 AND blake3_hash = $2
--       → Same UNIQUE index
--
-- WRITE Register game upload (1 row per upload):
--       INSERT INTO game_storage_refs (...) VALUES (...)
--
-- WRITE Extend storage (user pays credits to push expiry forward):
--       UPDATE game_storage_refs SET storage_expires_at = $1
--         WHERE user_id = $2 AND blake3_hash = $3
--
CREATE TABLE game_storage_refs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    profile_id TEXT NOT NULL,               -- For R2 key construction (no FK — profiles in per-user SQLite)
    blake3_hash TEXT NOT NULL,              -- Deduped game video hash (maps to R2 key: {env}/games/{hash}.mp4)
    game_size_bytes BIGINT NOT NULL,        -- Original upload size, used for extension cost calculation
    storage_expires_at TIMESTAMPTZ NOT NULL,-- Per-user expiry; R2 object deleted when MAX() across all users passes
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, profile_id, blake3_hash)
);

-- Cleanup sweep: find hashes where ALL references are expired
CREATE INDEX idx_game_refs_hash ON game_storage_refs(blake3_hash);

-- User's game list: check expiry for all games belonging to a user
CREATE INDEX idx_game_refs_user ON game_storage_refs(user_id);

-- Shared videos
--
-- ACCESS PATTERNS (ordered by frequency):
--
-- READ  (hottest) Token lookup on every shared link visit (unauthenticated):
--       SELECT * WHERE share_token = $1
--       → UNIQUE index on share_token (single-row index scan, ~0.1ms)
--
-- READ  List shares for a video (sharer opens share modal):
--       SELECT * WHERE video_id = $1 AND sharer_user_id = $2 ORDER BY shared_at DESC
--       → Composite index (video_id, sharer_user_id) covers the WHERE; Postgres sorts in-memory (tiny result set)
--
-- READ  Contacts autocomplete (T1800 — sharer types in share modal):
--       SELECT recipient_email, COUNT(*), MAX(shared_at) WHERE sharer_user_id = $1
--         AND revoked_at IS NULL GROUP BY recipient_email ORDER BY count DESC LIMIT 20
--       → sharer_user_id index scans all shares for this user (~10-100 rows), groups in-memory
--
-- READ  Recipient inbox (future T1830 — recipient views their shared content):
--       SELECT * WHERE recipient_email = $1 AND revoked_at IS NULL ORDER BY shared_at DESC
--       → recipient_email index
--
-- WRITE Create shares (batch, 1-N rows per share action):
--       INSERT INTO shared_videos (...) VALUES (...) — one per recipient
--       Low volume (~1-5 rows per share action, infrequent)
--
-- WRITE Revoke/toggle/mark-watched (single row by token):
--       UPDATE ... WHERE share_token = $1 AND sharer_user_id = $2
--       → share_token UNIQUE index (single-row update)
--
CREATE TABLE shared_videos (
    id SERIAL PRIMARY KEY,
    share_token TEXT UNIQUE NOT NULL,
    video_id INTEGER NOT NULL,               -- FK to sharer's final_videos.id (cross-DB, informational only)
    sharer_user_id TEXT NOT NULL REFERENCES users(user_id),
    sharer_profile_id TEXT NOT NULL,          -- For R2 key construction (no FK — profiles live in per-user SQLite)
    video_filename TEXT NOT NULL,             -- Denormalized from final_videos.filename (stable — re-export creates new row)
    video_name TEXT,                          -- Denormalized display name
    video_duration REAL,                      -- Denormalized duration in seconds
    recipient_email TEXT NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT false,
    shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    watched_at TIMESTAMPTZ                   -- T1790: set on first play, NULL until watched
);

-- Token lookup: the hottest path (every /shared/{token} visit, potentially unauthenticated)
-- UNIQUE constraint already creates this index, but listing for clarity
CREATE UNIQUE INDEX idx_shared_videos_token ON shared_videos(share_token);

-- "List shares for my video" — covers WHERE video_id = ? AND sharer_user_id = ?
-- Composite beats two single-column indexes for this query
CREATE INDEX idx_shared_videos_video_sharer ON shared_videos(video_id, sharer_user_id);

-- Contacts autocomplete + "all my shares" admin view
CREATE INDEX idx_shared_videos_sharer ON shared_videos(sharer_user_id);

-- Recipient inbox (future T1830): "show me everything shared with me"
CREATE INDEX idx_shared_videos_recipient ON shared_videos(recipient_email);
```

### Session cleanup

Replace Redis-style TTL with a scheduled DELETE:

```sql
DELETE FROM sessions WHERE expires_at < now();
DELETE FROM otp_codes WHERE expires_at < now();
```

Run via a lightweight cron (Fly Machine scheduled task or app-level periodic task) every hour.

### Data Migration
1. Write one-shot migration script: read auth.sqlite + sharing.sqlite from R2, INSERT into Postgres
2. Run on staging first, verify all users/sessions/shares present
3. Run on production during a brief maintenance window

## Codebase Audit

### auth_db.py Function Inventory (35 functions)

Every function needs migration or removal. Grouped by concern:

**Connection management (replace with Postgres pool):**
- `_get_connection()` — SQLite connection → Postgres pool.acquire()
- `get_auth_db()` — context manager → Postgres pool context manager
- `init_auth_db()` — table creation → run DDL migration on startup

**R2 sync (remove entirely):**
- `_get_auth_db_r2_key()`
- `_r2_enabled()`
- `sync_auth_db_from_r2()`
- `restore_auth_db_or_fail()`
- `sync_auth_db_to_r2()`

**T1195 session R2 persistence (remove entirely):**
- `_get_session_r2_key()`
- `persist_session_to_r2()`
- `restore_session_from_r2()`
- `delete_session_from_r2()`

**User operations (migrate to Postgres):**
- `get_user_by_email(email)` — `SELECT ... WHERE email = $1`
- `get_user_by_google_id(google_id)` — `SELECT ... WHERE google_id = $1`
- `get_user_by_id(user_id)` — `SELECT ... WHERE user_id = $1`
- `create_user(user_id, email, google_id, verified_at)` — `INSERT INTO users ...`
- `link_google_to_user(user_id, email, google_id)` — `UPDATE users SET ...`
- `link_email_to_user(user_id, email)` — `UPDATE users SET ...`
- `update_picture_url(user_id, picture_url)` — `UPDATE users SET ...`
- `update_last_seen(user_id)` — `UPDATE users SET last_seen_at = now() ...`
- `generate_user_id()` — UUID generation (no DB, keep as-is)

**Session operations (migrate to Postgres):**
- `create_session(user_id, ttl_days)` — `INSERT INTO sessions ...`
- `validate_session(session_id)` — `SELECT ... WHERE session_id = $1 AND expires_at > now()`
- `invalidate_session(session_id)` — `DELETE FROM sessions WHERE session_id = $1`
- `invalidate_user_sessions(user_id)` — `DELETE FROM sessions WHERE user_id = $1`
- `cleanup_expired_sessions()` — `DELETE FROM sessions WHERE expires_at < now()`

**Admin operations (migrate to Postgres):**
- `is_admin(user_id)` — `SELECT 1 FROM admin_users WHERE email = (SELECT email FROM users WHERE user_id = $1)`
- `get_admin_emails()` — `SELECT email FROM admin_users`
- `get_all_users_for_admin()` — `SELECT * FROM users` (admin panel)

**Impersonation (migrate to Postgres):**
- `create_impersonation_session(target, impersonator, ttl)` — INSERT with joined session
- `find_or_create_admin_restore_session(admin_user_id)` — SELECT or INSERT
- `log_impersonation(admin, target, action, ip, ua)` — `INSERT INTO impersonation_audit ...`

### sharing_db.py Function Inventory

**Connection management (replace with Postgres pool):**
- `get_sharing_db()` — context manager → use same Postgres pool
- `init_sharing_db()` — table creation → DDL migration

**R2 sync (remove entirely):**
- `sync_sharing_db_from_r2()`
- `sync_sharing_db_to_r2()`

**Share operations (migrate to Postgres):**
- `create_shares()` — `INSERT INTO shared_videos ... RETURNING share_token, recipient_email`
- `get_share_by_token()` — `SELECT ... WHERE share_token = $1` (hottest path — every link visit)
- `list_shares_for_video()` — `SELECT ... WHERE video_id = $1 AND sharer_user_id = $2`
- `update_share_visibility()` — `UPDATE ... SET is_public = $1 WHERE share_token = $2`
- `revoke_share()` — `UPDATE ... SET revoked_at = now() WHERE share_token = $1`
- `mark_share_watched()` — `UPDATE ... SET watched_at = now() WHERE share_token = $1 AND watched_at IS NULL` (T1790, idempotent)
- `list_contacts_for_user()` — `SELECT recipient_email, COUNT(*), MAX(shared_at) ... GROUP BY recipient_email` (T1800)

### Import Surface Area (14+ files)

See original T1960 audit for the full list of files importing from auth_db.py. sharing_db.py imports will be in shares.py router + test_shares.py.

### Scripts with direct sqlite3 access (5 files)

| Script | What it does | Migration needed |
|--------|-------------|-----------------|
| `src/backend/scripts/reset_account.py` | Imports `AUTH_DB_PATH`, opens sqlite3 directly | Rewrite to use Postgres client |
| `src/backend/scripts/reset_all_accounts.py` | Same pattern | Same |
| `scripts/delete_user.py` | Direct sqlite3.connect | Same |
| `scripts/reset_all_accounts.py` | Direct sqlite3.connect | Same |
| `scripts/reset-test-user.py` | R2 download → local edit → re-upload | Rewrite — connect to Postgres directly |

## Context

### Related Tasks
- T1195 (Session Durability on Deploy) — interim fix; T1960 makes it unnecessary
- T1190 (Session & Machine Pinning) — machine pinning becomes simpler when auth doesn't need local disk
- T1290 (Auth DB Restore Must Succeed) — entire restore mechanism becomes unnecessary
- T1750 (Share Backend Model & API) — sharing.sqlite migrates to Postgres here
- T1580 (Game Storage Credits) — game_storage_refs table added to auth.sqlite as interim; migrates to Postgres here
- T1583 (Auto-Export Pipeline) — adds `get_users_for_hash()` to auth_db.py + asyncio sweep loop; see migration notes below

### T1583 Migration Notes (Auto-Export Pipeline)

T1583 (shipped before T1960) adds the following to auth_db.py that must be migrated:

**New function: `get_users_for_hash(blake3_hash) -> list[dict]`**
- Returns all `(user_id, profile_id)` pairs referencing a game hash
- Query: `SELECT user_id, profile_id FROM game_storage_refs WHERE blake3_hash = ?`
- Postgres migration: straightforward — same query with `$1` parameter

**Sweep loop in main.py: `run_sweep_loop()`**
- asyncio background task started on app startup
- Calls `get_expired_hashes()` and `get_users_for_hash()` from auth_db.py
- Calls `get_next_expiry()` (new auth_db function) to determine sleep duration
- All three functions query `game_storage_refs` — migrate together
- The sweep also accesses per-user profile.sqlite (games, raw_clips, final_videos) — that part stays as-is

**New function: `get_next_expiry() -> datetime | None`**
- Query: `SELECT MIN(storage_expires_at) FROM game_storage_refs WHERE storage_expires_at > datetime('now')`
- Used by sweep loop to determine next wake time ("cron till next event" pattern)

### Risks
- **Migration downtime**: Need a brief maintenance window to migrate data and switch over
- **New dependency**: Fly Postgres adds a managed instance to monitor (but it's just Postgres — well-understood)
- **5 scripts bypass auth_db.py**: Direct sqlite3.connect calls must all be migrated
- **Test fixture overhaul**: Test files using init_auth_db + create_user need Postgres-aware fixtures

### Cost
- Fly Postgres (unmanaged, shared-cpu-1x, 256MB): ~$2/month
- Storage (1GB volume): $0.15/month
- HA replica (add at 10K+ DAU): +$2/month
- At 100K DAU with larger instance + replica: ~$16/month
- At 500K DAU: ~$40/month

For comparison, Upstash Redis at 100K DAU would cost ~$180+/month for session validation alone.

## Implementation

### Steps
1. [ ] Create Fly Postgres app on staging
2. [ ] Design and apply Postgres schema (DDL script with all tables + indexes)
3. [ ] Add `psycopg2-binary` dependency + connection pool setup in `main.py`
4. [ ] Migrate user operations (6 functions) to Postgres
5. [ ] Migrate session operations (5 functions) to Postgres
6. [ ] Migrate admin + impersonation operations (6 functions) to Postgres
7. [ ] Migrate sharing_db.py operations to Postgres
8. [ ] Migrate `_update_credit_summary` in user_db.py to write to Postgres
9. [ ] Rewrite `_reset_test_account` in auth.py to use auth_db functions
10. [ ] Remove R2 sync subsystem for auth and sharing
11. [ ] Remove T1195 session R2 subsystem
12. [ ] Remove session cache (Postgres indexed lookup is fast enough)
13. [ ] Migrate 5 scripts from direct sqlite3 to Postgres
14. [ ] Add session/OTP cleanup: periodic `DELETE WHERE expires_at < now()`
15. [ ] Create Postgres test fixture, update test files
16. [ ] Remove obsolete test files
17. [ ] Write data migration script (auth.sqlite + sharing.sqlite from R2 → Postgres)
18. [ ] Run migration on staging, verify all auth + sharing flows
19. [ ] Create Fly Postgres app on production
20. [ ] Run migration on production

## Acceptance Criteria

- [ ] All auth queries use Fly Postgres instead of local SQLite
- [ ] All sharing queries use Fly Postgres instead of local SQLite
- [ ] Sessions survive machine restarts natively (no R2 workarounds)
- [ ] Expired sessions/OTP codes cleaned up by periodic task
- [ ] Concurrent writes handled by Postgres MVCC (no file-level contention)
- [ ] auth.sqlite and sharing.sqlite R2 sync code is removed
- [ ] T1195 session R2 persistence code is removed
- [ ] All scripts migrated from direct sqlite3 to Postgres
- [ ] All test files updated with Postgres fixtures
- [ ] Data migration script successfully moves all existing data
- [ ] Staging fully tested before production migration
