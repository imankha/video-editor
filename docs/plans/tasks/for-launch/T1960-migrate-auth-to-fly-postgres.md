# T1960: Migrate Global SQLite to Upstash Redis

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-04-27
**Updated:** 2026-05-01

## Problem

Global SQLite databases (auth.sqlite, sharing.sqlite) are the only shared state in a system that otherwise scales with per-user SQLite files. This architecture has fundamental scaling problems:

1. **Restart fragility**: Local SQLite is lost on machine restart. Current mitigations (R2 backup/restore, T1195 session persistence) are workarounds for a database that shouldn't be local.
2. **Concurrent write contention**: All users share one SQLite file. `credit_summary` updates, session creation, and `last_seen_at` writes all contend on the same file. SQLite serializes writes — this becomes a bottleneck.
3. **Multi-machine impossible**: With fly-replay (T1190), auth requests must always route to the machine holding auth.sqlite. A hosted DB eliminates machine affinity for auth entirely.
4. **Full-file sync is O(users)**: `sync_auth_db_to_r2()` uploads the entire file on every write. Every user registration pays the cost of every existing user.
5. **sharing.sqlite has the same problems**: Added for the Core Sharing Epic (T1750), sharing.sqlite follows auth.sqlite's R2 sync pattern. Must migrate before alpha exit.

auth.sqlite is ~70KB today (pre-launch), but it grows with total user count — not per-user activity. sharing.sqlite grows with total shares created.

**This task gates alpha exit.** sharing.sqlite (Option C) was chosen as a temporary solution to ship sharing features fast; this task provides the durable persistence strategy.

## Solution

Migrate global SQLite tables to **Upstash Redis** on Fly.io — a serverless, durable Redis service with built-in persistence and replication.

### What migrates

**From auth.sqlite:**

| Table | Current | After (Upstash Redis) |
|-------|---------|----------------------|
| users | SQLite, grows with user count | Redis hash per user, indexed by email/google_id |
| sessions | Lost on restart without T1195 workaround | Redis hash with TTL — sessions expire natively |
| otp_codes | No cleanup, accumulate forever | Redis keys with TTL — auto-expire |
| admin_users | Rarely written | Redis set |
| impersonation_audit | Append-only log | Redis list or stream |

**From sharing.sqlite:**

| Table | Current | After (Upstash Redis) |
|-------|---------|----------------------|
| shared_videos | SQLite, R2 sync on every write | Redis hash per share, indexed by token |

### What stays as SQLite

Per-user databases (`profile.sqlite`) remain as local SQLite synced to R2. The per-user pattern works well — each DB is small, isolated, and only accessed by one user at a time.

## Changes

### Infrastructure
1. Provision Upstash Redis via Fly.io integration
2. Set `UPSTASH_REDIS_URL` secret on staging and production apps

### Backend
1. Add `redis`/`upstash-redis` dependency
2. Create Redis connection in app startup
3. Migrate `auth_db.py` functions from SQLite to Redis operations
4. Migrate `sharing_db.py` functions from SQLite to Redis operations
5. Remove `restore_auth_db_or_fail()` and `restore_sharing_db_or_fail()` — no longer needed
6. Remove `sync_auth_db_to_r2()` and `sync_sharing_db_to_r2()` — no longer needed
7. Remove session cache (`_session_cache`) — Redis handles this natively
8. Update `validate_session()` to query Redis
9. Remove auth.sqlite and sharing.sqlite from `SKIP_SYNC_PATHS`

### Data Migration
1. Write one-shot migration script: read auth.sqlite + sharing.sqlite from R2, insert into Redis
2. Run on staging first, verify all users/sessions/shares present
3. Run on production during a maintenance window

## Codebase Audit

### auth_db.py Function Inventory (35 functions)

Every function needs migration or removal. Grouped by concern:

**Connection management (remove):**
- `_get_connection()` — SQLite connection with WAL/timeout
- `get_auth_db()` — context manager → replace with Redis client
- `init_auth_db()` — table creation + schema migrations → Redis key patterns

**R2 sync (remove entirely):**
- `_get_auth_db_r2_key()` — R2 key for auth.sqlite
- `_r2_enabled()` — R2 feature flag
- `sync_auth_db_from_r2()` — download auth.sqlite on startup
- `restore_auth_db_or_fail()` — retry loop for startup restore
- `sync_auth_db_to_r2()` — upload auth.sqlite after writes

**T1195 session R2 persistence (remove entirely):**
- `_get_session_r2_key()` — R2 key for per-session objects
- `persist_session_to_r2()` — write session JSON to R2
- `restore_session_from_r2()` — lazy-restore session from R2
- `delete_session_from_r2()` — delete session object from R2

**User operations (migrate to Redis):**
- `get_user_by_email(email)` — lookup by secondary index
- `get_user_by_google_id(google_id)` — lookup by secondary index
- `get_user_by_id(user_id)` — primary key lookup
- `create_user(user_id, email, google_id, verified_at)` — HSET + index keys
- `link_google_to_user(user_id, email, google_id)` — HSET update
- `link_email_to_user(user_id, email)` — HSET update + reindex
- `update_picture_url(user_id, picture_url)` — HSET field update
- `update_last_seen(user_id)` — HSET field update (high frequency)
- `generate_user_id()` — UUID generation (no DB, keep as-is)

**Session operations (migrate to Redis):**
- `create_session(user_id, ttl_days)` — SET with TTL (native Redis expiry)
- `validate_session(session_id)` — GET (replaces cache + SQLite + R2 fallback chain)
- `invalidate_session(session_id)` — DEL
- `invalidate_user_sessions(user_id)` — SMEMBERS + DEL (user→sessions index)
- `cleanup_expired_sessions()` — no-op (Redis TTL handles this automatically)

**Admin operations (migrate to Redis):**
- `is_admin(user_id)` — SISMEMBER
- `get_admin_emails()` — SMEMBERS
- `get_all_users_for_admin()` — SCAN pattern match (admin panel)

**Impersonation (migrate to Redis):**
- `create_impersonation_session(target, impersonator, ttl)` — SET with metadata
- `find_or_create_admin_restore_session(admin_user_id)` — GET or create_session
- `log_impersonation(admin, target, action, ip, ua)` — LPUSH audit list

### sharing_db.py Function Inventory

**Connection management (remove):**
- `get_sharing_db()` — context manager → replace with Redis client
- `init_sharing_db()` — table creation → Redis key patterns

**R2 sync (remove entirely):**
- `sync_sharing_db_from_r2()` — download sharing.sqlite on startup
- `sync_sharing_db_to_r2()` — upload sharing.sqlite after writes

**Share operations (migrate to Redis):**
- `create_shares()` — HSET per share + index by token/video/sharer/recipient
- `get_share_by_token()` — HGET by token
- `list_shares_for_video()` — SMEMBERS video→shares index
- `update_share_visibility()` — HSET field update
- `revoke_share()` — HSET revoked_at field

### Import Surface Area (14+ files)

See original T1960 audit for the full list of files importing from auth_db.py. sharing_db.py imports will be in shares.py router + test_shares.py.

### Scripts with direct sqlite3 access (5 files)

| Script | What it does | Migration needed |
|--------|-------------|-----------------|
| `src/backend/scripts/reset_account.py` | Imports `AUTH_DB_PATH`, opens sqlite3 directly | Rewrite to use Redis client |
| `src/backend/scripts/reset_all_accounts.py` | Same pattern | Same |
| `scripts/delete_user.py` | Direct sqlite3.connect | Same |
| `scripts/reset_all_accounts.py` | Direct sqlite3.connect | Same |
| `scripts/reset-test-user.py` | R2 download → local edit → re-upload | Complete rewrite — connect to Redis directly |

## Context

### Related Tasks
- T1195 (Session Durability on Deploy) — interim fix; T1960 makes it unnecessary
- T1190 (Session & Machine Pinning) — machine pinning becomes simpler when auth doesn't need local disk
- T1290 (Auth DB Restore Must Succeed) — entire restore mechanism becomes unnecessary
- T1750 (Share Backend Model & API) — sharing.sqlite migrates to Redis here

### Risks
- **Migration downtime**: Need a brief maintenance window to migrate data and switch over
- **New dependency**: Upstash Redis adds a managed service to monitor
- **Redis data modeling**: Relational queries (JOINs, complex WHERE clauses) need redesign as Redis key patterns + secondary indexes
- **5 scripts bypass auth_db.py**: Direct sqlite3.connect calls must all be migrated
- **Test fixture overhaul**: Test files using init_auth_db + create_user need Redis-aware fixtures

## Implementation

### Steps
1. [ ] Provision Upstash Redis on staging via Fly.io
2. [ ] Design Redis key schema (user hashes, session keys with TTL, secondary indexes)
3. [ ] Add redis dependency + connection setup in `main.py`
4. [ ] Migrate user operations (6 functions) to Redis
5. [ ] Migrate session operations (5 functions) to Redis — remove R2 persist/restore/delete
6. [ ] Migrate admin + impersonation operations (6 functions) to Redis
7. [ ] Migrate sharing_db.py operations to Redis
8. [ ] Migrate `_update_credit_summary` in user_db.py to write to Redis
9. [ ] Rewrite `_reset_test_account` in auth.py to use auth_db functions
10. [ ] Remove R2 sync subsystem for auth and sharing
11. [ ] Remove T1195 session R2 subsystem
12. [ ] Remove session cache (Redis is the cache)
13. [ ] Migrate 5 scripts from direct sqlite3 to Redis
14. [ ] Create Redis test fixture, update test files
15. [ ] Remove obsolete test files
16. [ ] Write data migration script (auth.sqlite + sharing.sqlite from R2 → Redis)
17. [ ] Run migration on staging, verify all auth + sharing flows
18. [ ] Run migration on production

## Acceptance Criteria

- [ ] All auth queries use Upstash Redis instead of local SQLite
- [ ] All sharing queries use Upstash Redis instead of local SQLite
- [ ] Sessions survive machine restarts without any R2 workarounds
- [ ] Sessions auto-expire via Redis TTL (no manual cleanup needed)
- [ ] Concurrent writes don't contend on a single file
- [ ] auth.sqlite and sharing.sqlite R2 sync code is removed
- [ ] T1195 session R2 persistence code is removed
- [ ] All scripts migrated from direct sqlite3 to Redis
- [ ] All test files updated with Redis fixtures
- [ ] Data migration script successfully moves all existing data
- [ ] Staging fully tested before production migration
