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
from datetime import UTC, datetime, timedelta

from app.user_context import get_current_impersonator_id

from .pg import get_pg

logger = logging.getLogger(__name__)


def get_auth_db():
    """Alias for the Postgres pool connection. Preserves caller interface."""
    return get_pg()


# ---------------------------------------------------------------------------
# User operations
# ---------------------------------------------------------------------------

def get_user_by_email(email: str) -> dict | None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, email, google_id, verified_at, created_at FROM users WHERE email = %s",
            (email,),
        )
        return cur.fetchone()


def get_user_by_google_id(google_id: str) -> dict | None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, email, google_id, verified_at, created_at FROM users WHERE google_id = %s",
            (google_id,),
        )
        return cur.fetchone()


def get_user_by_id(user_id: str) -> dict | None:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, email, google_id, verified_at, created_at, picture_url, terms_accepted_at FROM users WHERE user_id = %s",
            (user_id,),
        )
        return cur.fetchone()


def create_user(
    user_id: str,
    email: str | None = None,
    google_id: str | None = None,
    verified_at: str | None = None,
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
    # T7530: don't attribute admin impersonation to the target user's activity.
    # Mirrors the T1515 guard in analytics.update_session (which keeps
    # user_segments.last_active_at clean on this same request path).
    impersonator = get_current_impersonator_id()
    if impersonator:
        logger.debug("[AuthDB] Skipped last_seen update for %s during impersonation by %s", user_id, impersonator)
        return
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
    expires_at = datetime.now(UTC) + timedelta(days=ttl_days)

    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO sessions (session_id, user_id, expires_at) VALUES (%s, %s, %s)",
            (session_id, user_id, expires_at),
        )

    logger.info(f"[AuthDB] Created session for user {user_id}, expires {expires_at.isoformat()}")
    return session_id


def validate_session(session_id: str) -> dict | None:
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
                      u.email, u.picture_url, u.terms_accepted_at
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
    if (
        impersonator_user_id
        and impersonation_expires_at
        and impersonation_expires_at < datetime.now(UTC)
    ):
        try:
            log_impersonation(impersonator_user_id, user_id, "expire", None, None)
        except Exception:
            logger.exception("[AuthDB] Failed to write impersonation expire audit")
        invalidate_session(session_id)
        return None

    result = {
        "user_id": user_id,
        "email": email,
        "picture_url": row.get("picture_url"),
        "terms_accepted_at": row.get("terms_accepted_at"),
    }
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
            """SELECT user_id, email, created_at, last_seen_at
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
    now = datetime.now(UTC)
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
    ip: str | None,
    user_agent: str | None,
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
# T2930: Game storage — per-user expiry in SQLite, global ref counts in Postgres
# ---------------------------------------------------------------------------

def expire_game_storage(blake3_hash: str) -> int:
    """Mark a game_storage entry as expired in the current profile.

    Sets storage_expires_at to a past sentinel so _compute_storage_status
    returns 'expired' on next read.  Returns the number of rows updated (0 if
    no row exists for this hash — a no-op in that case).

    Called by the sweep Phase 2 after R2 deletion to expire any lingering refs
    that Phase 1 didn't clean up (e.g. future-expiry refs from the bug 27p class
    of issue, or refs created after Phase 1 ran).
    """
    from ..database import get_db_connection

    _PAST = "2000-01-01T00:00:00+00:00"
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE game_storage SET storage_expires_at = ? WHERE blake3_hash = ?",
            (_PAST, blake3_hash),
        )
        rows_updated = cursor.rowcount
        conn.commit()
    return rows_updated


def insert_game_storage_ref(
    user_id: str,
    profile_id: str,
    blake3_hash: str,
    game_size_bytes: int,
    storage_expires_at: str,
) -> None:
    """Live request-path writer (uploads, activate_game, etc.): opens its OWN
    SQLite connection via get_db_connection(), which re-enters ensure_database().
    Safe here because the request path never already holds this profile's JIT
    migration lock. NEVER call this from inside a migration's up(conn) — that
    thread already holds the lock and re-entering deadlocks it (T8190). A
    migration already has a connection to the DB being migrated: pair
    `upsert_game_storage_row(conn, ...)` (using that connection) with
    `insert_game_storage_ref_pg_only(...)` instead.
    """
    from ..database import get_db_connection

    with get_db_connection() as conn:
        upsert_game_storage_row(conn, blake3_hash, game_size_bytes, storage_expires_at)
        conn.commit()

    insert_game_storage_ref_pg_only(user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)


def upsert_game_storage_row(
    conn,
    blake3_hash: str,
    game_size_bytes: int,
    storage_expires_at: str,
) -> None:
    """SQLite half of insert_game_storage_ref, using a connection the CALLER
    already owns (T8190). `conn` accepts either a raw `sqlite3.Connection`
    (a migration's own `up(conn)`) or a `TrackedConnection` (the request
    path) — both expose `.cursor()`. Migrations call this with their own
    `up(conn)` connection instead of insert_game_storage_ref/get_db_connection,
    which would re-enter the JIT seam lock this thread already holds. Does not
    commit — the caller controls the transaction."""
    cursor = conn.cursor()
    cursor.execute(
        """INSERT OR IGNORE INTO game_storage
           (blake3_hash, game_size_bytes, storage_expires_at)
           VALUES (?, ?, ?)""",
        (blake3_hash, game_size_bytes, storage_expires_at),
    )
    is_new = cursor.rowcount == 1
    if not is_new:
        cursor.execute(
            """UPDATE game_storage
               SET game_size_bytes = ?, storage_expires_at = ?
               WHERE blake3_hash = ?""",
            (game_size_bytes, storage_expires_at, blake3_hash),
        )


def insert_game_storage_ref_pg_only(
    user_id: str,
    profile_id: str,
    blake3_hash: str,
    game_size_bytes: int,
    storage_expires_at: str,
) -> None:
    """Postgres half of insert_game_storage_ref — touches no SQLite, so it is
    safe to call from inside a migration's up(conn) without re-entering the
    JIT seam (T8190). Pair with upsert_game_storage_row(conn, ...) for the
    SQLite side, using the migration's own connection."""
    with get_pg() as pg_conn:
        cur = pg_conn.cursor()
        # T6770: game_storage_refs is the derived ref-set -- one row per
        # (user, profile, hash), keyed on the actual pair rather than gated on
        # SQLite row novelty (the old is_new gate could leave this row
        # permanently missing if a prior PG write was lost -- see
        # T6770-design.md §1, the 2026-08-11 missing-row finding).
        cur.execute(
            """INSERT INTO game_storage_refs
                   (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (user_id, profile_id, blake3_hash) DO UPDATE
                   SET storage_expires_at = GREATEST(
                           game_storage_refs.storage_expires_at, EXCLUDED.storage_expires_at),
                       game_size_bytes = EXCLUDED.game_size_bytes""",
            (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at),
        )
        cur.execute(
            "DELETE FROM r2_grace_deletions WHERE blake3_hash = %s",
            (blake3_hash,),
        )


def get_game_storage_ref(
    user_id: str, profile_id: str, blake3_hash: str
) -> dict | None:
    from ..database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        row = cursor.execute(
            """SELECT storage_expires_at, game_size_bytes, created_at
               FROM game_storage WHERE blake3_hash = ?""",
            (blake3_hash,),
        ).fetchone()
        if row:
            return {"storage_expires_at": row["storage_expires_at"],
                    "game_size_bytes": row["game_size_bytes"],
                    "created_at": row["created_at"]}
        return None


def get_storage_refs_for_user(user_id: str) -> list[dict]:
    from ..database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        rows = cursor.execute(
            "SELECT blake3_hash, storage_expires_at, game_size_bytes FROM game_storage"
        ).fetchall()
        return [{"blake3_hash": r["blake3_hash"],
                 "storage_expires_at": r["storage_expires_at"],
                 "game_size_bytes": r["game_size_bytes"]} for r in rows]


def get_expired_refs_for_profile() -> list[dict]:
    """Get expired storage refs for the current profile (SQLite)."""
    from ..database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        rows = cursor.execute(
            "SELECT blake3_hash FROM game_storage WHERE storage_expires_at < datetime('now')"
        ).fetchall()
        return [{"blake3_hash": r["blake3_hash"]} for r in rows]


def delete_ref(user_id: str, profile_id: str, blake3_hash: str) -> None:
    """Delete this profile's ref to a game video, in both stores.

    T6770: the Postgres side is a keyed DELETE against the derived ref-set
    (game_storage_refs), not a decrement of a hand-maintained counter -- a
    double-delete or a hash whose row was already gone is simply a zero-row
    no-op, never an under-count. There is no floor to apply because there is
    no counter to drive negative (the bug that lost imankh games 2/3/5).
    """
    from ..database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM game_storage WHERE blake3_hash = ?", (blake3_hash,))
        conn.commit()

    with get_pg() as pg_conn:
        cur = pg_conn.cursor()
        cur.execute(
            "DELETE FROM game_storage_refs WHERE user_id = %s AND profile_id = %s AND blake3_hash = %s",
            (user_id, profile_id, blake3_hash),
        )


def count_refs_in_profile(blake3_hash: str) -> tuple[int, int]:
    """Count game_storage rows for a hash in the CURRENT profile (SQLite).

    Returns (total_rows, live_rows) where live_rows are refs whose
    storage_expires_at is still in the future (a profile that still wants the
    video).  Used by the sweep to verify — against the source of truth, the
    per-profile game_storage rows — that no one still holds the video before
    permanently deleting its R2 source.  Ambiguous/unparseable expiries count as
    LIVE (conservative: never let a parse failure trigger an irreversible delete).
    """
    from ..database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        rows = cursor.execute(
            "SELECT storage_expires_at FROM game_storage WHERE blake3_hash = ?",
            (blake3_hash,),
        ).fetchall()

    total = len(rows)
    live = 0
    now = datetime.now(UTC)
    for r in rows:
        exp = r["storage_expires_at"]
        if not exp:
            continue  # no expiry recorded -> treat as expired, not live
        try:
            exp_dt = datetime.fromisoformat(str(exp))
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=UTC)
            if exp_dt >= now:
                live += 1
        except (ValueError, TypeError):
            live += 1  # unparseable -> conservative: count as live
    return total, live


def has_remaining_refs(blake3_hash: str) -> bool:
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT EXISTS(SELECT 1 FROM game_storage_refs WHERE blake3_hash = %s) AS has_refs",
            (blake3_hash,),
        )
        row = cur.fetchone()
        return bool(row["has_refs"])


def get_all_ref_hashes(user_id: str | None = None) -> set[str]:
    from ..database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        rows = cursor.execute("SELECT blake3_hash FROM game_storage").fetchall()
        return {r["blake3_hash"] for r in rows}


def get_next_expiry() -> datetime | None:
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT MIN(storage_expires_at) as next_expiry FROM game_storage_refs")
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
    grace_expires_at = datetime.now(UTC) + timedelta(days=grace_days)
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
