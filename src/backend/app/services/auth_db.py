"""
Central authentication database -- Fly Postgres for cross-device auth.

Unlike per-user databases (one SQLite per user+profile), this is a shared
Postgres instance for all users. It stores:
  - users: email -> user_id mapping (user_id = R2 folder name)
  - sessions: session_id -> user_id (validates rb_session cookies)
  - otp_codes: temporary email verification codes (T401)
  - admin_users, impersonation_audit, game_storage_refs, r2_grace_deletions
  - shares, share_videos, share_games, pending_teammate_shares (via sharing_db.py, same Postgres)
"""

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from .pg import get_pg

logger = logging.getLogger(__name__)


def get_auth_db():
    """Alias for the Postgres pool connection. Preserves caller interface."""
    return get_pg()


# ---------------------------------------------------------------------------
# User operations
# ---------------------------------------------------------------------------

def get_user_by_email(email: str) -> Optional[dict]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, email, google_id, verified_at, created_at FROM users WHERE email = %s",
            (email,),
        )
        return cur.fetchone()


def get_user_by_google_id(google_id: str) -> Optional[dict]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, email, google_id, verified_at, created_at FROM users WHERE google_id = %s",
            (google_id,),
        )
        return cur.fetchone()


def get_user_by_id(user_id: str) -> Optional[dict]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, email, google_id, verified_at, created_at, picture_url, terms_accepted_at FROM users WHERE user_id = %s",
            (user_id,),
        )
        return cur.fetchone()


def create_user(
    user_id: str,
    email: Optional[str] = None,
    google_id: Optional[str] = None,
    verified_at: Optional[str] = None,
) -> dict:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (user_id, email, google_id, verified_at) VALUES (%s, %s, %s, %s)",
            (user_id, email, google_id, verified_at),
        )

    logger.info(f"[AuthDB] Created user: {user_id} email={email}")
    return {"user_id": user_id, "email": email, "google_id": google_id}


def link_google_to_user(user_id: str, email: str, google_id: str) -> None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET email = %s, google_id = %s, verified_at = now() WHERE user_id = %s",
            (email, google_id, user_id),
        )
    logger.info(f"[AuthDB] Linked Google to user {user_id}: {email}")


def link_email_to_user(user_id: str, email: str) -> None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET email = %s, verified_at = now() WHERE user_id = %s",
            (email, user_id),
        )
    logger.info(f"[AuthDB] Linked email to user {user_id}: {email}")


def update_picture_url(user_id: str, picture_url: str) -> None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET picture_url = %s WHERE user_id = %s",
            (picture_url, user_id),
        )


def update_last_seen(user_id: str) -> None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET last_seen_at = now() WHERE user_id = %s",
            (user_id,),
        )


def generate_user_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Session operations
# ---------------------------------------------------------------------------

def create_session(user_id: str, ttl_days: int = 30) -> str:
    session_id = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=ttl_days)

    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO sessions (session_id, user_id, expires_at) VALUES (%s, %s, %s)",
            (session_id, user_id, expires_at),
        )

    logger.info(f"[AuthDB] Created session for user {user_id}, expires {expires_at.isoformat()}")
    return session_id


def validate_session(session_id: str) -> Optional[dict]:
    """Validate a session cookie. Returns {user_id, email, ...} or None.

    T1510: if the session has impersonation_expires_at set and it has
    passed, the session is treated as expired and an 'expire' audit row is
    written.
    """
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.session_id, s.user_id, s.expires_at,
                      s.impersonator_user_id, s.impersonation_expires_at,
                      u.email
               FROM sessions s
               JOIN users u ON s.user_id = u.user_id
               WHERE s.session_id = %s AND s.expires_at > now()""",
            (session_id,),
        )
        row = cur.fetchone()

    if not row:
        return None

    user_id = row["user_id"]
    email = row["email"]
    impersonator_user_id = row["impersonator_user_id"]
    impersonation_expires_at = row["impersonation_expires_at"]

    # T1510: impersonation TTL enforcement
    if impersonator_user_id and impersonation_expires_at:
        if impersonation_expires_at < datetime.now(timezone.utc):
            try:
                log_impersonation(impersonator_user_id, user_id, "expire", None, None)
            except Exception:
                logger.exception("[AuthDB] Failed to write impersonation expire audit")
            invalidate_session(session_id)
            return None

    result = {"user_id": user_id, "email": email}
    if impersonator_user_id:
        imp_email = None
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT email FROM users WHERE user_id = %s", (impersonator_user_id,))
            imp_row = cur.fetchone()
            if imp_row:
                imp_email = imp_row["email"]
        result["impersonator_user_id"] = impersonator_user_id
        result["impersonator_email"] = imp_email
        result["impersonation_expires_at"] = impersonation_expires_at
    return result


def invalidate_session(session_id: str) -> None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM sessions WHERE session_id = %s", (session_id,))


def invalidate_user_sessions(user_id: str) -> None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))


def cleanup_expired_sessions() -> int:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM sessions WHERE expires_at < now()")
        count = cur.rowcount
    if count > 0:
        logger.info(f"[AuthDB] Cleaned up {count} expired sessions")
    return count


# ---------------------------------------------------------------------------
# Admin operations (T550)
# ---------------------------------------------------------------------------

def is_admin(user_id: str) -> bool:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email FROM users WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
        if not row or not row["email"]:
            return False
        cur.execute("SELECT 1 FROM admin_users WHERE email = %s", (row["email"],))
        return cur.fetchone() is not None


def get_admin_emails() -> list[str]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email FROM admin_users")
        return [row["email"] for row in cur.fetchall()]


def get_all_users_for_admin() -> list:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT user_id, email, credit_summary as credits, created_at, last_seen_at
               FROM users
               ORDER BY created_at DESC"""
        )
        return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# T1510: Impersonation
# ---------------------------------------------------------------------------

IMPERSONATION_TTL_MINUTES = 60


def create_impersonation_session(
    target_user_id: str,
    impersonator_user_id: str,
    ttl_minutes: int = IMPERSONATION_TTL_MINUTES,
) -> str:
    session_id = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=30)
    impersonation_expires_at = now + timedelta(minutes=ttl_minutes)

    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO sessions
                  (session_id, user_id, expires_at,
                   impersonator_user_id, impersonation_expires_at)
               VALUES (%s, %s, %s, %s, %s)""",
            (session_id, target_user_id, expires_at,
             impersonator_user_id, impersonation_expires_at),
        )

    logger.info(
        f"[AuthDB][T1510] Impersonation session created: "
        f"admin={impersonator_user_id} target={target_user_id} "
        f"expires={impersonation_expires_at.isoformat()}"
    )
    return session_id


def find_or_create_admin_restore_session(admin_user_id: str) -> str:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT session_id FROM sessions
               WHERE user_id = %s
                 AND impersonator_user_id IS NULL
                 AND expires_at > now()
               ORDER BY created_at DESC LIMIT 1""",
            (admin_user_id,),
        )
        row = cur.fetchone()
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
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO impersonation_audit
                  (admin_user_id, target_user_id, action, ip, user_agent)
               VALUES (%s, %s, %s, %s, %s)""",
            (admin_user_id, target_user_id, action, ip, user_agent),
        )


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
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO game_storage_refs
                  (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (user_id, profile_id, blake3_hash)
               DO UPDATE SET game_size_bytes = EXCLUDED.game_size_bytes,
                             storage_expires_at = EXCLUDED.storage_expires_at""",
            (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at),
        )
        cur.execute(
            "DELETE FROM r2_grace_deletions WHERE blake3_hash = %s",
            (blake3_hash,),
        )


def get_game_storage_ref(
    user_id: str, profile_id: str, blake3_hash: str
) -> Optional[dict]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT storage_expires_at, game_size_bytes, created_at
               FROM game_storage_refs
               WHERE user_id = %s AND profile_id = %s AND blake3_hash = %s""",
            (user_id, profile_id, blake3_hash),
        )
        return cur.fetchone()


def get_storage_refs_for_user(user_id: str) -> list[dict]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT blake3_hash, storage_expires_at, game_size_bytes
               FROM game_storage_refs
               WHERE user_id = %s""",
            (user_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def get_expired_refs() -> list[dict]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT user_id, profile_id, blake3_hash
               FROM game_storage_refs
               WHERE storage_expires_at < now()"""
        )
        return [dict(r) for r in cur.fetchall()]


def delete_ref(user_id: str, profile_id: str, blake3_hash: str) -> None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """DELETE FROM game_storage_refs
               WHERE user_id = %s AND profile_id = %s AND blake3_hash = %s""",
            (user_id, profile_id, blake3_hash),
        )


def has_remaining_refs(blake3_hash: str) -> bool:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) as cnt FROM game_storage_refs WHERE blake3_hash = %s",
            (blake3_hash,),
        )
        return cur.fetchone()["cnt"] > 0


def get_all_ref_hashes() -> set[str]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT blake3_hash FROM game_storage_refs")
        return {r["blake3_hash"] for r in cur.fetchall()}


def get_next_expiry() -> Optional[datetime]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT MIN(storage_expires_at) as next_expiry
               FROM game_storage_refs
               WHERE storage_expires_at > now()"""
        )
        ref_row = cur.fetchone()
        cur.execute("SELECT MIN(grace_expires_at) as next_expiry FROM r2_grace_deletions")
        grace_row = cur.fetchone()

    candidates = []
    if ref_row and ref_row["next_expiry"]:
        candidates.append(ref_row["next_expiry"])
    if grace_row and grace_row["next_expiry"]:
        candidates.append(grace_row["next_expiry"])
    return min(candidates) if candidates else None


# ---------------------------------------------------------------------------
# T2400: Grace period before permanent R2 deletion
# ---------------------------------------------------------------------------

def insert_grace_deletion(blake3_hash: str, grace_days: int = 14) -> None:
    grace_expires_at = datetime.now(timezone.utc) + timedelta(days=grace_days)
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO r2_grace_deletions (blake3_hash, grace_expires_at)
               VALUES (%s, %s)
               ON CONFLICT DO NOTHING""",
            (blake3_hash, grace_expires_at),
        )


def get_expired_grace_deletions() -> list[str]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT blake3_hash FROM r2_grace_deletions WHERE grace_expires_at < now()")
        return [r["blake3_hash"] for r in cur.fetchall()]


def get_grace_deletion_hashes() -> set[str]:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT blake3_hash FROM r2_grace_deletions")
        return {r["blake3_hash"] for r in cur.fetchall()}


def delete_grace_deletion(blake3_hash: str) -> None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM r2_grace_deletions WHERE blake3_hash = %s",
            (blake3_hash,),
        )
