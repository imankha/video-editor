"""
Central authentication database — shared SQLite for cross-device auth.

Unlike per-user databases (one SQLite per user+profile), this is a SINGLE
database shared by all users. It stores:
  - users: email → user_id mapping (user_id = R2 folder name)
  - sessions: session_id → user_id (validates rb_session cookies)
  - otp_codes: temporary email verification codes (T401)

Sync strategy:
  - Read from R2 on server startup (restore users table for cross-device recovery)
  - Write to R2 immediately on create_user / link_google_to_user only
  - Sessions are ephemeral — local SQLite only, loss on restart is acceptable

The local SQLite file is the source of truth while the server is running.
R2 is a backup for the users table only.
"""

import logging
import secrets
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Auth database location (outside user-scoped paths)
_AUTH_DB_DIR = Path(__file__).parent.parent.parent.parent.parent / "user_data"
AUTH_DB_PATH = _AUTH_DB_DIR / "auth.sqlite"

# R2 key for backup (not under any user folder)
AUTH_DB_R2_KEY_SUFFIX = "auth/auth.sqlite"

# Session cache — avoids hitting SQLite on every request
# Maps session_id → (user_id, email, expires_at_iso)
_session_cache: dict[str, tuple[str, Optional[str], str]] = {}
_session_cache_lock = threading.Lock()


def _get_auth_db_r2_key() -> str:
    """R2 object key for the auth database."""
    from ..storage import APP_ENV
    return f"{APP_ENV}/{AUTH_DB_R2_KEY_SUFFIX}"


# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------

def _get_connection() -> sqlite3.Connection:
    """Open a connection to the auth database."""
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(AUTH_DB_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


@contextmanager
def get_auth_db():
    """Context manager for auth database access."""
    conn = _get_connection()
    try:
        yield conn
    finally:
        conn.close()


def init_auth_db():
    """Create auth tables if they don't exist. Called on startup."""
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_auth_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                email TEXT UNIQUE,
                google_id TEXT UNIQUE,
                verified_at TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                last_seen_at TEXT
            );

            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(user_id),
                expires_at TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS otp_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                code TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT,
                attempts INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes(email);
        """)

        # T920: credit_summary for admin panel aggregation (idempotent)
        try:
            db.execute("ALTER TABLE users ADD COLUMN credit_summary INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # Column already exists

        # T550: Admin users — table-driven admin list
        db.executescript("""
            CREATE TABLE IF NOT EXISTS admin_users (
                email TEXT PRIMARY KEY
            );
        """)
        db.execute(
            "INSERT OR IGNORE INTO admin_users (email) VALUES (?)",
            ("imankh@gmail.com",),
        )
        db.commit()

        # Legacy credit_transactions removed — now in per-user user.sqlite (T920)

    logger.info("[AuthDB] Tables initialized")


# ---------------------------------------------------------------------------
# R2 sync (backup/restore)
# ---------------------------------------------------------------------------

def sync_auth_db_from_r2() -> bool:
    """Download auth.sqlite from R2 on startup. Returns True if downloaded."""
    from ..storage import R2_ENABLED, get_r2_client, R2_BUCKET

    if not R2_ENABLED:
        return False

    client = get_r2_client()
    if not client:
        return False

    key = _get_auth_db_r2_key()
    try:
        from ..utils.retry import retry_r2_call, TIER_1
        AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        retry_r2_call(
            client.download_file, R2_BUCKET, key, str(AUTH_DB_PATH),
            operation="auth_db_restore", **TIER_1,
        )
        logger.info(f"[AuthDB] Restored from R2: {key}")
        return True
    except client.exceptions.ClientError as e:
        if e.response['Error']['Code'] == '404':
            logger.info("[AuthDB] No backup in R2 — starting fresh")
            return False
        logger.error(f"[AuthDB] Failed to restore from R2: {e}")
        return False
    except Exception as e:
        logger.error(f"[AuthDB] Failed to restore from R2: {e}")
        return False


def sync_auth_db_to_r2() -> bool:
    """Upload auth.sqlite to R2 as backup. Returns True if uploaded."""
    from ..storage import R2_ENABLED, get_r2_client, R2_BUCKET

    if not R2_ENABLED:
        return False

    if not AUTH_DB_PATH.exists():
        return False

    client = get_r2_client()
    if not client:
        return False

    key = _get_auth_db_r2_key()
    try:
        # WAL checkpoint before upload to ensure all data is in main DB file
        conn = sqlite3.connect(str(AUTH_DB_PATH))
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()

        from ..utils.retry import retry_r2_call, TIER_1
        retry_r2_call(
            client.upload_file, str(AUTH_DB_PATH), R2_BUCKET, key,
            operation="auth_db_backup", **TIER_1,
        )
        logger.info(f"[AuthDB] Backed up to R2: {key}")
        return True
    except Exception as e:
        logger.error(f"[AuthDB] Failed to backup to R2: {e}")
        return False


# ---------------------------------------------------------------------------
# User operations
# ---------------------------------------------------------------------------

def get_user_by_email(email: str) -> Optional[dict]:
    """Look up a user by email. Returns dict or None."""
    with get_auth_db() as db:
        row = db.execute(
            "SELECT user_id, email, google_id, verified_at, created_at FROM users WHERE email = ?",
            (email,)
        ).fetchone()
        if row:
            return dict(row)
    return None


def get_user_by_google_id(google_id: str) -> Optional[dict]:
    """Look up a user by Google sub ID. Returns dict or None."""
    with get_auth_db() as db:
        row = db.execute(
            "SELECT user_id, email, google_id, verified_at, created_at FROM users WHERE google_id = ?",
            (google_id,)
        ).fetchone()
        if row:
            return dict(row)
    return None


def create_user(
    user_id: str,
    email: Optional[str] = None,
    google_id: Optional[str] = None,
    verified_at: Optional[str] = None,
) -> dict:
    """
    Create a new user in the auth database.

    For anonymous guests, email/google_id are None.
    For Google auth, all fields are populated.

    Syncs to R2 after creation (new users are critical data).
    """
    with get_auth_db() as db:
        db.execute(
            """INSERT INTO users (user_id, email, google_id, verified_at)
               VALUES (?, ?, ?, ?)""",
            (user_id, email, google_id, verified_at),
        )
        db.commit()

    # Sync to R2 immediately — new user registration is critical
    sync_auth_db_to_r2()

    logger.info(f"[AuthDB] Created user: {user_id} email={email}")
    return {"user_id": user_id, "email": email, "google_id": google_id}


def link_google_to_user(user_id: str, email: str, google_id: str) -> None:
    """Link a Google account to an existing anonymous user."""
    now = datetime.utcnow().isoformat()
    with get_auth_db() as db:
        db.execute(
            """UPDATE users SET email = ?, google_id = ?, verified_at = ?
               WHERE user_id = ?""",
            (email, google_id, now, user_id),
        )
        db.commit()
    sync_auth_db_to_r2()
    logger.info(f"[AuthDB] Linked Google to user {user_id}: {email}")


def update_last_seen(user_id: str) -> None:
    """Update user's last_seen_at timestamp."""
    now = datetime.utcnow().isoformat()
    with get_auth_db() as db:
        db.execute(
            "UPDATE users SET last_seen_at = ? WHERE user_id = ?",
            (now, user_id),
        )
        db.commit()


def get_user_by_id(user_id: str) -> Optional[dict]:
    """Look up a user by user_id."""
    with get_auth_db() as db:
        row = db.execute(
            "SELECT user_id, email, google_id, verified_at, created_at FROM users WHERE user_id = ?",
            (user_id,)
        ).fetchone()
        if row:
            return dict(row)
    return None


# ---------------------------------------------------------------------------
# Session operations
# ---------------------------------------------------------------------------

def create_session(user_id: str, ttl_days: int = 30) -> str:
    """
    Create a new session for a user. Returns the session_id (for cookie).
    """
    session_id = secrets.token_urlsafe(32)
    expires_at = (datetime.utcnow() + timedelta(days=ttl_days)).isoformat()

    with get_auth_db() as db:
        db.execute(
            "INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)",
            (session_id, user_id, expires_at),
        )
        db.commit()

    # Cache the new session
    with _session_cache_lock:
        email = None
        user = get_user_by_id(user_id)
        if user:
            email = user.get("email")
        _session_cache[session_id] = (user_id, email, expires_at)

    logger.info(f"[AuthDB] Created session for user {user_id}, expires {expires_at}")
    return session_id


def validate_session(session_id: str) -> Optional[dict]:
    """
    Validate a session cookie. Returns {user_id, email} or None.

    Uses an in-process cache (5-min TTL) to avoid SQLite hits on every request.
    """
    # Check cache first
    with _session_cache_lock:
        if session_id in _session_cache:
            user_id, email, expires_at = _session_cache[session_id]
            if datetime.fromisoformat(expires_at) > datetime.utcnow():
                return {"user_id": user_id, "email": email}
            else:
                # Expired — remove from cache
                del _session_cache[session_id]
                return None

    # Cache miss — hit SQLite
    with get_auth_db() as db:
        row = db.execute(
            """SELECT s.session_id, s.user_id, s.expires_at, u.email
               FROM sessions s
               JOIN users u ON s.user_id = u.user_id
               WHERE s.session_id = ?""",
            (session_id,),
        ).fetchone()

    if not row:
        return None

    expires_at = row['expires_at']
    if datetime.fromisoformat(expires_at) < datetime.utcnow():
        # Expired — clean up
        invalidate_session(session_id)
        return None

    user_id = row['user_id']
    email = row['email']

    # Cache it
    with _session_cache_lock:
        _session_cache[session_id] = (user_id, email, expires_at)

    return {"user_id": user_id, "email": email}


def invalidate_session(session_id: str) -> None:
    """Delete a session (logout or expiry cleanup)."""
    with get_auth_db() as db:
        db.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        db.commit()

    with _session_cache_lock:
        _session_cache.pop(session_id, None)


def invalidate_user_sessions(user_id: str) -> None:
    """Delete all sessions for a user (e.g., password change)."""
    with get_auth_db() as db:
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        db.commit()

    # Clear cache entries for this user
    with _session_cache_lock:
        to_remove = [sid for sid, (uid, _, _) in _session_cache.items() if uid == user_id]
        for sid in to_remove:
            del _session_cache[sid]


def cleanup_expired_sessions() -> int:
    """Remove expired sessions. Returns count deleted."""
    now = datetime.utcnow().isoformat()
    with get_auth_db() as db:
        cursor = db.execute(
            "DELETE FROM sessions WHERE expires_at < ?", (now,)
        )
        db.commit()
        count = cursor.rowcount

    if count > 0:
        logger.info(f"[AuthDB] Cleaned up {count} expired sessions")

    return count


# ---------------------------------------------------------------------------
# Guest user creation
# ---------------------------------------------------------------------------

def generate_user_id() -> str:
    """Generate a new UUID for a user folder."""
    return str(uuid.uuid4())


def create_guest_user() -> str:
    """
    Create an anonymous guest user with a UUID.
    Returns the user_id.
    """
    user_id = generate_user_id()
    with get_auth_db() as db:
        db.execute(
            "INSERT INTO users (user_id) VALUES (?)",
            (user_id,),
        )
        db.commit()
    logger.info(f"[AuthDB] Created guest user: {user_id}")
    return user_id


# ---------------------------------------------------------------------------
# Admin operations (T550)
# ---------------------------------------------------------------------------

def is_admin(user_id: str) -> bool:
    """Check if user's email is in admin_users table."""
    with get_auth_db() as db:
        row = db.execute(
            "SELECT email FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        if not row or not row["email"]:
            return False
        return db.execute(
            "SELECT 1 FROM admin_users WHERE email = ?", (row["email"],)
        ).fetchone() is not None


def get_all_users_for_admin() -> list:
    """Return all users for the admin panel. Returns base user data only (no per-profile stats)."""
    with get_auth_db() as db:
        rows = db.execute(
            """SELECT user_id, email, credit_summary as credits, created_at, last_seen_at
               FROM users
               ORDER BY created_at DESC"""
        ).fetchall()
        return [dict(r) for r in rows]
