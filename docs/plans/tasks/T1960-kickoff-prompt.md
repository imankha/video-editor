# T1960 Continuation Kickoff Prompt

Paste everything below the `---` line into a fresh Claude Code session to continue.

---

```
Continue implementing T1960: Migrate Global SQLite to Fly Postgres.

## Critical: Read the status doc FIRST

Read: docs/plans/tasks/T1960-implementation-status.md

This contains the COMPLETE implementation status, all patterns for updating test files, gotchas discovered, and the exact changes needed for each remaining file. Do NOT re-derive this — the doc is the source of truth.

## Current State

Phases 1-5 are COMPLETE (all production code written, not yet committed). Changes are unstaged on master.

Phase 6 (test updates) is IN PROGRESS:
- ✅ conftest.py `pg_conn` fixture added
- Remaining: delete 3 test files, update 10 test files

Phase 7 (data migration script) NOT STARTED.

## What to do now

### Step 1: Delete 3 obsolete test files

Delete these (they test SQLite-specific R2 sync/restore/schema behaviors that no longer exist):
- src/backend/tests/test_auth_db_restore.py
- src/backend/tests/test_auth_session_r2.py
- src/backend/tests/test_auth_db_schema.py

### Step 2: Update 10 test files

The status doc has 7 detailed patterns. Summary of each file:

**Heavy rewrites:**
- test_auth_db_storage_refs.py — pg_conn fixture, create FK users, cursor pattern, %s syntax, tz-aware datetimes, Postgres returns datetime objects not strings
- test_impersonation.py — pg_conn, cursor queries for assertions, remove _session_cache refs, ON CONFLICT DO NOTHING for admin promotion
- test_admin.py — pg_conn, cursor for verification queries, simplified client fixture

**Moderate rewrites:**
- test_shares.py — pg_conn replaces auth+sharing fixtures, is_public bool change (0→False, 1→True)
- test_session_pinning.py — remove R2 session patches + cache refs, pg_conn

**Light rewrites (fixture only, test code unchanged):**
- test_credits.py — pg_conn + user_data patches, remove auth_db.AUTH_DB_PATH/sync/init patches
- test_double_grant.py — same pattern (sqlite3.IntegrityError STAYS — credit_transactions is per-user SQLite)
- test_credit_reservations.py — same pattern
- test_user_db.py — same, but KEEP _update_credit_summary mock for TestCreditSummarySync class

### Step 3: Import check + run tests
```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
cd src/backend && .venv/Scripts/python.exe run_tests.py 2>&1 > /tmp/test-output.log; echo "exit: $?"
```

### Step 4: Phase 7 — Data migration script

Write scripts/migrate_to_postgres.py:
1. Download auth.sqlite + sharing.sqlite from R2 for each env
2. Read rows from SQLite tables
3. INSERT into Postgres (ON CONFLICT DO NOTHING for idempotency)
4. Handle type conversions: datetime strings → TIMESTAMPTZ, credit_summary text → JSONB
5. Verify row counts

### Step 5: Review + Commit

- Run reviewer agent
- Create branch: git checkout -b feature/T1960-postgres-migration
- Commit all changes with co-author line
- Update PLAN.md status to TESTING

## Key technical reminders

- get_pg() auto-commits on clean exit; no explicit .commit() needed
- psycopg2 connections need cur = conn.cursor(); cur.execute() (no .execute() on conn)
- RealDictCursor: row["col"] access; must alias aggregates (SELECT COUNT(*) as cnt)
- Postgres FK constraints enforced: tests inserting game_storage_refs need users first
- TIMESTAMPTZ returns tz-aware datetimes: use datetime.now(timezone.utc) not utcnow()
- Postgres BOOLEAN returns Python True/False, not 0/1
- Per-user SQLite (profile.sqlite, user.sqlite) is UNCHANGED
- sqlite3.IntegrityError still correct for per-user credit_transactions

## Files already modified (not committed)

Production code (Phases 1-5):
- NEW: src/backend/app/services/pg.py
- NEW: src/backend/app/services/cleanup.py
- REWRITTEN: src/backend/app/services/auth_db.py
- REWRITTEN: src/backend/app/services/sharing_db.py
- MODIFIED: src/backend/app/main.py
- MODIFIED: src/backend/app/routers/auth.py
- MODIFIED: src/backend/app/routers/privacy.py
- MODIFIED: src/backend/app/services/user_db.py
- MODIFIED: src/backend/app/services/sweep_scheduler.py
- MODIFIED: src/backend/requirements.txt
- REWRITTEN: src/backend/scripts/reset_account.py
- REWRITTEN: src/backend/scripts/reset_all_accounts.py
- REWRITTEN: scripts/delete_user.py
- REWRITTEN: scripts/reset_all_accounts.py
- REWRITTEN: scripts/reset-test-user.py

Test code (Phase 6 partial):
- MODIFIED: src/backend/tests/conftest.py (pg_conn fixture added)

Design doc:
- docs/plans/tasks/T1960-design.md (APPROVED)
```
