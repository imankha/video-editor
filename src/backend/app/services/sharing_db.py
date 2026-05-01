"""
Sharing database -- global SQLite for cross-user share token lookups.

Unlike per-user databases (one SQLite per user+profile), this is a SINGLE
database shared by all users. It stores:
  - shared_videos: share_token -> video metadata + access control

Sync strategy (mirrors auth_db.py):
  - Read from R2 on server startup
  - Write to R2 immediately after share creation / revocation

Temporary: T1960 will migrate this to Upstash Redis alongside auth.sqlite.
"""

import logging
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_SHARING_DB_DIR = Path(__file__).parent.parent.parent.parent.parent / "user_data"
SHARING_DB_PATH = _SHARING_DB_DIR / "sharing.sqlite"

SHARING_DB_R2_KEY_SUFFIX = "sharing/sharing.sqlite"


def _get_sharing_db_r2_key() -> str:
    from ..storage import APP_ENV
    return f"{APP_ENV}/{SHARING_DB_R2_KEY_SUFFIX}"


def _get_connection() -> sqlite3.Connection:
    SHARING_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(SHARING_DB_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


@contextmanager
def get_sharing_db():
    conn = _get_connection()
    try:
        yield conn
    finally:
        conn.close()


def init_sharing_db():
    SHARING_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_sharing_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS shared_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                share_token TEXT UNIQUE NOT NULL,
                video_id INTEGER NOT NULL,
                sharer_user_id TEXT NOT NULL,
                sharer_profile_id TEXT NOT NULL,
                video_filename TEXT NOT NULL,
                video_name TEXT,
                video_duration REAL,
                recipient_email TEXT NOT NULL,
                is_public INTEGER DEFAULT 0,
                shared_at TEXT NOT NULL,
                revoked_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_shared_videos_token
                ON shared_videos(share_token);
            CREATE INDEX IF NOT EXISTS idx_shared_videos_video
                ON shared_videos(video_id, sharer_user_id);
            CREATE INDEX IF NOT EXISTS idx_shared_videos_sharer
                ON shared_videos(sharer_user_id);
            CREATE INDEX IF NOT EXISTS idx_shared_videos_recipient
                ON shared_videos(recipient_email);
        """)
        db.commit()
    logger.info("[SharingDB] Tables initialized")


# ---------------------------------------------------------------------------
# R2 sync (backup/restore)
# ---------------------------------------------------------------------------

def _r2_enabled() -> bool:
    from ..storage import R2_ENABLED
    return bool(R2_ENABLED)


def sync_sharing_db_from_r2() -> bool:
    from ..storage import get_r2_client, R2_BUCKET

    if not _r2_enabled():
        return False

    client = get_r2_client()
    if not client:
        return False

    key = _get_sharing_db_r2_key()
    try:
        from ..utils.retry import retry_r2_call, TIER_1
        SHARING_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        retry_r2_call(
            client.download_file, R2_BUCKET, key, str(SHARING_DB_PATH),
            operation="sharing_db_restore", **TIER_1,
        )
        logger.info(f"[SharingDB] Restored from R2: {key}")
        return True
    except client.exceptions.ClientError as e:
        if e.response['Error']['Code'] == '404':
            logger.info("[SharingDB] No backup in R2 -- starting fresh")
            return False
        logger.error(f"[SharingDB] R2 ClientError during restore: {e}")
        raise


def restore_sharing_db_or_fail() -> None:
    if not _r2_enabled():
        logger.info("[SharingDB] R2 disabled -- skipping restore, using local DB")
        init_sharing_db()
        return

    max_attempts = 3
    base_delay = 1.0
    last_exc: Optional[BaseException] = None

    for attempt in range(1, max_attempts + 1):
        try:
            sync_sharing_db_from_r2()
            init_sharing_db()
            return
        except Exception as e:
            last_exc = e
            if attempt < max_attempts:
                delay = base_delay * (2 ** (attempt - 1))
                logger.warning(
                    f"[SharingDB] Restore attempt {attempt}/{max_attempts} "
                    f"failed: {type(e).__name__}: {e} -- retrying in {delay:.1f}s"
                )
                import time as _time
                _time.sleep(delay)
            else:
                logger.error(
                    f"[SharingDB] Restore attempt {attempt}/{max_attempts} "
                    f"failed: {type(e).__name__}: {e} -- giving up"
                )

    raise RuntimeError(
        f"sharing DB restore from R2 failed after {max_attempts} attempts; "
        f"refusing to start with an empty sharing DB. Last error: "
        f"{type(last_exc).__name__}: {last_exc}"
    )


def sync_sharing_db_to_r2() -> bool:
    from ..storage import R2_ENABLED, get_r2_client, R2_BUCKET

    if not R2_ENABLED:
        return False

    if not SHARING_DB_PATH.exists():
        return False

    client = get_r2_client()
    if not client:
        return False

    key = _get_sharing_db_r2_key()
    try:
        conn = sqlite3.connect(str(SHARING_DB_PATH))
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()

        from ..utils.retry import retry_r2_call, TIER_1
        retry_r2_call(
            client.upload_file, str(SHARING_DB_PATH), R2_BUCKET, key,
            operation="sharing_db_backup", **TIER_1,
        )
        logger.info(f"[SharingDB] Backed up to R2: {key}")
        return True
    except Exception as e:
        logger.error(f"[SharingDB] Failed to backup to R2: {e}")
        return False


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------

def create_shares(
    video_id: int,
    sharer_user_id: str,
    sharer_profile_id: str,
    video_filename: str,
    video_name: Optional[str],
    video_duration: Optional[float],
    recipient_emails: list[str],
    is_public: bool,
) -> list[dict]:
    now = datetime.utcnow().isoformat()
    shares = []
    with get_sharing_db() as db:
        for email in recipient_emails:
            token = str(uuid.uuid4())
            db.execute(
                """INSERT INTO shared_videos
                   (share_token, video_id, sharer_user_id, sharer_profile_id,
                    video_filename, video_name, video_duration,
                    recipient_email, is_public, shared_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (token, video_id, sharer_user_id, sharer_profile_id,
                 video_filename, video_name, video_duration,
                 email.lower().strip(), 1 if is_public else 0, now),
            )
            shares.append({
                "share_token": token,
                "recipient_email": email.lower().strip(),
            })
        db.commit()
    sync_sharing_db_to_r2()
    return shares


def get_share_by_token(token: str) -> Optional[dict]:
    with get_sharing_db() as db:
        row = db.execute(
            "SELECT * FROM shared_videos WHERE share_token = ?", (token,)
        ).fetchone()
        return dict(row) if row else None


def list_shares_for_video(video_id: int, sharer_user_id: str) -> list[dict]:
    with get_sharing_db() as db:
        rows = db.execute(
            """SELECT * FROM shared_videos
               WHERE video_id = ? AND sharer_user_id = ?
               ORDER BY shared_at DESC""",
            (video_id, sharer_user_id),
        ).fetchall()
        return [dict(r) for r in rows]


def update_share_visibility(token: str, is_public: bool, sharer_user_id: str) -> bool:
    with get_sharing_db() as db:
        result = db.execute(
            """UPDATE shared_videos SET is_public = ?
               WHERE share_token = ? AND sharer_user_id = ? AND revoked_at IS NULL""",
            (1 if is_public else 0, token, sharer_user_id),
        )
        db.commit()
    if result.rowcount > 0:
        sync_sharing_db_to_r2()
        return True
    return False


def list_contacts_for_user(sharer_user_id: str) -> list[str]:
    with get_sharing_db() as db:
        rows = db.execute(
            """SELECT recipient_email, COUNT(*) as times_shared,
                      MAX(shared_at) as last_shared
               FROM shared_videos
               WHERE sharer_user_id = ? AND revoked_at IS NULL
               GROUP BY recipient_email
               ORDER BY times_shared DESC, last_shared DESC
               LIMIT 20""",
            (sharer_user_id,),
        ).fetchall()
        return [row["recipient_email"] for row in rows]


def revoke_share(token: str, sharer_user_id: str) -> bool:
    now = datetime.utcnow().isoformat()
    with get_sharing_db() as db:
        result = db.execute(
            """UPDATE shared_videos SET revoked_at = ?
               WHERE share_token = ? AND sharer_user_id = ? AND revoked_at IS NULL""",
            (now, token, sharer_user_id),
        )
        db.commit()
    if result.rowcount > 0:
        sync_sharing_db_to_r2()
        return True
    return False
