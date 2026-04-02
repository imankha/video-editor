# T920: User-Level Database (user.sqlite)

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-04-02
**Depends On:** —
**Blocks:** T880, T890, T820, T910

## Problem

All credit operations currently live in a shared `auth.sqlite` used by every user. This creates:

1. **Lock contention** — every credit deduction/grant/refund locks the entire file for all users
2. **Cross-DB atomicity gap** — credits (auth.sqlite) and export_jobs (per-profile DB) can't share a transaction, making it impossible to atomically deduct credits and create an export job
3. **Guest migration credit loss** — merging guest data (per-profile DB) can't include credit transfer (auth.sqlite) in the same transaction
4. **Quest double-grant** — check-then-act race across separate connections to shared DB

## Solution

Create a per-user `user.sqlite` at `user_data/{user_id}/user.sqlite` for all user-scoped financial and recovery data.

### Schema: user.sqlite

```sql
-- Credit balance
CREATE TABLE credits (
    user_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0
);

-- Audit ledger (moved from auth.sqlite)
CREATE TABLE credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    source TEXT NOT NULL,
    reference_id TEXT,
    video_seconds REAL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_credit_tx_idempotent
ON credit_transactions(user_id, source, reference_id)
WHERE reference_id IS NOT NULL;

-- Pending export deductions (reservation pattern for T890)
CREATE TABLE credit_reservations (
    job_id TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    video_seconds REAL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Stripe billing
CREATE TABLE user_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- Keys: 'stripe_customer_id'

-- Migration recovery (for T820)
CREATE TABLE pending_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    attempts INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
);
```

Note: The UNIQUE index on `credit_transactions(user_id, source, reference_id)` is the atomic idempotency guard that fixes T880 (quest double-grant) and Stripe double-grant.

### Schema changes: auth.sqlite

Remove from `users` table:
- `credits` column (moved to user.sqlite `credits` table)
- `stripe_customer_id` column (moved to user.sqlite `user_meta`)

Add to `users` table:
- `credit_summary INTEGER DEFAULT 0` — eventually-consistent copy for admin panel aggregation, updated async after each credit operation

Remove table:
- `credit_transactions` (moved to user.sqlite)

### R2 Sync

user.sqlite syncs to R2 at `{env}/users/{user_id}/user.sqlite`, using the same version-based sync mechanism as database.sqlite. The middleware already runs per-request with user_id context — extend write tracking to cover user.sqlite connections.

### Connection Management

```python
# New function in database.py (or user_db.py)
@contextmanager
def get_user_db_connection(user_id: str = None) -> TrackedConnection:
    """Get connection to user-level database (credits, billing, migrations)."""
    if user_id is None:
        user_id = get_current_user_id()
    db_path = USER_DATA_BASE / user_id / "user.sqlite"
    ensure_user_database(user_id, db_path)
    raw_conn = sqlite3.connect(str(db_path), timeout=30)
    raw_conn.execute("PRAGMA journal_mode=WAL")
    raw_conn.execute("PRAGMA busy_timeout=30000")
    raw_conn.execute("PRAGMA foreign_keys=ON")
    conn = TrackedConnection(raw_conn)
    try:
        yield conn
    finally:
        conn.close()
```

### Migration Strategy

This is a data migration from auth.sqlite → user.sqlite. Since we're pre-production:

1. **Add user.sqlite infrastructure** (schema, connection, sync)
2. **Write migration function** — for each user in auth.sqlite:
   - Read `credits`, `stripe_customer_id` from users table
   - Read all `credit_transactions` for that user
   - Write to user.sqlite
   - Update auth.sqlite `credit_summary` column
3. **Update all callers** — replace `get_auth_db()` calls for credit/stripe operations with `get_user_db_connection()`
4. **Remove old columns/table** from auth.sqlite
5. **Update admin panel** — read `credit_summary` from auth.sqlite, or scan user.sqlite files

### Files to Modify

| File | Changes |
|------|---------|
| `app/services/auth_db.py` | Remove credit functions, remove credit_transactions table, remove credits/stripe_customer_id columns, add credit_summary |
| `app/services/user_db.py` (NEW) | user.sqlite schema, connection, credit CRUD, reservation CRUD, migration CRUD |
| `app/database.py` | Add `ensure_user_database()`, extend write tracking |
| `app/middleware/db_sync.py` | Track user.sqlite writes, sync to R2 after request |
| `app/routers/credits.py` | Import from user_db instead of auth_db |
| `app/routers/quests.py` | Import from user_db instead of auth_db |
| `app/routers/payments.py` | Import from user_db instead of auth_db |
| `app/routers/exports.py` | Import from user_db instead of auth_db |
| `app/routers/export/framing.py` | Import from user_db |
| `app/routers/export/multi_clip.py` | Import from user_db |
| `app/services/export_worker.py` | Import refund_credits from user_db |
| `app/routers/admin.py` | Read credit_summary from auth.sqlite, or scan user DBs |
| `app/storage.py` | Add user.sqlite R2 sync functions |
| `app/session_init.py` | Initialize user.sqlite on first access |

### Admin Panel Aggregation

Two options:

**Option A: Denormalized credit_summary (recommended)**
- auth.sqlite `users.credit_summary` updated after every grant/deduct/refund
- Admin panel reads from auth.sqlite as before (fast, O(1))
- Slightly stale (updated async after user.sqlite commit)
- If credit_summary drifts, admin can trigger a reconciliation

**Option B: Scan user.sqlite files**
- Admin endpoint iterates all `user_data/*/user.sqlite`
- Accurate but O(n) users, slow with many users
- Acceptable for admin-only, but less elegant

## Acceptance Criteria

- [ ] user.sqlite created at `user_data/{user_id}/user.sqlite` with correct schema
- [ ] Credit balance, transactions, stripe_customer_id moved from auth.sqlite
- [ ] UNIQUE index on credit_transactions for idempotency
- [ ] credit_reservations table created (used by T890)
- [ ] pending_migrations table created (used by T820)
- [ ] All credit callers updated (credits.py, quests.py, payments.py, exports.py, export_worker.py)
- [ ] user.sqlite synced to R2 with version tracking
- [ ] Middleware tracks user.sqlite writes for sync
- [ ] Admin panel still shows credit stats
- [ ] auth.sqlite `credits` column and `credit_transactions` table removed
- [ ] Data migration function moves existing data
- [ ] All existing tests pass
