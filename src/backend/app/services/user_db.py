"""
Per-user database — user.sqlite for credits, billing, and recovery data.

Unlike auth.sqlite (shared by all users) or profile databases (per-profile),
this is a per-user database stored at user_data/<user_id>/user.sqlite.
It stores:
  - credits: current credit balance
  - credit_transactions: full ledger of credit changes
  - credit_reservations: held credits for in-progress exports (T890)
  - stripe_customers: Stripe billing customer IDs
  - pending_migrations: guest→authenticated migration tracking (T820)

Sync strategy:
  - R2 sync via TrackedConnection write tracking (same as profile DB)
  - Version-based optimistic locking
  - Middleware syncs after request if user DB had writes
"""

import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# R2 restore cooldown — avoids hammering R2 on transient failures
_r2_user_restore_cooldowns: dict[str, float] = {}  # user_id -> last failure timestamp
USER_RESTORE_COOLDOWN_SECONDS = 30

USER_DATA_BASE = Path(__file__).parent.parent.parent.parent.parent / "user_data"

# Track initialized user DBs
_initialized_user_dbs: set = set()
_init_lock = threading.Lock()

_USER_DB_SCHEMA = """
    CREATE TABLE IF NOT EXISTS credits (
        user_id TEXT PRIMARY KEY,
        balance INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        source TEXT NOT NULL,
        reference_id TEXT,
        video_seconds REAL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_idempotent
    ON credit_transactions(user_id, source, reference_id)
    WHERE reference_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_credit_tx_user
    ON credit_transactions(user_id);

    CREATE TABLE IF NOT EXISTS credit_reservations (
        job_id TEXT PRIMARY KEY,
        amount INTEGER NOT NULL,
        video_seconds REAL,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stripe_customers (
        user_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        attempts INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS completed_quests (
        quest_id TEXT PRIMARY KEY,
        completed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
"""


def _get_user_db_path(user_id: str) -> Path:
    return USER_DATA_BASE / user_id / "user.sqlite"


def ensure_user_database(user_id: str) -> None:
    """Create user.sqlite with schema if it doesn't exist.

    On first access, attempts R2 restore with NOT_FOUND vs ERROR distinction:
    - NOT_FOUND: genuinely new user, lock version to 0
    - ERROR: transient failure, retry after cooldown
    """
    with _init_lock:
        if user_id in _initialized_user_dbs:
            return

    db_path = _get_user_db_path(user_id)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # R2 restore on first access (before schema creation so restored DB is used)
    from ..storage import R2_ENABLED, sync_user_db_from_r2_if_newer
    from ..database import get_local_user_db_version, set_local_user_db_version

    if R2_ENABLED:
        local_version = get_local_user_db_version(user_id)
        if local_version is None:
            # Check cooldown
            last_fail = _r2_user_restore_cooldowns.get(user_id)
            if last_fail and (time.time() - last_fail) < USER_RESTORE_COOLDOWN_SECONDS:
                logger.debug(f"[Restore] Skipping user.sqlite R2 check for {user_id} — cooldown active")
            else:
                logger.info(f"[Restore] First access for user.sqlite user={user_id}, checking R2...")
                restore_start = time.perf_counter()
                was_synced, new_version, was_error = sync_user_db_from_r2_if_newer(user_id, db_path, local_version)
                restore_elapsed = time.perf_counter() - restore_start
                if was_synced:
                    logger.info(
                        f"[Restore] Downloaded user.sqlite from R2 for user={user_id}: "
                        f"version={new_version}, took {restore_elapsed:.2f}s"
                    )
                    set_local_user_db_version(user_id, new_version)
                elif was_error:
                    _r2_user_restore_cooldowns[user_id] = time.time()
                    logger.warning(
                        f"[Restore] R2 unreachable for user.sqlite user={user_id}, "
                        f"will retry after {USER_RESTORE_COOLDOWN_SECONDS}s (took {restore_elapsed:.2f}s)"
                    )
                elif new_version is not None:
                    logger.info(
                        f"[Restore] user.sqlite up-to-date for user={user_id}: "
                        f"version={new_version}, took {restore_elapsed:.2f}s"
                    )
                    set_local_user_db_version(user_id, new_version)
                else:
                    # NOT_FOUND — genuinely new user
                    logger.info(
                        f"[Restore] No user.sqlite in R2 for user={user_id}, "
                        f"starting fresh (took {restore_elapsed:.2f}s)"
                    )
                    set_local_user_db_version(user_id, 0)

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")

    conn.executescript(_USER_DB_SCHEMA)
    conn.close()

    # Initialize credits row for new users
    _init_credits_row(user_id)

    with _init_lock:
        _initialized_user_dbs.add(user_id)


@contextmanager
def get_user_db_connection(user_id: str = None):
    """Get connection to user-level database."""
    if user_id is None:
        from ..user_context import get_current_user_id
        user_id = get_current_user_id()

    ensure_user_database(user_id)
    db_path = _get_user_db_path(user_id)

    from ..database import TrackedConnection, _request_context

    raw_conn = sqlite3.connect(str(db_path), timeout=30)
    raw_conn.row_factory = sqlite3.Row
    raw_conn.execute("PRAGMA journal_mode=WAL")
    raw_conn.execute("PRAGMA busy_timeout=30000")
    raw_conn.execute("PRAGMA foreign_keys=ON")
    conn = TrackedConnection(raw_conn, db_type='user')
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Credit operations (moved from auth_db.py)
# ---------------------------------------------------------------------------

def get_credit_balance(user_id: str) -> dict:
    """Get credit balance for a user."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT balance FROM credits WHERE user_id = ?",
            (user_id,)
        ).fetchone()
        if not row:
            return {"balance": 0}
        return {"balance": row["balance"]}


def grant_credits(user_id: str, amount: int, source: str, reference_id: Optional[str] = None) -> int:
    """Grant credits to a user. Returns new balance."""
    with get_user_db_connection(user_id) as conn:
        # Ensure credits row exists
        conn.execute(
            "INSERT OR IGNORE INTO credits (user_id, balance) VALUES (?, 0)",
            (user_id,)
        )
        conn.execute(
            "UPDATE credits SET balance = balance + ? WHERE user_id = ?",
            (amount, user_id),
        )
        conn.execute(
            """INSERT INTO credit_transactions (user_id, amount, source, reference_id)
               VALUES (?, ?, ?, ?)""",
            (user_id, amount, source, reference_id),
        )
        conn.commit()
        row = conn.execute("SELECT balance FROM credits WHERE user_id = ?", (user_id,)).fetchone()
        new_balance = row["balance"]

    _update_credit_summary(user_id, new_balance)
    logger.info(f"[UserDB] Granted {amount} credits to {user_id} (source={source}), balance={new_balance}")
    return new_balance


def deduct_credits(
    user_id: str,
    amount: int,
    source: str,
    reference_id: Optional[str] = None,
    video_seconds: Optional[float] = None,
) -> dict:
    """
    Deduct credits atomically. Returns {success, balance, required}.
    """
    with get_user_db_connection(user_id) as conn:
        row = conn.execute("SELECT balance FROM credits WHERE user_id = ?", (user_id,)).fetchone()
        if not row:
            return {"success": False, "balance": 0, "required": amount}
        current = row["balance"]
        if current < amount:
            return {"success": False, "balance": current, "required": amount}
        conn.execute(
            "UPDATE credits SET balance = balance - ? WHERE user_id = ?",
            (amount, user_id),
        )
        conn.execute(
            """INSERT INTO credit_transactions (user_id, amount, source, reference_id, video_seconds)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, -amount, source, reference_id, video_seconds),
        )
        conn.commit()
        new_balance = current - amount

    logger.info(f"[UserDB] Deducted {amount} credits from {user_id} (source={source}), balance={new_balance}")
    return {"success": True, "balance": new_balance, "required": amount}


def refund_credits(
    user_id: str,
    amount: int,
    reference_id: str,
    video_seconds: Optional[float] = None,
) -> int:
    """Refund credits for a failed export. Returns new balance."""
    with get_user_db_connection(user_id) as conn:
        # Ensure credits row exists
        conn.execute(
            "INSERT OR IGNORE INTO credits (user_id, balance) VALUES (?, 0)",
            (user_id,)
        )
        conn.execute(
            "UPDATE credits SET balance = balance + ? WHERE user_id = ?",
            (amount, user_id),
        )
        conn.execute(
            """INSERT INTO credit_transactions (user_id, amount, source, reference_id, video_seconds)
               VALUES (?, ?, 'framing_refund', ?, ?)""",
            (user_id, amount, reference_id, video_seconds),
        )
        conn.commit()
        row = conn.execute("SELECT balance FROM credits WHERE user_id = ?", (user_id,)).fetchone()
        new_balance = row["balance"]

    _update_credit_summary(user_id, new_balance)
    logger.info(f"[UserDB] Refunded {amount} credits to {user_id} (job={reference_id}), balance={new_balance}")
    return new_balance


def set_credits(user_id: str, amount: int) -> int:
    """Set a user's credit balance to an exact value. Records a transaction."""
    with get_user_db_connection(user_id) as conn:
        # Ensure credits row exists
        conn.execute(
            "INSERT OR IGNORE INTO credits (user_id, balance) VALUES (?, 0)",
            (user_id,)
        )
        row = conn.execute("SELECT balance FROM credits WHERE user_id = ?", (user_id,)).fetchone()
        old_balance = row["balance"] if row else 0
        delta = amount - old_balance
        conn.execute(
            "UPDATE credits SET balance = ? WHERE user_id = ?",
            (amount, user_id),
        )
        conn.execute(
            """INSERT INTO credit_transactions (user_id, amount, source, reference_id)
               VALUES (?, ?, 'admin_set', ?)""",
            (user_id, delta, f"set_to_{amount}"),
        )
        conn.commit()

    _update_credit_summary(user_id, amount)
    logger.info(f"[UserDB] Set credits for {user_id} to {amount} (was {old_balance})")
    return amount


def get_credit_transactions(user_id: str, limit: int = 50) -> list:
    """Get recent credit transactions for a user."""
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute(
            """SELECT id, amount, source, reference_id, video_seconds, created_at
               FROM credit_transactions
               WHERE user_id = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def has_processed_payment(user_id: str, reference_id: str) -> bool:
    """Check if a payment has already been processed (idempotency guard).

    NOTE: Signature changed from auth_db version — now requires user_id
    since credit_transactions are per-user DB.
    """
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT 1 FROM credit_transactions WHERE user_id = ? AND reference_id = ? AND source = 'stripe_purchase'",
            (user_id, reference_id),
        ).fetchone()
        return row is not None


# ---------------------------------------------------------------------------
# Stripe customer management
# ---------------------------------------------------------------------------

def get_stripe_customer_id(user_id: str) -> Optional[str]:
    """Get Stripe customer ID for a user."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT customer_id FROM stripe_customers WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return row["customer_id"] if row else None


def set_stripe_customer_id(user_id: str, stripe_customer_id: str):
    """Save Stripe customer ID for a user."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO stripe_customers (user_id, customer_id) VALUES (?, ?)",
            (user_id, stripe_customer_id),
        )
        conn.commit()
    logger.info(f"[UserDB] Set stripe_customer_id for {user_id}")


# ---------------------------------------------------------------------------
# Credit reservations (for T890)
# ---------------------------------------------------------------------------

def reserve_credits(user_id: str, amount: int, job_id: str, video_seconds: float = None) -> dict:
    """Atomic: INSERT credit_reservations + UPDATE credits -= amount."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute("SELECT balance FROM credits WHERE user_id = ?", (user_id,)).fetchone()
        if not row or row["balance"] < amount:
            return {"success": False, "balance": row["balance"] if row else 0, "required": amount}
        conn.execute(
            "UPDATE credits SET balance = balance - ? WHERE user_id = ?",
            (amount, user_id),
        )
        conn.execute(
            "INSERT INTO credit_reservations (job_id, amount, video_seconds) VALUES (?, ?, ?)",
            (job_id, amount, video_seconds),
        )
        conn.commit()
        new_row = conn.execute("SELECT balance FROM credits WHERE user_id = ?", (user_id,)).fetchone()
        return {"success": True, "balance": new_row["balance"], "required": amount}


def confirm_reservation(user_id: str, job_id: str) -> bool:
    """Atomic: DELETE reservation + INSERT credit_transaction."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT amount, video_seconds FROM credit_reservations WHERE job_id = ?",
            (job_id,),
        ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM credit_reservations WHERE job_id = ?", (job_id,))
        conn.execute(
            """INSERT INTO credit_transactions (user_id, amount, source, reference_id, video_seconds)
               VALUES (?, ?, 'framing_usage', ?, ?)""",
            (user_id, -row["amount"], job_id, row["video_seconds"]),
        )
        conn.commit()
        return True


def release_reservation(user_id: str, job_id: str) -> bool:
    """Atomic: DELETE reservation + UPDATE credits += amount."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT amount FROM credit_reservations WHERE job_id = ?",
            (job_id,),
        ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM credit_reservations WHERE job_id = ?", (job_id,))
        conn.execute(
            "UPDATE credits SET balance = balance + ? WHERE user_id = ?",
            (row["amount"], user_id),
        )
        conn.commit()
        return True


def recover_orphaned_reservations(user_id: str) -> int:
    """Startup: reservations older than 60s with no matching export_job -> release."""
    count = 0
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute(
            """SELECT job_id, amount FROM credit_reservations
               WHERE created_at < datetime('now', '-60 seconds')"""
        ).fetchall()
        for row in rows:
            conn.execute("DELETE FROM credit_reservations WHERE job_id = ?", (row["job_id"],))
            conn.execute(
                "UPDATE credits SET balance = balance + ? WHERE user_id = ?",
                (row["amount"], user_id),
            )
            count += 1
        if count > 0:
            conn.commit()
            logger.info(f"[UserDB] Recovered {count} orphaned reservations for {user_id}")
    return count


# ---------------------------------------------------------------------------
# Admin helpers
# ---------------------------------------------------------------------------

def get_credit_stats_for_admin() -> dict:
    """Scan all user.sqlite files to aggregate credit stats for admin panel.

    Returns dict keyed by user_id with:
      credits_spent: total credits consumed (abs of negative non-refund amounts)
      credits_purchased: total credits from stripe purchases
      purchase_credit_amounts: list of individual stripe purchase credit amounts
    """
    stats: dict = {}

    if not USER_DATA_BASE.exists():
        return stats

    for user_dir in USER_DATA_BASE.iterdir():
        if not user_dir.is_dir():
            continue
        user_id = user_dir.name
        user_db_path = user_dir / "user.sqlite"
        if not user_db_path.exists():
            continue
        try:
            conn = sqlite3.connect(str(user_db_path), timeout=5)
            conn.row_factory = sqlite3.Row

            # Credits spent: sum of negative amounts excluding refunds and admin_set
            spent_rows = conn.execute(
                """SELECT SUM(ABS(amount)) as total_spent
                   FROM credit_transactions
                   WHERE amount < 0 AND source != 'admin_set'"""
            ).fetchone()

            # Credits purchased via Stripe
            purchased_row = conn.execute(
                """SELECT SUM(amount) as total_purchased
                   FROM credit_transactions
                   WHERE source = 'stripe_purchase' AND amount > 0"""
            ).fetchone()

            # Individual purchase amounts
            purchase_detail_rows = conn.execute(
                """SELECT amount
                   FROM credit_transactions
                   WHERE source = 'stripe_purchase' AND amount > 0"""
            ).fetchall()

            conn.close()

            user_stats = {
                "credits_spent": spent_rows["total_spent"] or 0 if spent_rows else 0,
                "credits_purchased": purchased_row["total_purchased"] or 0 if purchased_row else 0,
                "purchase_credit_amounts": [r["amount"] for r in purchase_detail_rows],
            }
            if any(v for k, v in user_stats.items() if k != "purchase_credit_amounts") or user_stats["purchase_credit_amounts"]:
                stats[user_id] = user_stats

        except Exception as e:
            logger.warning(f"[UserDB] Could not read credit stats from {user_db_path}: {e}")
            continue

    return stats


# ---------------------------------------------------------------------------
# Credit summary sync to auth.sqlite (best-effort)
# ---------------------------------------------------------------------------

def _update_credit_summary(user_id: str, balance: int) -> None:
    """Best-effort update of credit_summary in auth.sqlite for admin panel."""
    try:
        from .auth_db import get_auth_db
        with get_auth_db() as db:
            db.execute(
                "UPDATE users SET credit_summary = ? WHERE user_id = ?",
                (balance, user_id),
            )
            db.commit()
    except Exception as e:
        logger.warning(f"[UserDB] Failed to update credit_summary for {user_id}: {e}")


# ---------------------------------------------------------------------------
# Data migration from auth.sqlite
# ---------------------------------------------------------------------------

def _init_credits_row(user_id: str) -> bool:
    """Initialize credits row for a new user if it doesn't exist.

    Idempotent — skips if credits row already exists.
    """
    db_path = _get_user_db_path(user_id)
    if not db_path.exists():
        return False

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row

    try:
        row = conn.execute("SELECT balance FROM credits WHERE user_id = ?", (user_id,)).fetchone()
        if row is not None:
            return False  # Already initialized

        conn.execute(
            "INSERT INTO credits (user_id, balance) VALUES (?, 0)",
            (user_id,)
        )
        conn.commit()
    finally:
        conn.close()

    return True


# ---------------------------------------------------------------------------
# Completed quests (T970: user-scoped quest achievements)
# ---------------------------------------------------------------------------

def mark_quest_completed(user_id: str, quest_id: str) -> None:
    """Record a quest as completed in user.sqlite. Idempotent (INSERT OR IGNORE)."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO completed_quests (quest_id) VALUES (?)",
            (quest_id,),
        )
        conn.commit()
    logger.info(f"[UserDB] Quest {quest_id} marked completed for user {user_id}")


def get_completed_quest_ids(user_id: str) -> set[str]:
    """Return set of quest_ids the user has completed."""
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute("SELECT quest_id FROM completed_quests").fetchall()
        return {row["quest_id"] for row in rows}


def backfill_completed_quests(user_id: str) -> int:
    """Backfill completed_quests from credit_transactions quest_reward rows.

    Idempotent — INSERT OR IGNORE. Called once during session init.
    Returns count of newly backfilled quests.
    """
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute(
            """SELECT reference_id FROM credit_transactions
               WHERE user_id = ? AND source = 'quest_reward' AND reference_id IS NOT NULL""",
            (user_id,),
        ).fetchall()
        count = 0
        for row in rows:
            result = conn.execute(
                "INSERT OR IGNORE INTO completed_quests (quest_id) VALUES (?)",
                (row["reference_id"],),
            )
            if result.rowcount > 0:
                count += 1
        if count > 0:
            conn.commit()
            logger.info(f"[UserDB] Backfilled {count} completed quests for user {user_id}")
    return count


# ---------------------------------------------------------------------------
# Profile management (T960: profiles in user.sqlite)
# ---------------------------------------------------------------------------

def get_profiles(user_id: str) -> list[dict]:
    """Return all profiles for a user, ordered by creation time."""
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute(
            "SELECT id, name, color, is_default, created_at FROM profiles ORDER BY created_at"
        ).fetchall()
        return [dict(r) for r in rows]


def get_selected_profile_id(user_id: str) -> Optional[str]:
    """Return the selected profile ID from user_settings, or None."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT value FROM user_settings WHERE key = 'selected_profile'"
        ).fetchone()
        return row["value"] if row else None


def set_selected_profile_id(user_id: str, profile_id: str) -> None:
    """Set the selected profile in user_settings."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('selected_profile', ?)",
            (profile_id,),
        )
        conn.commit()


PREF_PREFIX = "pref."


def get_all_preferences(user_id: str = None) -> dict[str, str]:
    """Return all preference key-value pairs from user_settings.

    Keys are stored as 'pref.statusFilter' etc; returned without the prefix.
    """
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute(
            "SELECT key, value FROM user_settings WHERE key LIKE 'pref.%'"
        ).fetchall()
        return {row["key"][len(PREF_PREFIX):]: row["value"] for row in rows}


def set_preference(user_id: str = None, key: str = "", value: str = "") -> None:
    """Set a single preference in user_settings."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
            (f"{PREF_PREFIX}{key}", value),
        )
        conn.commit()


def set_preferences_bulk(user_id: str = None, prefs: dict[str, str] = None) -> None:
    """Set multiple preferences in a single transaction."""
    if not prefs:
        return
    with get_user_db_connection(user_id) as conn:
        for key, value in prefs.items():
            conn.execute(
                "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
                (f"{PREF_PREFIX}{key}", value),
            )
        conn.commit()


def clear_all_preferences(user_id: str = None) -> None:
    """Delete all preference rows from user_settings."""
    with get_user_db_connection(user_id) as conn:
        conn.execute("DELETE FROM user_settings WHERE key LIKE 'pref.%'")
        conn.commit()


def backfill_preferences_from_profile(user_id: str) -> bool:
    """One-time migration: copy settings from active profile DB to user.sqlite.

    Idempotent — skips if user.sqlite already has any pref.* keys.
    Returns True if backfill occurred, False if skipped.
    """
    existing = get_all_preferences(user_id)
    if existing:
        return False

    # Try to read from the active profile's profile.sqlite
    import json
    from ..database import get_db_connection
    try:
        with get_db_connection() as conn:
            row = conn.execute(
                "SELECT settings_json FROM user_settings WHERE id = 1"
            ).fetchone()
            if row and row["settings_json"]:
                blob = json.loads(row["settings_json"])
                # Flatten nested JSON: {projectFilters: {statusFilter: "x"}} -> {statusFilter: "x"}
                flat = {}
                for section_value in blob.values():
                    if isinstance(section_value, dict):
                        flat.update({k: str(v) for k, v in section_value.items()})
                if flat:
                    set_preferences_bulk(user_id, flat)
                    logger.info(f"[UserDB] Backfilled {len(flat)} preferences for user {user_id} from profile DB")
                    return True
    except Exception as e:
        logger.warning(f"[UserDB] Could not backfill preferences for user {user_id}: {e}")

    return False


def create_profile(user_id: str, profile_id: str, name: str, color: str, is_default: bool = False) -> None:
    """Insert a new profile row."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT INTO profiles (id, name, color, is_default) VALUES (?, ?, ?, ?)",
            (profile_id, name, color, 1 if is_default else 0),
        )
        conn.commit()
    logger.info(f"[UserDB] Created profile {profile_id} ({name}) for user {user_id}")


def update_profile(user_id: str, profile_id: str, name: Optional[str] = None, color: Optional[str] = None) -> None:
    """Update a profile's name and/or color."""
    with get_user_db_connection(user_id) as conn:
        if name is not None:
            conn.execute("UPDATE profiles SET name = ? WHERE id = ?", (name, profile_id))
        if color is not None:
            conn.execute("UPDATE profiles SET color = ? WHERE id = ?", (color, profile_id))
        conn.commit()


def delete_profile(user_id: str, profile_id: str) -> None:
    """Delete a profile row. Also clears is_default if it was the default."""
    with get_user_db_connection(user_id) as conn:
        conn.execute("DELETE FROM profiles WHERE id = ?", (profile_id,))
        conn.commit()
    logger.info(f"[UserDB] Deleted profile {profile_id} for user {user_id}")


def set_default_profile(user_id: str, profile_id: str) -> None:
    """Set a profile as the default (clears is_default on all others)."""
    with get_user_db_connection(user_id) as conn:
        conn.execute("UPDATE profiles SET is_default = 0")
        conn.execute("UPDATE profiles SET is_default = 1 WHERE id = ?", (profile_id,))
        conn.commit()


