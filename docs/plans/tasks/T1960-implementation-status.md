# T1960: Migrate Global SQLite to Fly Postgres — Implementation Status

**Last updated:** 2026-05-11
**Branch:** feature/T1960-migrate-global-sqlite-to-postgres (not yet created — all work on master)

## Completed Phases

### Phase 1: pg.py (NEW) ✅
- `src/backend/app/services/pg.py` — Central connection pool + DDL
- ThreadedConnectionPool (min=2, max=10), RealDictCursor
- `get_pg()` context manager: auto-commit on clean exit, rollback on error
- `_SCHEMA_DDL`: 8 tables + indexes (users, sessions, otp_codes, admin_users, impersonation_audit, game_storage_refs, r2_grace_deletions, shared_videos)
- `_SEED_SQL`: Seeds admin_users with imankh@gmail.com
- `init_pg_pool()`, `close_pg_pool()`, `init_pg_schema()`

### Phase 2: auth_db.py (COMPLETE REWRITE) ✅
- Removed: 13 functions (R2 sync, session cache, init_auth_db, AUTH_DB_PATH, _r2_enabled, _session_cache, _session_cache_lock, sync_auth_db_to_r2, persist_session_to_r2, delete_session_from_r2, restore_auth_db_or_fail, _migrate_users_email_not_null)
- Migrated: 22 business functions to Postgres
- `get_auth_db()` = alias calling `get_pg()`
- All `?` → `%s`, `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`
- All datetime.utcnow() → datetime.now(timezone.utc)
- validate_session: no cache, no R2 restore fallback, uses `AND expires_at > now()`

### Phase 3: sharing_db.py (COMPLETE REWRITE) ✅
- Removed: R2 sync, SQLite connection management, init_sharing_db, SHARING_DB_PATH
- `get_sharing_db()` = alias calling `get_pg()`
- 6 CRUD functions migrated
- `is_public` now BOOLEAN (not INTEGER 0/1)

### Phase 4: Update callers ✅
- `main.py`: startup → `init_pg_pool()` + `init_pg_schema()` + `start_cleanup_loop()`; shutdown → `stop_cleanup_loop()` + `close_pg_pool()`
- `auth.py`: Removed sync_auth_db_to_r2 imports, added `from datetime import timezone`, updated 5 OTP queries (? → %s), rewrote `_reset_test_account`
- `privacy.py`: Uses `get_pg()` for user deletion
- `user_db.py`: `_update_credit_summary` updated to %s syntax + cursor pattern
- `sweep_scheduler.py`: `datetime.utcnow()` → `datetime.now(timezone.utc)`
- `requirements.txt`: Added `psycopg2-binary==2.9.10`

### Phase 4.5: cleanup.py (NEW) ✅
- Hourly asyncio background task for expired sessions + OTP codes
- `start_cleanup_loop()` / `stop_cleanup_loop()` called from main.py

### Phase 5: Migrate 5 scripts ✅
1. ✅ `src/backend/scripts/reset_account.py` — psycopg2, simplified from 5 steps to 3
2. ✅ `src/backend/scripts/reset_all_accounts.py` — psycopg2, simplified
3. ✅ `scripts/delete_user.py` — psycopg2 direct, kept R2 purge + Fly restart
4. ✅ `scripts/reset_all_accounts.py` — psycopg2, discovers from Postgres + R2, clears Postgres
5. ✅ `scripts/reset-test-user.py` — psycopg2, no auth.sqlite download/upload cycle

### Phase 6: Test fixtures + test files 🔄 IN PROGRESS

#### Completed:
- ✅ `tests/conftest.py` — Added `pg_conn` fixture (see details below)

#### Remaining test file updates:

**DELETE these 3 files** (test obsolete SQLite behaviors):
- `tests/test_auth_db_restore.py` — Tests R2 restore for auth.sqlite (no longer exists)
- `tests/test_auth_session_r2.py` — Tests session persistence to R2 (no longer exists)
- `tests/test_auth_db_schema.py` — Tests SQLite schema migration/enforcement (Postgres DDL handles this)

**UPDATE these 10 files** (see detailed plans below):
1. `tests/test_auth_db_storage_refs.py` — Heavy rewrite
2. `tests/test_admin.py` — Moderate rewrite
3. `tests/test_impersonation.py` — Heavy rewrite
4. `tests/test_shares.py` — Moderate rewrite
5. `tests/test_session_pinning.py` — Moderate rewrite
6. `tests/test_credits.py` — Light rewrite (fixture only)
7. `tests/test_double_grant.py` — Light rewrite (fixture only)
8. `tests/test_credit_reservations.py` — Light rewrite (fixture only)
9. `tests/test_user_db.py` — Light rewrite (fixture + credit_summary tests)
10. `tests/test_vacuum_on_signout.py` — NO CHANGES (tests per-user profile.sqlite, not auth)

**NO CHANGES needed:**
- `test_auth_cookie_config.py` — AST-only, no DB access
- `test_auth_no_guest.py` — AST-only, no DB access
- `test_stream_auth.py` — Auth middleware test, no auth.sqlite
- `test_vacuum_on_signout.py` — Profile.sqlite operations only

### Phase 7: Data migration script ❌ NOT STARTED
### Import check + tests ❌ NOT STARTED
### Review ❌ NOT STARTED
### Commit + PLAN.md ❌ NOT STARTED

---

## pg_conn Fixture Design (conftest.py)

```python
@pytest.fixture
def pg_conn(monkeypatch):
    # Loads .env for DATABASE_URL
    # Connects to Postgres, ensures schema via _SCHEMA_DDL
    # TRUNCATES all 8 tables CASCADE
    # Re-seeds admin_users
    # Patches get_pg() at 3 locations:
    #   - app.services.pg.get_pg
    #   - app.services.auth_db.get_pg
    #   - app.services.sharing_db.get_pg
    # Mock creates a fresh connection per call (no pool needed in tests)
    # Auto-commits on clean context exit, rolls back on error
    yield dsn
```

## Test File Update Patterns

### Pattern 1: Files with `isolated_auth_db` fixture (direct DB assertions)

**Files:** test_admin.py, test_impersonation.py

**Old pattern:**
```python
@pytest.fixture()
def isolated_auth_db(tmp_path):
    db_path = tmp_path / "auth.sqlite"
    with patch("app.services.auth_db.AUTH_DB_PATH", db_path), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True):
        from app.services.auth_db import init_auth_db, create_user
        init_auth_db()
        create_user("admin-user", email="imankh@gmail.com")
        yield db_path
```

**New pattern:**
```python
@pytest.fixture()
def isolated_auth_db(pg_conn):
    from app.services.auth_db import create_user
    create_user("admin-user", email="imankh@gmail.com")
    yield
```

**SQL query changes in assertions:**
```python
# OLD: direct sqlite3
conn = sqlite3.connect(str(isolated_auth_db))
row = conn.execute("SELECT count(*) FROM admin_users").fetchone()
conn.close()
assert row[0] >= 1

# NEW: via get_auth_db
from app.services.auth_db import get_auth_db
with get_auth_db() as conn:
    cur = conn.cursor()
    cur.execute("SELECT count(*) as cnt FROM admin_users")
    row = cur.fetchone()
assert row["cnt"] >= 1
```

**Other changes:**
- `sqlite3.connect(str(db_path))` → `with get_auth_db() as conn: cur = conn.cursor()`
- `conn.execute("... WHERE x = ?", (val,))` → `cur.execute("... WHERE x = %s", (val,))`
- `conn.row_factory = sqlite3.Row` → not needed (RealDictCursor)
- `conn.commit()` → not needed (auto-commit by get_pg)
- `conn.close()` → not needed (auto-close by get_pg)
- `row[0]` (positional) → `row["col_name"]` (dict) — must alias COUNT as named column
- `_session_cache.clear()` → remove entirely (no cache in Postgres version)
- `_session_cache.pop(sid, None)` → remove entirely
- `_session_cache_lock` → remove entirely
- `datetime.utcnow()` → `datetime.now(timezone.utc)` (tz-aware for Postgres TIMESTAMPTZ)
- `datetime.fromisoformat(row['col'])` → `row['col']` directly (psycopg2 returns datetime objects)
- `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`
- `sqlite_master` queries → remove or use `information_schema` (but schema tests deleted)
- `PRAGMA table_info(...)` → not needed

### Pattern 2: Files with `isolated_auth_db` + `client` fixture (API tests)

**Files:** test_admin.py, test_shares.py, test_session_pinning.py, test_impersonation.py

**Old client pattern:**
```python
@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
         patch("app.services.sharing_db.SHARING_DB_PATH", isolated_sharing_db), \
         patch("app.services.sharing_db.sync_sharing_db_to_r2", return_value=True), \
         patch("app.database.USER_DATA_BASE", tmp_path):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)
```

**New client pattern:**
```python
@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)
```

Note: No patches needed for AUTH_DB_PATH, sync_auth_db_to_r2, SHARING_DB_PATH, sync_sharing_db_to_r2 — all replaced by pg_conn's monkeypatch of get_pg.

### Pattern 3: Files with `isolated_user_db` fixture (credit/user_db tests)

**Files:** test_credits.py, test_double_grant.py, test_credit_reservations.py, test_user_db.py

**Old pattern:**
```python
@pytest.fixture(autouse=True)
def isolated_user_db(tmp_path):
    auth_db_path = tmp_path / "auth.sqlite"
    user_data_base = tmp_path / "user_data"
    user_data_base.mkdir()
    with patch("app.services.auth_db.AUTH_DB_PATH", auth_db_path), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
         patch("app.services.user_db.USER_DATA_BASE", user_data_base), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.services.user_db._update_credit_summary"):
        from app.services.auth_db import init_auth_db, create_user
        init_auth_db()
        create_user("test-user-1", email="test@example.com")
        yield tmp_path
```

**New pattern:**
```python
@pytest.fixture(autouse=True)
def isolated_user_db(pg_conn, tmp_path, monkeypatch):
    user_data_base = tmp_path / "user_data"
    user_data_base.mkdir()
    monkeypatch.setattr("app.services.user_db.USER_DATA_BASE", user_data_base)
    monkeypatch.setattr("app.services.user_db._initialized_user_dbs", set())
    from app.services.auth_db import create_user
    create_user("test-user-1", email="test@example.com")
    yield tmp_path
```

**Key:** _update_credit_summary no longer needs mocking — it uses get_pg() which is patched. But `test_user_db.py` specifically tests that _update_credit_summary is called (TestCreditSummarySync class) — keep mocking there and verify mock was called.

**sqlite3.IntegrityError stays unchanged** for credit tests — credit_transactions is in per-user SQLite, not Postgres.

### Pattern 4: test_auth_db_storage_refs.py (heavy rewrite)

**Changes needed:**
1. Fixture: use pg_conn, create users "user-1" and "user-2" (FK constraint)
2. `_insert_ref` helper: `?` → `%s`, `db.execute()` → `cur = conn.cursor(); cur.execute()`, remove `db.commit()`
3. All inline SQL queries: same cursor pattern
4. `datetime.utcnow()` → `datetime.now(timezone.utc)`
5. `datetime.fromisoformat(row['grace_expires_at'])` → `row['grace_expires_at']` (Postgres returns datetime)
6. Remove `sys.modules["cv2"]` hack if possible (check if still needed)

### Pattern 5: test_shares.py

**Changes needed:**
1. Remove isolated_auth_db and isolated_sharing_db fixtures
2. New fixture uses pg_conn + create_user
3. Client fixture simplified (no auth/sharing DB patches)
4. `share["is_public"] == 0` → `share["is_public"] is False`
5. `share["is_public"] == 1` → `share["is_public"] is True`

### Pattern 6: test_impersonation.py

**Changes needed:**
1. Fixture: pg_conn + create users + promote second admin via get_auth_db()
2. SQL for promoting admin: `INSERT OR IGNORE INTO admin_users (email) VALUES (?)` → `INSERT INTO admin_users (email) VALUES (%s) ON CONFLICT DO NOTHING`
3. All sqlite3.connect verification queries → get_auth_db() cursor pattern
4. Remove _session_cache.clear() calls
5. `datetime.utcnow()` → `datetime.now(timezone.utc)` in TTL test
6. Direct UPDATE for impersonation_expires_at: `?` → `%s`, cursor pattern

### Pattern 7: test_session_pinning.py

**Changes needed:**
1. Remove patches for persist_session_to_r2, delete_session_from_r2
2. Remove _session_cache, _session_cache_lock references
3. Fixture uses pg_conn
4. Test TestSingleSession: remove cache clearing
5. TestSyncLockTimeout tests: NO CHANGES (they test per-user profile.sqlite sync)

---

## Key Gotchas Discovered

1. **FK constraints in Postgres**: game_storage_refs.user_id REFERENCES users(user_id). Tests that insert refs with fake user_ids need to create the users first. SQLite didn't enforce this.

2. **TIMESTAMPTZ returns tz-aware datetimes**: psycopg2 returns `datetime(tzinfo=UTC)` from TIMESTAMPTZ columns. Comparing with `datetime.utcnow()` (tz-naive) raises TypeError. Must use `datetime.now(timezone.utc)`.

3. **psycopg2 connections don't have `.execute()` directly**: Must use `cur = conn.cursor(); cur.execute(...)`. Unlike sqlite3.Connection which has `.execute()` convenience method.

4. **RealDictCursor returns dict rows**: `row["col_name"]` works. `row[0]` does NOT. Must alias aggregates: `SELECT COUNT(*) as cnt` (not just `SELECT COUNT(*)`).

5. **Boolean vs Integer**: Postgres BOOLEAN returns Python `True`/`False`. Old SQLite stored 0/1 as INTEGER. Assertions like `== 0` or `== 1` must change to `is False` or `is True`.

6. **No explicit .commit()**: The `get_pg()` context manager auto-commits. Tests that called `db.commit()` after inserts need that removed.

7. **import sqlite3 still needed**: Some test files still need `import sqlite3` for per-user profile.sqlite operations (test_user_db.py, test_vacuum_on_signout.py). Don't remove it blindly.
