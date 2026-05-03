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
  - Sessions persisted as individual R2 objects (T1195) — lazy-restored on
    cache+DB miss after machine restart. O(1) per operation, no ListObjects.
"""

import json
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
    """Create auth tables if they don't exist. Called on startup.

    T1330: `users.email` is NOT NULL. On first boot after upgrading, any
    pre-existing NULL-email (guest) rows are purged along with their
    sessions/credit_transactions, then the users table is rebuilt with
    the NOT NULL constraint. Idempotent — re-running is a no-op once
    the new schema is in place.
    """
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

        # T430: Google profile picture URL
        try:
            db.execute("ALTER TABLE users ADD COLUMN picture_url TEXT")
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

        # T1510: impersonation columns on sessions (additive, idempotent)
        for ddl in (
            "ALTER TABLE sessions ADD COLUMN impersonator_user_id TEXT",
            "ALTER TABLE sessions ADD COLUMN impersonation_expires_at TEXT",
        ):
            try:
                db.execute(ddl)
            except sqlite3.OperationalError:
                pass

        # T1510: audit log for every impersonation start/stop/expire.
        # Lives in auth.sqlite (global) — admin actions must not be scoped
        # to the target user's DB.
        db.executescript("""
            CREATE TABLE IF NOT EXISTS impersonation_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_user_id TEXT NOT NULL,
                target_user_id TEXT NOT NULL,
                action TEXT NOT NULL CHECK (action IN ('start', 'stop', 'expire')),
                ip TEXT,
                user_agent TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_impersonation_audit_admin ON impersonation_audit(admin_user_id);
            CREATE INDEX IF NOT EXISTS idx_impersonation_audit_target ON impersonation_audit(target_user_id);
        """)
        db.commit()

        # T1580: cross-user game storage tracking for R2 cleanup.
        # Each row = one user's reference to a deduped game video.
        # Daily sweep deletes R2 objects when MAX(storage_expires_at) < now.
        db.executescript("""
            CREATE TABLE IF NOT EXISTS game_storage_refs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                profile_id TEXT NOT NULL,
                blake3_hash TEXT NOT NULL,
                game_size_bytes INTEGER NOT NULL,
                storage_expires_at TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(user_id, profile_id, blake3_hash)
            );
            CREATE INDEX IF NOT EXISTS idx_game_refs_hash ON game_storage_refs(blake3_hash);
            CREATE INDEX IF NOT EXISTS idx_game_refs_user ON game_storage_refs(user_id);
        """)
        db.commit()

        # T1330: drop any NULL-email (guest) rows + rebuild users with NOT NULL email.
        _migrate_users_email_not_null(db)

    logger.info("[AuthDB] Tables initialized")


def _migrate_users_email_not_null(db: sqlite3.Connection) -> None:
    """T1330: purge NULL-email rows and enforce `email NOT NULL`.

    Safe to run repeatedly. If the current users table already has
    `email NOT NULL`, this is a no-op apart from an idempotent null scan
    (which finds nothing).
    """
    # 1. Check current schema for NOT NULL on email
    cols = db.execute("PRAGMA table_info(users)").fetchall()
    email_col = next((c for c in cols if c["name"] == "email"), None)
    already_not_null = bool(email_col and email_col["notnull"])

    # 2. Purge guests + their dependents. credit_transactions has an FK to users
    #    with no ON DELETE CASCADE, so delete dependents first. (sessions is the
    #    same shape — done explicitly for clarity.)
    null_rows = db.execute(
        "SELECT COUNT(*) FROM users WHERE email IS NULL"
    ).fetchone()[0]
    if null_rows:
        logger.warning(f"[AuthDB] T1330: purging {null_rows} NULL-email (guest) rows")
        db.execute(
            "DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE email IS NULL)"
        )
        if _has_table(db, "credit_transactions"):
            db.execute(
                "DELETE FROM credit_transactions "
                "WHERE user_id IN (SELECT user_id FROM users WHERE email IS NULL)"
            )
        db.execute("DELETE FROM users WHERE email IS NULL")
        db.commit()

    if already_not_null:
        return

    # 3. Rebuild users with email NOT NULL. SQLite can't add NOT NULL via ALTER.
    #    Preserve whatever columns currently exist (historical columns like
    #    `credits` may be present in R2-restored DBs even if not in the
    #    canonical CREATE TABLE above). Only upgrade email to NOT NULL.
    def _col_def(c) -> str:
        name = c["name"]
        ctype = c["type"] or ""
        parts = [f'"{name}"']
        if ctype:
            parts.append(ctype)
        if name == "user_id":
            parts.append("PRIMARY KEY")
        elif name == "email":
            parts.append("NOT NULL UNIQUE")
        elif name == "google_id":
            parts.append("UNIQUE")
        if c["dflt_value"] is not None:
            dflt = c["dflt_value"]
            # Wrap expressions (e.g. `datetime('now')`) in parens; leave
            # literals (numbers, quoted strings) alone.
            if "(" in dflt and not dflt.startswith("("):
                dflt = f"({dflt})"
            parts.append(f"DEFAULT {dflt}")
        return " ".join(parts)

    col_defs = ", ".join(_col_def(c) for c in cols)
    col_names = [c["name"] for c in cols]
    col_list = ", ".join(f'"{n}"' for n in col_names)
    db.executescript(f"""
        CREATE TABLE users_new ({col_defs});
        INSERT INTO users_new ({col_list}) SELECT {col_list} FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
    """)
    db.commit()
    logger.info("[AuthDB] T1330: users table rebuilt with email NOT NULL")


def _has_table(db: sqlite3.Connection, name: str) -> bool:
    row = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# R2 sync (backup/restore)
# ---------------------------------------------------------------------------

def _r2_enabled() -> bool:
    """Testable seam for whether R2 backup is configured (module-local shim
    so tests can patch this without touching the real storage module)."""
    from ..storage import R2_ENABLED
    return bool(R2_ENABLED)


def sync_auth_db_from_r2() -> bool:
    """Download auth.sqlite from R2 on startup.

    Returns:
        True  — successfully restored from R2.
        False — R2 disabled, client unavailable, or object not found (404).
                These are all "no backup to restore" cases; caller should
                treat them as a legitimate fresh start and run init_auth_db().

    Raises:
        Any transient or unexpected error (network outage, 5xx, auth error).
        T1290: we no longer swallow these into `return False` because the
        caller (`restore_auth_db_or_fail`) must be able to distinguish
        "no backup" from "R2 is broken" — the latter must be retried and
        ultimately escalated to a fatal startup failure instead of
        silently creating an empty auth DB.
    """
    from ..storage import get_r2_client, R2_BUCKET

    if not _r2_enabled():
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
        # Non-404 ClientError (403 auth, 5xx, etc.) — propagate.
        logger.error(f"[AuthDB] R2 ClientError during restore: {e}")
        raise


def restore_auth_db_or_fail() -> None:
    """Startup helper — guarantees the auth DB is either restored from R2
    or cleanly initialized fresh. Never silently produces an empty DB on
    top of a real R2 failure.

    Semantics (T1290):
      - R2 disabled → call init_auth_db() (local dev: empty DB is correct).
      - R2 enabled, restore succeeds → call init_auth_db() to ensure any
        new columns/tables are applied (idempotent).
      - R2 enabled, restore returns False (404 / no backup) → call
        init_auth_db() (legitimate first boot of a new environment).
      - R2 enabled, restore raises → retry up to 3 attempts with
        exponential backoff. If all 3 fail, raise RuntimeError so the
        process crashes and Fly.io restarts it — DO NOT fall through to
        init_auth_db() (that would wipe sessions + email→user_id records,
        the root cause of the sarkarati@ incident).
    """
    if not _r2_enabled():
        logger.info("[AuthDB] R2 disabled — skipping restore, using local DB")
        init_auth_db()
        return

    max_attempts = 3
    base_delay = 1.0
    last_exc: Optional[BaseException] = None

    for attempt in range(1, max_attempts + 1):
        try:
            sync_auth_db_from_r2()
            # Either restored (True) or legitimate no-backup (False); both
            # are fine — the DB file is either restored or absent, and
            # init_auth_db is idempotent.
            init_auth_db()
            return
        except Exception as e:
            last_exc = e
            if attempt < max_attempts:
                delay = base_delay * (2 ** (attempt - 1))
                logger.warning(
                    f"[AuthDB] Restore attempt {attempt}/{max_attempts} "
                    f"failed: {type(e).__name__}: {e} — retrying in {delay:.1f}s"
                )
                import time as _time
                _time.sleep(delay)
            else:
                logger.error(
                    f"[AuthDB] Restore attempt {attempt}/{max_attempts} "
                    f"failed: {type(e).__name__}: {e} — giving up"
                )

    # All attempts exhausted — fatal. Do NOT fall through to init_auth_db.
    raise RuntimeError(
        f"auth DB restore from R2 failed after {max_attempts} attempts; "
        f"refusing to start with an empty auth DB. Last error: "
        f"{type(last_exc).__name__}: {last_exc}"
    )


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
# Per-session R2 persistence (T1195)
# ---------------------------------------------------------------------------

def _get_session_r2_key(session_id: str) -> str:
    from ..storage import APP_ENV
    return f"{APP_ENV}/sessions/{session_id}.json"


def persist_session_to_r2(session_id: str, user_id: str, email: Optional[str], expires_at: str) -> None:
    """Write a session object to R2 for cross-restart durability. O(1) PutObject."""
    if not _r2_enabled():
        return

    from ..storage import get_r2_client, R2_BUCKET
    client = get_r2_client()
    if not client:
        return

    key = _get_session_r2_key(session_id)
    body = json.dumps({
        "user_id": user_id,
        "email": email,
        "expires_at": expires_at,
        "created_at": datetime.utcnow().isoformat(),
    }).encode()

    try:
        from ..utils.retry import retry_r2_call, TIER_1
        retry_r2_call(
            client.put_object,
            Bucket=R2_BUCKET, Key=key, Body=body, ContentType="application/json",
            operation="session_persist", **TIER_1,
        )
        logger.info(f"[AuthDB] Persisted session to R2: {session_id[:8]}...")
    except Exception as e:
        logger.error(f"[AuthDB] Failed to persist session to R2: {e}")


def restore_session_from_r2(session_id: str) -> Optional[dict]:
    """Lazy-restore a single session from R2 on cache+DB miss. O(1) GetObject."""
    if not _r2_enabled():
        return None

    from ..storage import get_r2_client, R2_BUCKET
    client = get_r2_client()
    if not client:
        return None

    key = _get_session_r2_key(session_id)
    try:
        from ..utils.retry import retry_r2_call, TIER_1
        response = retry_r2_call(
            client.get_object,
            Bucket=R2_BUCKET, Key=key,
            operation="session_restore", **TIER_1,
        )
        data = json.loads(response["Body"].read())
    except Exception as e:
        if hasattr(e, "response") and e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey"):
            return None
        logger.error(f"[AuthDB] R2 error restoring session {session_id[:8]}...: {e}")
        return None

    expires_at = data.get("expires_at")
    if not expires_at or datetime.fromisoformat(expires_at) < datetime.utcnow():
        return None

    user_id = data["user_id"]
    email = data.get("email")

    with get_auth_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, ?)",
            (session_id, user_id, expires_at),
        )
        db.commit()

    with _session_cache_lock:
        _session_cache[session_id] = (user_id, email, expires_at)

    logger.info(f"[AuthDB] Restored session from R2: {session_id[:8]}... user={user_id}")
    return {"user_id": user_id, "email": email}


def delete_session_from_r2(session_id: str) -> None:
    """Delete a session object from R2 on logout. O(1) DeleteObject."""
    if not _r2_enabled():
        return

    from ..storage import get_r2_client, R2_BUCKET
    client = get_r2_client()
    if not client:
        return

    key = _get_session_r2_key(session_id)
    try:
        from ..utils.retry import retry_r2_call, TIER_3
        retry_r2_call(
            client.delete_object,
            Bucket=R2_BUCKET, Key=key,
            operation="session_delete", **TIER_3,
        )
    except Exception as e:
        logger.error(f"[AuthDB] Failed to delete session from R2: {e}")


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


def link_email_to_user(user_id: str, email: str) -> None:
    """Link an email to an existing anonymous user (via OTP verification)."""
    now = datetime.utcnow().isoformat()
    with get_auth_db() as db:
        db.execute(
            """UPDATE users SET email = ?, verified_at = ? WHERE user_id = ?""",
            (email, now, user_id),
        )
        db.commit()
    sync_auth_db_to_r2()
    logger.info(f"[AuthDB] Linked email to user {user_id}: {email}")


def update_picture_url(user_id: str, picture_url: str) -> None:
    """Update user's Google profile picture URL."""
    with get_auth_db() as db:
        db.execute(
            "UPDATE users SET picture_url = ? WHERE user_id = ?",
            (picture_url, user_id),
        )
        db.commit()


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
            "SELECT user_id, email, google_id, verified_at, created_at, picture_url FROM users WHERE user_id = ?",
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

    persist_session_to_r2(session_id, user_id, email, expires_at)

    logger.info(f"[AuthDB] Created session for user {user_id}, expires {expires_at}")
    return session_id


def validate_session(session_id: str) -> Optional[dict]:
    """
    Validate a session cookie. Returns {user_id, email, impersonator_user_id?,
    impersonator_email?, impersonation_expires_at?} or None.

    Uses an in-process cache (5-min TTL) to avoid SQLite hits on every request.

    T1510: if the session row has impersonation_expires_at set and it has
    passed, the session is treated as expired and an 'expire' audit row is
    written.
    """
    # Check cache first (cache does not store impersonation state — skip it
    # for impersonation sessions so TTL checks always hit the DB).
    with _session_cache_lock:
        if session_id in _session_cache:
            user_id, email, expires_at = _session_cache[session_id]
            if datetime.fromisoformat(expires_at) > datetime.utcnow():
                return {"user_id": user_id, "email": email}
            else:
                del _session_cache[session_id]
                return None

    # Cache miss — hit SQLite
    with get_auth_db() as db:
        row = db.execute(
            """SELECT s.session_id, s.user_id, s.expires_at,
                      s.impersonator_user_id, s.impersonation_expires_at,
                      u.email
               FROM sessions s
               JOIN users u ON s.user_id = u.user_id
               WHERE s.session_id = ?""",
            (session_id,),
        ).fetchone()

    if not row:
        return restore_session_from_r2(session_id)

    expires_at = row['expires_at']
    if datetime.fromisoformat(expires_at) < datetime.utcnow():
        invalidate_session(session_id)
        return None

    user_id = row['user_id']
    email = row['email']
    impersonator_user_id = row['impersonator_user_id']
    impersonation_expires_at = row['impersonation_expires_at']

    # T1510: impersonation TTL enforcement
    if impersonator_user_id and impersonation_expires_at:
        if datetime.fromisoformat(impersonation_expires_at) < datetime.utcnow():
            try:
                log_impersonation(
                    impersonator_user_id, user_id, "expire", None, None
                )
            except Exception:
                logger.exception("[AuthDB] Failed to write impersonation expire audit")
            invalidate_session(session_id)
            return None

    result = {"user_id": user_id, "email": email}
    if impersonator_user_id:
        # Look up impersonator email for richer /me responses
        imp_email = None
        with get_auth_db() as db:
            imp_row = db.execute(
                "SELECT email FROM users WHERE user_id = ?",
                (impersonator_user_id,),
            ).fetchone()
            if imp_row:
                imp_email = imp_row["email"]
        result["impersonator_user_id"] = impersonator_user_id
        result["impersonator_email"] = imp_email
        result["impersonation_expires_at"] = impersonation_expires_at
        # Do NOT cache impersonation sessions — we need fresh TTL checks
        return result

    # Cache non-impersonation sessions only
    with _session_cache_lock:
        _session_cache[session_id] = (user_id, email, expires_at)

    return result


def invalidate_session(session_id: str) -> None:
    """Delete a session (logout or expiry cleanup)."""
    with get_auth_db() as db:
        db.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
        db.commit()

    with _session_cache_lock:
        _session_cache.pop(session_id, None)

    delete_session_from_r2(session_id)


def invalidate_user_sessions(user_id: str) -> None:
    """Delete all sessions for a user (e.g., password change)."""
    with get_auth_db() as db:
        session_ids = [
            row[0] for row in
            db.execute("SELECT session_id FROM sessions WHERE user_id = ?", (user_id,)).fetchall()
        ]
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        db.commit()

    # Clear cache entries for this user
    with _session_cache_lock:
        to_remove = [sid for sid, (uid, _, _) in _session_cache.items() if uid == user_id]
        for sid in to_remove:
            del _session_cache[sid]

    for sid in session_ids:
        delete_session_from_r2(sid)


def cleanup_expired_sessions() -> int:
    """Remove expired sessions. Returns count deleted."""
    now = datetime.utcnow().isoformat()
    with get_auth_db() as db:
        expired_ids = [
            row[0] for row in
            db.execute("SELECT session_id FROM sessions WHERE expires_at < ?", (now,)).fetchall()
        ]
        cursor = db.execute(
            "DELETE FROM sessions WHERE expires_at < ?", (now,)
        )
        db.commit()
        count = cursor.rowcount

    for sid in expired_ids:
        delete_session_from_r2(sid)

    if count > 0:
        logger.info(f"[AuthDB] Cleaned up {count} expired sessions")

    return count


# ---------------------------------------------------------------------------
# User ID generation
# ---------------------------------------------------------------------------

def generate_user_id() -> str:
    """Generate a new UUID for a user folder."""
    return str(uuid.uuid4())


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


def get_admin_emails() -> list[str]:
    """Return all admin email addresses from admin_users table."""
    with get_auth_db() as db:
        rows = db.execute("SELECT email FROM admin_users").fetchall()
    return [row["email"] for row in rows]


# ---------------------------------------------------------------------------
# T1510: Impersonation
# ---------------------------------------------------------------------------

IMPERSONATION_TTL_MINUTES = 60


def create_impersonation_session(
    target_user_id: str,
    impersonator_user_id: str,
    ttl_minutes: int = IMPERSONATION_TTL_MINUTES,
) -> str:
    """Mint a new session row flagged with impersonator_user_id + TTL.

    The session cookie itself uses the normal 30-day expires_at — the shorter
    impersonation_expires_at is enforced in validate_session().
    """
    session_id = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    expires_at = (now + timedelta(days=30)).isoformat()
    impersonation_expires_at = (now + timedelta(minutes=ttl_minutes)).isoformat()

    with get_auth_db() as db:
        db.execute(
            """INSERT INTO sessions
                  (session_id, user_id, expires_at,
                   impersonator_user_id, impersonation_expires_at)
               VALUES (?, ?, ?, ?, ?)""",
            (session_id, target_user_id, expires_at,
             impersonator_user_id, impersonation_expires_at),
        )
        db.commit()

    logger.info(
        f"[AuthDB][T1510] Impersonation session created: "
        f"admin={impersonator_user_id} target={target_user_id} "
        f"expires={impersonation_expires_at}"
    )
    return session_id


def find_or_create_admin_restore_session(admin_user_id: str) -> str:
    """On stop-impersonation: return a valid plain session for the admin.

    Prefers the most recent non-expired, non-impersonation session. Mints a
    fresh one if none exist (e.g., admin's original session has since expired).
    """
    now = datetime.utcnow().isoformat()
    with get_auth_db() as db:
        row = db.execute(
            """SELECT session_id FROM sessions
               WHERE user_id = ?
                 AND impersonator_user_id IS NULL
                 AND expires_at > ?
               ORDER BY created_at DESC LIMIT 1""",
            (admin_user_id, now),
        ).fetchone()
    if row:
        return row["session_id"]
    return create_session(admin_user_id)


def log_impersonation(
    admin_user_id: str,
    target_user_id: str,
    action: str,
    ip: Optional[str],
    user_agent: Optional[str],
) -> None:
    """Write a row to impersonation_audit. action ∈ {'start','stop','expire'}."""
    with get_auth_db() as db:
        db.execute(
            """INSERT INTO impersonation_audit
                  (admin_user_id, target_user_id, action, ip, user_agent)
               VALUES (?, ?, ?, ?, ?)""",
            (admin_user_id, target_user_id, action, ip, user_agent),
        )
        db.commit()


def get_all_users_for_admin() -> list:
    """Return all users for the admin panel. Returns base user data only (no per-profile stats)."""
    with get_auth_db() as db:
        rows = db.execute(
            """SELECT user_id, email, credit_summary as credits, created_at, last_seen_at
               FROM users
               ORDER BY created_at DESC"""
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# T1580: Game storage references (cross-user R2 cleanup)
# ---------------------------------------------------------------------------

def insert_game_storage_ref(
    user_id: str,
    profile_id: str,
    blake3_hash: str,
    game_size_bytes: int,
    storage_expires_at: str,
) -> None:
    """Record a user's reference to a game video for R2 lifecycle tracking."""
    with get_auth_db() as db:
        db.execute(
            """INSERT OR REPLACE INTO game_storage_refs
                  (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at),
        )
        db.commit()
    sync_auth_db_to_r2()


def get_game_storage_ref(
    user_id: str, profile_id: str, blake3_hash: str
) -> Optional[dict]:
    """Get a user's storage ref for a game video, or None."""
    with get_auth_db() as db:
        row = db.execute(
            """SELECT storage_expires_at, game_size_bytes, created_at
               FROM game_storage_refs
               WHERE user_id = ? AND profile_id = ? AND blake3_hash = ?""",
            (user_id, profile_id, blake3_hash),
        ).fetchone()
    return dict(row) if row else None


def get_storage_refs_for_user(user_id: str) -> list[dict]:
    """Get all storage refs for a user (all profiles). Used for game list expiry display."""
    with get_auth_db() as db:
        rows = db.execute(
            """SELECT blake3_hash, storage_expires_at, game_size_bytes
               FROM game_storage_refs
               WHERE user_id = ?""",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_expired_refs() -> list[dict]:
    """Find individually expired storage refs (per user-game, not per hash)."""
    now = datetime.utcnow().isoformat()
    with get_auth_db() as db:
        rows = db.execute(
            """SELECT user_id, profile_id, blake3_hash
               FROM game_storage_refs
               WHERE storage_expires_at < ?""",
            (now,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_ref(user_id: str, profile_id: str, blake3_hash: str) -> None:
    """Delete a single user's storage ref for a hash."""
    with get_auth_db() as db:
        db.execute(
            """DELETE FROM game_storage_refs
               WHERE user_id = ? AND profile_id = ? AND blake3_hash = ?""",
            (user_id, profile_id, blake3_hash),
        )
        db.commit()
    sync_auth_db_to_r2()


def has_remaining_refs(blake3_hash: str) -> bool:
    """Check if any storage refs remain for this hash (any user still active)."""
    with get_auth_db() as db:
        row = db.execute(
            "SELECT COUNT(*) as cnt FROM game_storage_refs WHERE blake3_hash = ?",
            (blake3_hash,),
        ).fetchone()
    return row['cnt'] > 0


def get_next_expiry() -> Optional[datetime]:
    """Return the earliest future expiry across all game storage refs."""
    now = datetime.utcnow().isoformat()
    with get_auth_db() as db:
        row = db.execute(
            """SELECT MIN(storage_expires_at) as next_expiry
               FROM game_storage_refs
               WHERE storage_expires_at > ?""",
            (now,),
        ).fetchone()
    if row and row['next_expiry']:
        return datetime.fromisoformat(row['next_expiry'])
    return None
