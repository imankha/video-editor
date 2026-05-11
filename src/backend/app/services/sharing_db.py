"""
Sharing database -- Fly Postgres for cross-user share token lookups.

Uses the same Postgres instance as auth_db.py (shared pool from pg.py).
"""

import logging
import uuid
from typing import Optional

from .pg import get_pg

logger = logging.getLogger(__name__)


def get_sharing_db():
    """Alias for the Postgres pool connection. Preserves caller interface."""
    return get_pg()


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
    shares = []
    with get_sharing_db() as conn:
        cur = conn.cursor()
        for email in recipient_emails:
            token = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO shared_videos
                   (share_token, video_id, sharer_user_id, sharer_profile_id,
                    video_filename, video_name, video_duration,
                    recipient_email, is_public)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (token, video_id, sharer_user_id, sharer_profile_id,
                 video_filename, video_name, video_duration,
                 email.lower().strip(), is_public),
            )
            shares.append({
                "share_token": token,
                "recipient_email": email.lower().strip(),
            })
    return shares


def get_share_by_token(token: str) -> Optional[dict]:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM shared_videos WHERE share_token = %s", (token,))
        return cur.fetchone()


def list_shares_for_video(video_id: int, sharer_user_id: str) -> list[dict]:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT * FROM shared_videos
               WHERE video_id = %s AND sharer_user_id = %s
               ORDER BY shared_at DESC""",
            (video_id, sharer_user_id),
        )
        return [dict(r) for r in cur.fetchall()]


def update_share_visibility(token: str, is_public: bool, sharer_user_id: str) -> bool:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE shared_videos SET is_public = %s
               WHERE share_token = %s AND sharer_user_id = %s AND revoked_at IS NULL""",
            (is_public, token, sharer_user_id),
        )
        return cur.rowcount > 0


def list_contacts_for_user(sharer_user_id: str) -> list[str]:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT recipient_email, COUNT(*) as times_shared,
                      MAX(shared_at) as last_shared
               FROM shared_videos
               WHERE sharer_user_id = %s AND revoked_at IS NULL
               GROUP BY recipient_email
               ORDER BY times_shared DESC, last_shared DESC
               LIMIT 20""",
            (sharer_user_id,),
        )
        return [row["recipient_email"] for row in cur.fetchall()]


def revoke_share(token: str, sharer_user_id: str) -> bool:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE shared_videos SET revoked_at = now()
               WHERE share_token = %s AND sharer_user_id = %s AND revoked_at IS NULL""",
            (token, sharer_user_id),
        )
        return cur.rowcount > 0
