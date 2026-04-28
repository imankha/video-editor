# T1960: Migrate Auth to Fly Postgres

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-04-27
**Updated:** 2026-04-27

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

## Context

### Relevant Files
- `src/backend/app/services/auth_db.py` — all auth DB logic to migrate
- `src/backend/app/middleware/db_sync.py` — session validation, SKIP_SYNC_PATHS
- `src/backend/app/main.py` — startup restore logic to remove
- `src/backend/app/routers/auth.py` — login handlers

### Related Tasks
- T1195 (Session Durability on Deploy) — interim fix; T1960 makes it unnecessary
- T1190 (Session & Machine Pinning) — machine pinning becomes simpler when auth doesn't need local disk
- T1290 (Auth DB Restore Must Succeed) — entire restore mechanism becomes unnecessary

### Risks
- **Migration downtime**: Need a brief maintenance window to migrate data and switch over
- **New dependency**: Fly Postgres adds a managed service to monitor. Fly handles backups/failover but it's another thing that can go down.
- **Cost**: Fly Postgres starts free (shared CPU), scales to ~$15/mo for dedicated. Cheap for what it provides.

## Implementation

### Steps
1. [ ] Provision Fly Postgres on staging
2. [ ] Create Postgres schema (equivalent to auth.sqlite tables)
3. [ ] Add asyncpg/psycopg dependency + connection pool setup
4. [ ] Migrate `create_user()` to Postgres
5. [ ] Migrate `create_session()` / `validate_session()` to Postgres
6. [ ] Migrate `cleanup_expired_sessions()` to Postgres
7. [ ] Migrate admin/impersonation queries to Postgres
8. [ ] Remove auth.sqlite restore/sync logic
9. [ ] Write data migration script (auth.sqlite → Postgres)
10. [ ] Run migration on staging, verify all auth flows
11. [ ] Run migration on production
12. [ ] Remove T1195 R2 session objects (no longer needed)

## Acceptance Criteria

- [ ] All auth queries use Fly Postgres instead of local SQLite
- [ ] Sessions survive machine restarts without any R2 workarounds
- [ ] Concurrent logins don't contend on a single file
- [ ] auth.sqlite restore/sync code is removed
- [ ] Data migration script successfully moves all existing users/sessions
- [ ] Staging fully tested before production migration
