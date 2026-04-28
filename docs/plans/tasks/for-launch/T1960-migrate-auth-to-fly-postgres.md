# T1960: Migrate Auth to Fly Postgres

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-04-27
**Updated:** 2026-04-28

## Problem

auth.sqlite is the only shared database in a system that otherwise scales by using per-user SQLite files. This architecture has fundamental scaling problems:

1. **Restart fragility**: Local SQLite is lost on machine restart. Current mitigations (R2 backup/restore, T1195 session persistence) are workarounds for a database that shouldn't be local.
2. **Concurrent write contention**: All users share one SQLite file. `credit_summary` updates, session creation, and `last_seen_at` writes all contend on the same file. SQLite serializes writes — this becomes a bottleneck.
3. **Multi-machine impossible**: With fly-replay (T1190), auth requests must always route to the machine holding auth.sqlite. A hosted DB eliminates machine affinity for auth entirely.
4. **Full-file sync is O(users)**: `sync_auth_db_to_r2()` uploads the entire file. Every user registration pays the cost of every existing user.

auth.sqlite is ~70KB today (pre-launch), but it grows with total user count — not per-user activity. At 10K users it's several MB; at 100K it's a real problem.

## Solution

Migrate auth tables (users, sessions, otp_codes, admin_users, impersonation_audit) to **Fly Postgres**, a managed PostgreSQL database built into the Fly.io platform.

### Why Fly Postgres

| Option | Pros | Cons |
|--------|------|------|
| **Fly Postgres** | Built into Fly (single vendor), managed, survives restarts natively, handles concurrent writes, read replicas in other regions, familiar SQL | Requires SQLite→Postgres query migration (minor syntax differences) |
| Cloudflare D1 | SQLite-compatible queries | Designed for Workers, not external access; HTTP API adds latency from Fly |
| Turso (libSQL) | SQLite-compatible, edge replicas | Third vendor to manage; less mature than Postgres |

Fly Postgres is the best fit: same platform as the backend, zero restart issues, proper concurrent write handling, and Postgres is battle-tested for auth workloads.

### What migrates

| Table | Current (auth.sqlite) | After (Fly Postgres) |
|-------|----------------------|---------------------|
| users | Shared, grows with user count | Postgres — concurrent writes, no file lock |
| sessions | Lost on restart without T1195 workaround | Postgres — survives restarts natively |
| otp_codes | Shared, no cleanup | Postgres — TTL via `expires_at` index |
| admin_users | Rarely written | Postgres — trivial |
| impersonation_audit | Append-only log | Postgres — proper audit table |

### What stays as SQLite

Per-user databases (`profile.sqlite`, `user.sqlite`) remain as local SQLite synced to R2. The per-user pattern works well — each DB is small, isolated, and only accessed by one user at a time.

## Changes

### Infrastructure
1. Provision Fly Postgres cluster: `fly postgres create --name reel-ballers-auth`
2. Attach to the app: `fly postgres attach --app reel-ballers-api-staging`
3. Set `DATABASE_URL` secret on both staging and production apps

### Backend
1. Add `asyncpg` (or `psycopg`) dependency
2. Create Postgres connection pool in app startup
3. Migrate `auth_db.py` functions from SQLite to Postgres queries
4. Remove `restore_auth_db_or_fail()` — no longer needed (DB is always available)
5. Remove `sync_auth_db_to_r2()` — no longer needed
6. Remove session cache (`_session_cache`) — Postgres handles concurrent reads efficiently; add back only if profiling shows need
7. Update `validate_session()` to query Postgres
8. Remove auth.sqlite from `SKIP_SYNC_PATHS` (no longer relevant)

### Data Migration
1. Write one-shot migration script: read auth.sqlite from R2, insert into Postgres
2. Run on staging first, verify all users/sessions present
3. Run on production during a maintenance window

### Query differences (SQLite → Postgres)
- `AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY` (or `SERIAL`)
- `datetime('now')` → `NOW()`
- String concatenation: `||` works in both
- `BOOLEAN` type works natively in Postgres (SQLite uses 0/1)
- Connection management: pool instead of file-open

## Codebase Audit

### auth_db.py Function Inventory (35 functions)

Every function needs migration or removal. Grouped by concern:

**Connection management (remove):**
- `_get_connection()` — SQLite connection with WAL/timeout
- `get_auth_db()` — context manager → replace with Postgres pool
- `init_auth_db()` — table creation + schema migrations → Postgres schema migration

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

**User operations (migrate queries):**
- `get_user_by_email(email)` — SELECT by email
- `get_user_by_google_id(google_id)` — SELECT by google sub ID
- `get_user_by_id(user_id)` — SELECT by user_id
- `create_user(user_id, email, google_id, verified_at)` — INSERT + R2 sync (remove sync)
- `link_google_to_user(user_id, email, google_id)` — UPDATE + R2 sync (remove sync)
- `link_email_to_user(user_id, email)` — UPDATE + R2 sync (remove sync)
- `update_picture_url(user_id, picture_url)` — UPDATE
- `update_last_seen(user_id)` — UPDATE (high frequency — every `/me` call)
- `generate_user_id()` — UUID generation (no DB, keep as-is)

**Session operations (migrate queries):**
- `create_session(user_id, ttl_days)` — INSERT + R2 persist (remove R2)
- `validate_session(session_id)` — cache → SQLite → R2 restore → replace with pool query
- `invalidate_session(session_id)` — DELETE + cache clear + R2 delete (simplify)
- `invalidate_user_sessions(user_id)` — SELECT IDs + DELETE + cache clear + R2 delete (simplify)
- `cleanup_expired_sessions()` — SELECT IDs + DELETE + R2 delete (simplify to single DELETE)

**Admin operations (migrate queries):**
- `is_admin(user_id)` — JOIN users + admin_users
- `get_admin_emails()` — SELECT from admin_users
- `get_all_users_for_admin()` — SELECT all users with credit_summary

**Impersonation (migrate queries):**
- `create_impersonation_session(target, impersonator, ttl)` — INSERT
- `find_or_create_admin_restore_session(admin_user_id)` — SELECT or create_session
- `log_impersonation(admin, target, action, ip, ua)` — INSERT audit row

**Schema migration helpers (remove):**
- `_migrate_users_email_not_null(db)` — T1330 NOT NULL enforcement
- `_has_table(db, name)` — SQLite introspection

### Import Surface Area (14 files)

Every file that imports from auth_db.py needs updating:

**Application code (5 files):**

| File | Functions imported | Notes |
|------|-------------------|-------|
| `app/main.py:291` | `restore_auth_db_or_fail` | Remove — Postgres pool init replaces this |
| `app/routers/auth.py:42-55` | 12 functions: `get_user_by_email`, `create_user`, `create_session`, `validate_session`, `invalidate_session`, `invalidate_user_sessions`, `generate_user_id`, `get_user_by_id`, `update_last_seen`, `update_picture_url`, `sync_auth_db_to_r2`, `get_auth_db` | Largest consumer. `sync_auth_db_to_r2` and `get_auth_db` calls disappear |
| `app/routers/auth.py:101` | `AUTH_DB_PATH` | `_reset_test_account()` directly opens auth.sqlite with `sqlite3.connect()` — must migrate to use auth_db functions or Postgres |
| `app/routers/auth.py:552` | `get_admin_emails` | Simple import swap |
| `app/services/user_db.py:547` | `get_auth_db` | `_update_credit_summary()` writes `credit_summary` column in auth.sqlite's users table — cross-DB write that must become a Postgres query |

**Test files (7 files):**

| File | Functions imported | Notes |
|------|-------------------|-------|
| `tests/test_auth_db_schema.py` | `auth_db` module | T1330 schema tests — remove or adapt |
| `tests/test_auth_db_restore.py` | `auth_db` module | T1290 restore tests — remove entirely |
| `tests/test_auth_session_r2.py` | `auth_db` module | T1195 session R2 tests — remove entirely |
| `tests/test_admin.py:32` | `init_auth_db`, `create_user`, `is_admin` | Needs Postgres fixture |
| `tests/test_credits.py:35` | `init_auth_db`, `create_user` | Needs Postgres fixture |
| `tests/test_credit_reservations.py:35` | `init_auth_db`, `create_user` | Needs Postgres fixture |
| `tests/test_double_grant.py:33` | `init_auth_db`, `create_user` | Needs Postgres fixture |
| `tests/test_impersonation.py:31,53,178,217,266` | `init_auth_db`, `create_user`, `get_auth_db`, `_session_cache`, `validate_session`, `create_session` | Heaviest test consumer — accesses `_session_cache` directly |
| `tests/test_user_db.py:40` | `init_auth_db`, `create_user` | Needs Postgres fixture |

**Scripts with direct sqlite3 access (5 files):**

| Script | What it does | Migration needed |
|--------|-------------|-----------------|
| `src/backend/scripts/reset_account.py:34` | Imports `AUTH_DB_PATH`, `sync_auth_db_to_r2`; opens `sqlite3.connect(AUTH_DB_PATH)` | Rewrite to use auth_db functions or Postgres |
| `src/backend/scripts/reset_all_accounts.py:34` | Same pattern — clears users, sessions, credit_transactions | Same |
| `scripts/delete_user.py` | Direct `sqlite3.connect("user_data/auth.sqlite")` | Same |
| `scripts/reset_all_accounts.py` | Direct `sqlite3.connect("user_data/auth.sqlite")` | Same |
| `scripts/reset-test-user.py` | R2 download of auth.sqlite → local edits → re-upload | Complete rewrite — connect to Postgres directly |

### Cross-DB Write: credit_summary

`user_db.py:544-555` writes the `credit_summary` column in auth.sqlite's
`users` table. This is a cross-database write: user_db.py (per-user SQLite)
reaches into auth.sqlite (shared). After migration this becomes a
cross-system write: Python → Postgres.

The function `_update_credit_summary()` is best-effort (wrapped in try/except).
It runs on every `grant_credits()`, `refund_credits()`, and `set_credits()` call.

**Migration options:**
- **Keep as cross-system write**: `_update_credit_summary()` calls Postgres
  instead of SQLite. Same pattern, different backend. Simple.
- **Move credit_summary to user.sqlite**: Admin panel reads it via a separate
  query. Eliminates the cross-system write but complicates the admin panel
  (must aggregate across all user DBs).

Recommendation: keep as cross-system write. It's already best-effort, and
Postgres handles concurrent updates better than SQLite did.

### _reset_test_account() Direct SQLite Access

`auth.py:101-108` bypasses auth_db.py entirely:

```python
from app.services.auth_db import AUTH_DB_PATH
conn = sqlite3.connect(str(AUTH_DB_PATH))
for table, col in [("sessions", "user_id"), ("users", "user_id")]:
    conn.execute(f"DELETE FROM {table} WHERE {col} = ?", (user_id,))
conn.commit()
conn.close()
sync_auth_db_to_r2()
```

This must be rewritten to use `invalidate_user_sessions(user_id)` + a new
`delete_user(user_id)` function in auth_db.py, or direct Postgres queries.

### OTP Cleanup Gap

No scheduled cleanup exists for expired OTP codes. They accumulate forever.
Postgres makes this easy:
- Add a periodic task: `DELETE FROM otp_codes WHERE expires_at < NOW()`
- Or use Postgres `pg_cron` extension for automatic cleanup
- The `cleanup_expired_sessions()` pattern could be extended to cover OTPs

### Session Cache Removal Considerations

The task says to remove `_session_cache` and add back if needed. Current state:
- Cache avoids SQLite (disk I/O) on every request
- Postgres connection pool + indexed query should be fast enough (~1-2ms)
- `validate_session()` is called on **every authenticated request** (via
  db_sync.py middleware, line 361-366)
- At 200 concurrent users (soft_limit), that's 200 Postgres queries/sec just
  for session validation

Recommendation: start without cache, add back if p99 latency increases.
Postgres with a connection pool and an index on `sessions.session_id` (PK)
should handle this easily.

### Code to Remove After Migration

T1960 eliminates these entire subsystems:

| Subsystem | Files/functions | Why |
|-----------|----------------|-----|
| R2 auth backup/restore | `sync_auth_db_from_r2`, `sync_auth_db_to_r2`, `restore_auth_db_or_fail` | Postgres is always available |
| T1195 session R2 persistence | `persist_session_to_r2`, `restore_session_from_r2`, `delete_session_from_r2`, `_get_session_r2_key` | Sessions live in Postgres |
| T1290 restore-must-succeed | `restore_auth_db_or_fail` retry loop | No restore needed |
| Session cache | `_session_cache`, `_session_cache_lock` | Evaluate after migration |
| Schema migration helpers | `_migrate_users_email_not_null`, `_has_table` | Postgres schema managed via migration files |
| Test files | `test_auth_db_restore.py`, `test_auth_session_r2.py`, `test_auth_db_schema.py` | Test the old SQLite system |

## Context

### Relevant Files
- `src/backend/app/services/auth_db.py` — all auth DB logic to migrate (35 functions, ~900 lines)
- `src/backend/app/services/user_db.py:544-555` — `_update_credit_summary()` cross-DB write
- `src/backend/app/middleware/db_sync.py` — session validation (L361-366), SKIP_SYNC_PATHS
- `src/backend/app/main.py:291` — startup restore logic to remove
- `src/backend/app/routers/auth.py` — login handlers, `_reset_test_account` direct SQLite access (L101-108)
- `src/backend/scripts/reset_account.py` — direct AUTH_DB_PATH access
- `src/backend/scripts/reset_all_accounts.py` — direct AUTH_DB_PATH access
- `scripts/delete_user.py` — direct sqlite3.connect to auth.sqlite
- `scripts/reset_all_accounts.py` — direct sqlite3.connect to auth.sqlite
- `scripts/reset-test-user.py` — R2 download, local edit, re-upload pattern

### Related Tasks
- T1195 (Session Durability on Deploy) — interim fix; T1960 makes it unnecessary. Remove: `persist_session_to_r2`, `restore_session_from_r2`, `delete_session_from_r2`, and `test_auth_session_r2.py`
- T1190 (Session & Machine Pinning) — machine pinning becomes simpler when auth doesn't need local disk. `validate_session()` no longer needs R2 fallback.
- T1290 (Auth DB Restore Must Succeed) — entire restore mechanism becomes unnecessary. Remove: `restore_auth_db_or_fail`, `sync_auth_db_from_r2`, and `test_auth_db_restore.py`

### Risks
- **Migration downtime**: Need a brief maintenance window to migrate data and switch over
- **New dependency**: Fly Postgres adds a managed service to monitor. Fly handles backups/failover but it's another thing that can go down.
- **Cost**: Fly Postgres starts free (shared CPU), scales to ~$15/mo for dedicated. Cheap for what it provides.
- **5 scripts bypass auth_db.py**: Direct sqlite3.connect calls in scripts must all be migrated. Missing one leaves a broken code path.
- **Test fixture overhaul**: 7 test files use `init_auth_db` + `create_user` with temp SQLite paths. All need Postgres-aware fixtures (either real test DB or mocked interface).

## Implementation

### Steps
1. [ ] Provision Fly Postgres on staging
2. [ ] Create Postgres schema (equivalent to auth.sqlite tables)
3. [ ] Add asyncpg/psycopg dependency + connection pool setup in `main.py` (replaces `restore_auth_db_or_fail` at L291)
4. [ ] Migrate user operations (6 functions) to Postgres
5. [ ] Migrate session operations (5 functions) to Postgres — remove R2 persist/restore/delete
6. [ ] Migrate admin + impersonation operations (6 functions) to Postgres
7. [ ] Migrate `_update_credit_summary` in user_db.py to write to Postgres
8. [ ] Rewrite `_reset_test_account` in auth.py to use auth_db functions (not direct sqlite3)
9. [ ] Remove R2 sync subsystem: `sync_auth_db_from_r2`, `sync_auth_db_to_r2`, `restore_auth_db_or_fail`
10. [ ] Remove T1195 session R2 subsystem: 4 functions + `test_auth_session_r2.py`
11. [ ] Remove session cache (evaluate re-adding after load testing)
12. [ ] Add OTP cleanup: `DELETE FROM otp_codes WHERE expires_at < NOW()` periodic task
13. [ ] Migrate 5 scripts (reset_account, reset_all_accounts, delete_user, reset-test-user, migrate-schema) from direct sqlite3 to Postgres
14. [ ] Create Postgres test fixture, update 7 test files
15. [ ] Remove obsolete test files: `test_auth_db_restore.py`, `test_auth_session_r2.py`, `test_auth_db_schema.py`
16. [ ] Write data migration script (auth.sqlite from R2 → Postgres)
17. [ ] Run migration on staging, verify all auth flows
18. [ ] Run migration on production

## Acceptance Criteria

- [ ] All auth queries use Fly Postgres instead of local SQLite
- [ ] Sessions survive machine restarts without any R2 workarounds
- [ ] Concurrent logins don't contend on a single file
- [ ] auth.sqlite restore/sync code is removed
- [ ] T1195 session R2 persistence code is removed
- [ ] All 5 scripts migrated from direct sqlite3 to Postgres
- [ ] All 7 test files updated with Postgres fixtures
- [ ] OTP codes have scheduled cleanup
- [ ] `_update_credit_summary` writes to Postgres
- [ ] `_reset_test_account` uses auth_db functions, not direct sqlite3
- [ ] Data migration script successfully moves all existing users/sessions
- [ ] Staging fully tested before production migration
