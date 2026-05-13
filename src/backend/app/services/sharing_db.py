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
# Video share CRUD
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
                """INSERT INTO shares
                   (share_token, share_type, sharer_user_id, sharer_profile_id,
                    recipient_email)
                   VALUES (%s, 'video', %s, %s, %s)
                   RETURNING id""",
                (token, sharer_user_id, sharer_profile_id,
                 email.lower().strip()),
            )
            share_id = cur.fetchone()["id"]
            cur.execute(
                """INSERT INTO share_videos
                   (share_id, video_id, video_filename, video_name, video_duration, is_public)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (share_id, video_id, video_filename, video_name, video_duration, is_public),
            )
            shares.append({
                "share_token": token,
                "recipient_email": email.lower().strip(),
            })
    return shares


def get_share_by_token(token: str) -> Optional[dict]:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.*, sv.video_id, sv.video_filename, sv.video_name,
                      sv.video_duration, sv.is_public
               FROM shares s
               LEFT JOIN share_videos sv ON sv.share_id = s.id
               WHERE s.share_token = %s""",
            (token,),
        )
        return cur.fetchone()


def list_shares_for_video(video_id: int, sharer_user_id: str) -> list[dict]:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.*, sv.video_id, sv.video_filename, sv.video_name,
                      sv.video_duration, sv.is_public
               FROM shares s
               JOIN share_videos sv ON sv.share_id = s.id
               WHERE sv.video_id = %s AND s.sharer_user_id = %s
               ORDER BY s.shared_at DESC""",
            (video_id, sharer_user_id),
        )
        return [dict(r) for r in cur.fetchall()]


def update_share_visibility(token: str, is_public: bool, sharer_user_id: str) -> bool:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE share_videos SET is_public = %s
               FROM shares
               WHERE share_videos.share_id = shares.id
               AND shares.share_token = %s
               AND shares.sharer_user_id = %s
               AND shares.revoked_at IS NULL""",
            (is_public, token, sharer_user_id),
        )
        return cur.rowcount > 0


def list_contacts_for_user(sharer_user_id: str) -> list[str]:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT recipient_email, COUNT(*) as times_shared,
                      MAX(shared_at) as last_shared
               FROM shares
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
            """UPDATE shares SET revoked_at = now()
               WHERE share_token = %s AND sharer_user_id = %s AND revoked_at IS NULL""",
            (token, sharer_user_id),
        )
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Game share CRUD (tables populated by T2830)
# ---------------------------------------------------------------------------

def create_game_share(
    game_id: int,
    tag_name: str,
    sharer_user_id: str,
    sharer_profile_id: str,
    recipient_email: str,
) -> dict:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        token = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO shares
               (share_token, share_type, sharer_user_id, sharer_profile_id,
                recipient_email)
               VALUES (%s, 'game', %s, %s, %s)
               RETURNING id""",
            (token, sharer_user_id, sharer_profile_id,
             recipient_email.lower().strip()),
        )
        share_id = cur.fetchone()["id"]
        cur.execute(
            """INSERT INTO share_games
               (share_id, game_id, tag_name)
               VALUES (%s, %s, %s)""",
            (share_id, game_id, tag_name),
        )
    return {
        "share_token": token,
        "recipient_email": recipient_email.lower().strip(),
    }


def list_shares_for_game(game_id: int, sharer_user_id: str) -> list[dict]:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.*, sg.game_id, sg.tag_name,
                      sg.recipient_profile_id, sg.materialized_at
               FROM shares s
               JOIN share_games sg ON sg.share_id = s.id
               WHERE sg.game_id = %s AND s.sharer_user_id = %s
               ORDER BY s.shared_at DESC""",
            (game_id, sharer_user_id),
        )
        return [dict(r) for r in cur.fetchall()]


def mark_game_share_materialized(
    share_id: int,
    recipient_profile_id: str,
) -> bool:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE share_games
               SET materialized_at = now(), recipient_profile_id = %s
               WHERE share_id = %s AND materialized_at IS NULL""",
            (recipient_profile_id, share_id),
        )
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Pending teammate shares (multi-profile / non-user recipients)
# ---------------------------------------------------------------------------

def create_pending_share(
    share_id: int,
    sharer_user_id: str,
    sharer_profile_id: str,
    recipient_email: str,
    game_id: int,
    tag_name: str,
    clip_data_json: str,
) -> int:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO pending_teammate_shares
               (share_id, sharer_user_id, sharer_profile_id, recipient_email,
                game_id, tag_name, clip_data)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               RETURNING id""",
            (share_id, sharer_user_id, sharer_profile_id,
             recipient_email.lower().strip(), game_id, tag_name, clip_data_json),
        )
        return cur.fetchone()["id"]


def get_pending_shares_for_email(email: str) -> list[dict]:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, share_id, sharer_user_id, sharer_profile_id,
                      recipient_email, game_id, tag_name, clip_data, created_at
               FROM pending_teammate_shares
               WHERE recipient_email = %s AND resolved_at IS NULL
               ORDER BY created_at""",
            (email.lower().strip(),),
        )
        return [dict(r) for r in cur.fetchall()]


def resolve_pending_share(pending_id: int, profile_id: str) -> bool:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE pending_teammate_shares
               SET resolved_at = now(), resolved_profile_id = %s
               WHERE id = %s AND resolved_at IS NULL""",
            (profile_id, pending_id),
        )
        return cur.rowcount > 0
