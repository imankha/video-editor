"""
Sharing database -- Fly Postgres for cross-user share token lookups.

Uses the same Postgres instance as auth_db.py (shared pool from pg.py).
"""

import json
import logging
import uuid
from typing import Optional

import psycopg2

from .pg import get_pg

logger = logging.getLogger(__name__)


def get_sharing_db():
    """Alias for the Postgres pool connection. Preserves caller interface."""
    return get_pg()


# ---------------------------------------------------------------------------
# Video share CRUD
# ---------------------------------------------------------------------------

def _sharer_default_sport(sharer_user_id: str) -> str | None:
    """Snapshot the sharer's default sport at share-creation time (T2915).

    Runs in the sharer's own request, where their user.sqlite is local. Frozen onto
    the share row so an invitee can inherit it -- no live cross-user read later."""
    from app.services.user_db import get_default_profile_sport
    return get_default_profile_sport(sharer_user_id)


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
    sharer_sport = _sharer_default_sport(sharer_user_id)
    with get_sharing_db() as conn:
        cur = conn.cursor()
        for email in recipient_emails:
            token = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO shares
                   (share_token, share_type, sharer_user_id, sharer_profile_id,
                    recipient_email, sharer_default_sport)
                   VALUES (%s, 'video', %s, %s, %s, %s)
                   RETURNING id""",
                (token, sharer_user_id, sharer_profile_id,
                 email.lower().strip(), sharer_sport),
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
# Collection share CRUD (T3620) -- a (scope, filter, ratio) definition stored
# in shares.collection_definition (JSONB) + collection_is_public, evaluated live
# against the sharer's profile DB at view time. No detail table.
# ---------------------------------------------------------------------------

def create_collection_share(
    sharer_user_id: str,
    sharer_profile_id: str,
    recipient_email: str,
    definition: dict,
    is_public: bool,
) -> str:
    """Insert one collection share row, return its token. `definition` must
    already be canonicalized (see routers/collections.py)."""
    sharer_sport = _sharer_default_sport(sharer_user_id)
    with get_sharing_db() as conn:
        cur = conn.cursor()
        token = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO shares
               (share_token, share_type, sharer_user_id, sharer_profile_id,
                recipient_email, collection_definition, collection_is_public,
                sharer_default_sport)
               VALUES (%s, 'collection', %s, %s, %s, %s, %s, %s)""",
            (token, sharer_user_id, sharer_profile_id,
             recipient_email.lower().strip(), json.dumps(definition), is_public,
             sharer_sport),
        )
    return token


def find_collection_share(
    sharer_user_id: str,
    recipient_email: str,
    definition: dict,
    is_public: bool,
) -> Optional[str]:
    """Return the token of an existing, non-revoked collection share with the
    same canonicalized definition + visibility + recipient for this sharer, or
    None. Lets re-sharing the same card surface the existing link."""
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT share_token FROM shares
               WHERE share_type = 'collection'
                 AND sharer_user_id = %s
                 AND recipient_email = %s
                 AND collection_is_public = %s
                 AND collection_definition = %s::jsonb
                 AND revoked_at IS NULL
               ORDER BY shared_at DESC
               LIMIT 1""",
            (sharer_user_id, recipient_email.lower().strip(), is_public,
             json.dumps(definition)),
        )
        row = cur.fetchone()
        return row["share_token"] if row else None


def get_collection_share_by_token(token: str) -> Optional[dict]:
    """Fetch a collection share row (definition + visibility + sharer ids)."""
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, share_token, share_type, sharer_user_id,
                      sharer_profile_id, recipient_email, shared_at, revoked_at,
                      collection_definition, collection_is_public
               FROM shares
               WHERE share_token = %s AND share_type = 'collection'""",
            (token,),
        )
        return cur.fetchone()


# ---------------------------------------------------------------------------
# Game share CRUD (tables populated by T2830)
# ---------------------------------------------------------------------------

def create_game_share(
    game_id: int,
    tag_name: str,
    sharer_user_id: str,
    sharer_profile_id: str,
    recipient_email: str,
    game_name: Optional[str] = None,
    game_blake3: Optional[str] = None,
    first_clip_start: Optional[float] = None,
    clip_names: Optional[list[str]] = None,
    share_type: str = "game",
) -> dict:
    sharer_sport = _sharer_default_sport(sharer_user_id)
    with get_sharing_db() as conn:
        cur = conn.cursor()
        token = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO shares
               (share_token, share_type, sharer_user_id, sharer_profile_id,
                recipient_email, sharer_default_sport)
               VALUES (%s, %s, %s, %s, %s, %s)
               RETURNING id""",
            (token, share_type, sharer_user_id, sharer_profile_id,
             recipient_email.lower().strip(), sharer_sport),
        )
        share_id = cur.fetchone()["id"]
        cur.execute(
            """INSERT INTO share_games
               (share_id, game_id, tag_name, game_name, game_blake3,
                first_clip_start, clip_names)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (share_id, game_id, tag_name, game_name, game_blake3,
             first_clip_start, json.dumps(clip_names) if clip_names else None),
        )
    return {
        "share_token": token,
        "recipient_email": recipient_email.lower().strip(),
    }


def get_game_share_by_token(token: str) -> Optional[dict]:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.id, s.share_token, s.share_type, s.sharer_user_id,
                      s.sharer_profile_id, s.recipient_email, s.shared_at,
                      s.revoked_at,
                      sg.game_id, sg.tag_name, sg.recipient_profile_id,
                      sg.materialized_at,
                      sg.game_name, sg.game_blake3, sg.first_clip_start,
                      sg.clip_names
               FROM shares s
               JOIN share_games sg ON sg.share_id = s.id
               WHERE s.share_token = %s""",
            (token,),
        )
        return cur.fetchone()


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
    clip_data_bytes: bytes,
) -> int | None:
    with get_sharing_db() as conn:
        cur = conn.cursor()
        try:
            cur.execute(
                """INSERT INTO pending_teammate_shares
                   (share_id, sharer_user_id, sharer_profile_id, recipient_email,
                    game_id, tag_name, clip_data)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (share_id, sharer_user_id, sharer_profile_id,
                 recipient_email.lower().strip(), game_id, tag_name,
                 psycopg2.Binary(clip_data_bytes)),
            )
            return cur.fetchone()["id"]
        except Exception as e:
            if "unique" in str(e).lower() or "duplicate" in str(e).lower():
                conn.rollback()
                logger.info(f"[share-pending] Duplicate pending share skipped: share_id={share_id} game={game_id} tag={tag_name}")
                return None
            raise


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


# ---------------------------------------------------------------------------
# Share table retention / cleanup (T2847)
# ---------------------------------------------------------------------------

def cleanup_resolved_pending_shares(days: int = 90) -> int:
    """Delete pending_teammate_shares that were resolved more than `days` ago."""
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """DELETE FROM pending_teammate_shares
               WHERE resolved_at IS NOT NULL
               AND resolved_at < now() - interval '%s days'""",
            (days,),
        )
        count = cur.rowcount
        logger.info(f"[share-cleanup] Deleted {count} resolved pending shares older than {days}d")
        return count


def expire_stale_pending_shares(days: int = 180) -> int:
    """Mark unresolved pending shares older than `days` as expired."""
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE pending_teammate_shares
               SET resolved_at = now(), resolved_profile_id = 'expired'
               WHERE created_at < now() - interval '%s days'
               AND resolved_at IS NULL""",
            (days,),
        )
        count = cur.rowcount
        logger.info(f"[share-cleanup] Expired {count} stale pending shares older than {days}d")
        return count


def cleanup_old_shares(days: int = 365) -> int:
    """Delete fully-consumed shares older than `days`."""
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """DELETE FROM shares
               WHERE id IN (
                   SELECT s.id FROM shares s
                   JOIN share_games sg ON sg.share_id = s.id
                   WHERE s.share_type = 'game'
                   AND sg.materialized_at IS NOT NULL
                   AND s.shared_at < now() - interval '%s days'
               )
               OR (
                   share_type = 'video'
                   AND shared_at < now() - interval '%s days'
               )""",
            (days, days),
        )
        count = cur.rowcount
        logger.info(f"[share-cleanup] Deleted {count} old shares older than {days}d")
        return count


# ---------------------------------------------------------------------------
# Referral attribution (T2910)
# ---------------------------------------------------------------------------

SHARE_TYPE_TO_CHANNEL = {
    "video": "reel_share",
    "game": "game_share",
    "annotation_playback": "annotation_share",
    "collection": "collection_share",
}


def record_referral(
    referrer_id: str, referred_id: str, channel: str, source_id: str | None = None,
    inherited_sport: str | None = None,
) -> bool:
    """Insert a referral row. Returns True if inserted, False if already attributed.

    inherited_sport is the snapshot of the inviter's default-profile sport, captured
    in the inviter's own context at invite-link creation and carried here on the link
    (T2915). It freezes onto the referral event -- it is never re-read from the inviter.
    """
    if referrer_id == referred_id:
        return False
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO referrals (referrer_id, referred_id, channel, source_id, inherited_sport)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (referred_id) DO NOTHING""",
            (referrer_id, referred_id, channel, source_id, inherited_sport),
        )
        inserted = cur.rowcount > 0
        if inserted:
            logger.info(f"[referral] {referrer_id} -> {referred_id} via {channel}"
                        + (f" (sport={inherited_sport})" if inherited_sport else ""))
        return inserted


def resolve_invite_code(invite_code: str) -> str | None:
    """Look up user_id by invite_code. Returns user_id or None."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM users WHERE invite_code = %s", (invite_code,))
        row = cur.fetchone()
        return row["user_id"] if row else None


def persist_invite_code(user_id: str, invite_code: str) -> None:
    """Store invite_code on the users row (no-op if already set)."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET invite_code = %s WHERE user_id = %s AND invite_code IS NULL",
            (invite_code, user_id),
        )


# ---------------------------------------------------------------------------
# Sport inheritance through invite (T2915)
# ---------------------------------------------------------------------------

def get_inherited_sport(referred_id: str) -> str | None:
    """The sport snapshot captured on a referred user's referral row, or None.

    This is the inviter's default sport as of when they created the invite link
    (carried on the link, frozen at signup by record_referral). It is read straight
    off the referral event -- no cross-user lookup, no live mirror."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT inherited_sport FROM referrals WHERE referred_id = %s", (referred_id,))
        row = cur.fetchone()
        return row["inherited_sport"] if row and row["inherited_sport"] else None


def attribute_from_existing_shares(user_id: str, email: str) -> bool:
    """Attribute a new user to their earliest sharer, if any shares exist for their email.

    Covers gallery/reel shares and any other share types that don't go through
    pending_teammate_shares. Uses the earliest share as the attribution source.
    """
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT sharer_user_id, share_type, id, sharer_default_sport
               FROM shares
               WHERE recipient_email = %s
               ORDER BY shared_at ASC
               LIMIT 1""",
            (email,),
        )
        row = cur.fetchone()
    if not row:
        return False
    channel = SHARE_TYPE_TO_CHANNEL.get(row["share_type"])
    if not channel:
        return False
    return record_referral(row["sharer_user_id"], user_id, channel, str(row["id"]),
                           inherited_sport=row["sharer_default_sport"])
