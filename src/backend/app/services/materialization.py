"""
Game + annotation materialization for teammate sharing.

Copies game references and filtered annotations from a sharer's profile SQLite
into a recipient's profile SQLite. Handles overlap merging when the recipient
already has annotations on the same game.
"""


import logging
import sqlite3
from pathlib import Path
from typing import Optional

from app.database import USER_DATA_BASE
from app.services.auth_db import insert_game_storage_ref, get_game_storage_ref
from app.services.sharing_db import mark_game_share_materialized
from app.services.pg import get_pg
from app.utils.encoding import encode_data

logger = logging.getLogger(__name__)


def _open_profile_db(user_id: str, profile_id: str) -> Optional[sqlite3.Connection]:
    """Open a profile SQLite database directly (bypasses ContextVar).
    Only opens locally-cached DBs -- does NOT download from R2."""
    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    if not db_path.exists():
        return None
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _collect_video_hashes(conn: sqlite3.Connection, game_id: int) -> list[str]:
    """Get all blake3 hashes for a game (single-video or multi-video)."""
    cur = conn.cursor()
    cur.execute("SELECT blake3_hash FROM games WHERE id = ?", (game_id,))
    game_row = cur.fetchone()
    if not game_row:
        return []

    if game_row["blake3_hash"]:
        return [game_row["blake3_hash"]]

    cur.execute(
        "SELECT blake3_hash FROM game_videos WHERE game_id = ? ORDER BY sequence",
        (game_id,),
    )
    return [r["blake3_hash"] for r in cur.fetchall()]


def _find_existing_game_by_hashes(
    conn: sqlite3.Connection, hashes: list[str]
) -> Optional[int]:
    """Find a game in the recipient's DB that shares the same video hashes."""
    if not hashes:
        return None

    cur = conn.cursor()
    if len(hashes) == 1:
        cur.execute(
            "SELECT id FROM games WHERE blake3_hash = ?", (hashes[0],)
        )
        row = cur.fetchone()
        if row:
            return row["id"]

        cur.execute(
            "SELECT game_id FROM game_videos WHERE blake3_hash = ?", (hashes[0],)
        )
        row = cur.fetchone()
        if row:
            return row["game_id"]
        return None

    # Multi-video: find a game whose game_videos hashes match exactly
    placeholders = ",".join(["?"] * len(hashes))
    cur.execute(
        f"""SELECT game_id, COUNT(*) as cnt
            FROM game_videos
            WHERE blake3_hash IN ({placeholders})
            GROUP BY game_id
            HAVING cnt = ?""",
        (*hashes, len(hashes)),
    )
    row = cur.fetchone()
    return row["game_id"] if row else None


def _copy_game(
    sharer_conn: sqlite3.Connection,
    recipient_conn: sqlite3.Connection,
    game_id: int,
) -> int:
    """Copy game + game_videos rows from sharer to recipient. Returns new game_id."""
    cur = sharer_conn.cursor()
    cur.execute(
        """SELECT name, blake3_hash, video_duration, video_width, video_height,
                  video_size, opponent_name, game_date, game_type, tournament_name,
                  video_fps
           FROM games WHERE id = ?""",
        (game_id,),
    )
    game = cur.fetchone()
    if not game:
        raise ValueError(f"Game {game_id} not found in sharer's database")

    rcur = recipient_conn.cursor()
    rcur.execute(
        """INSERT INTO games
           (name, blake3_hash, video_duration, video_width, video_height,
            video_size, opponent_name, game_date, game_type, tournament_name,
            video_fps, video_filename, clip_count, brilliant_count, good_count,
            interesting_count, mistake_count, blunder_count, aggregate_score,
            viewed_duration, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0, 0, 0, 0, 0, 0, 'ready')""",
        (
            game["name"], game["blake3_hash"], game["video_duration"],
            game["video_width"], game["video_height"], game["video_size"],
            game["opponent_name"], game["game_date"], game["game_type"],
            game["tournament_name"], game["video_fps"],
        ),
    )
    new_game_id = rcur.lastrowid

    # Copy game_videos
    cur.execute(
        """SELECT blake3_hash, sequence, duration, video_width, video_height,
                  video_size, fps
           FROM game_videos WHERE game_id = ? ORDER BY sequence""",
        (game_id,),
    )
    for vrow in cur.fetchall():
        rcur.execute(
            """INSERT INTO game_videos
               (game_id, blake3_hash, sequence, duration, video_width,
                video_height, video_size, fps)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                new_game_id, vrow["blake3_hash"], vrow["sequence"],
                vrow["duration"], vrow["video_width"], vrow["video_height"],
                vrow["video_size"], vrow["fps"],
            ),
        )

    return new_game_id


def _filter_clips_for_tag(
    conn: sqlite3.Connection, game_id: int, tag_name: str
) -> list[dict]:
    """Get raw_clips for a game filtered by tag_name via clip_teammates join."""
    cur = conn.cursor()
    cur.execute(
        """SELECT rc.id, rc.rating, rc.tags, rc.name, rc.notes,
                  rc.start_time, rc.end_time, rc.video_sequence
           FROM raw_clips rc
           JOIN clip_teammates ct ON ct.clip_id = rc.id
           WHERE rc.game_id = ? AND ct.tag_name = ?""",
        (game_id, tag_name),
    )
    return [
        {
            "rating": row["rating"],
            "tags": row["tags"],
            "name": row["name"],
            "notes": row["notes"],
            "start_time": row["start_time"],
            "end_time": row["end_time"],
            "video_sequence": row["video_sequence"],
        }
        for row in cur.fetchall()
    ]


def clips_overlap(a: dict, b: dict) -> bool:
    """Two clips overlap if video_sequence matches and time ranges intersect."""
    if a.get("video_sequence") != b.get("video_sequence"):
        return False
    a_start = a.get("start_time", 0) or 0
    a_end = a.get("end_time", 0) or 0
    b_start = b.get("start_time", 0) or 0
    b_end = b.get("end_time", 0) or 0
    return a_start < b_end and b_start < a_end


def merge_clips(existing: dict, incoming: dict) -> dict:
    """Merge two overlapping clips: earliest start, latest end, combined notes."""
    e_start = existing.get("start_time", 0) or 0
    e_end = existing.get("end_time", 0) or 0
    i_start = incoming.get("start_time", 0) or 0
    i_end = incoming.get("end_time", 0) or 0

    merged_notes_parts = []
    if existing.get("notes"):
        merged_notes_parts.append(existing["notes"])
    if incoming.get("notes"):
        merged_notes_parts.append(incoming["notes"])

    return {
        "start_time": min(e_start, i_start),
        "end_time": max(e_end, i_end),
        "name": existing.get("name") or incoming.get("name"),
        "notes": "\n".join(merged_notes_parts) if merged_notes_parts else None,
        "rating": existing.get("rating", incoming.get("rating")),
        "video_sequence": existing.get("video_sequence"),
    }


def _get_existing_clips(conn: sqlite3.Connection, game_id: int) -> list[dict]:
    """Get existing raw_clips for a game in recipient's DB."""
    cur = conn.cursor()
    cur.execute(
        """SELECT id, rating, name, notes, start_time, end_time, video_sequence
           FROM raw_clips WHERE game_id = ?""",
        (game_id,),
    )
    return [dict(r) for r in cur.fetchall()]


def _insert_clip(
    conn: sqlite3.Connection, game_id: int, clip: dict,
    shared_by: str | None = None,
) -> int:
    """Insert a raw_clip into recipient's DB. Returns new clip id."""
    tags = clip.get("tags")
    if isinstance(tags, list):
        tags = encode_data(tags) if tags else None
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO raw_clips
           (filename, rating, tags, name, notes, start_time, end_time,
            game_id, video_sequence, tagged_teammates, my_athlete, shared_by)
           VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)""",
        (
            clip.get("rating", 3),
            tags,
            clip.get("name"),
            clip.get("notes"),
            clip.get("start_time"),
            clip.get("end_time"),
            game_id,
            clip.get("video_sequence"),
            shared_by,
        ),
    )
    return cur.lastrowid


def _materialize_clips(
    recipient_conn: sqlite3.Connection,
    recipient_game_id: int,
    incoming_clips: list[dict],
    shared_by: str | None = None,
) -> dict:
    """Insert clips into recipient's DB, merging overlaps with existing clips."""
    existing = _get_existing_clips(recipient_conn, recipient_game_id)
    inserted = 0
    merged = 0

    for clip in incoming_clips:
        overlap_found = False
        for ex in existing:
            if clips_overlap(ex, clip):
                merged_data = merge_clips(ex, clip)
                cur = recipient_conn.cursor()
                cur.execute(
                    """UPDATE raw_clips
                       SET start_time = ?, end_time = ?, name = ?, notes = ?
                       WHERE id = ?""",
                    (
                        merged_data["start_time"],
                        merged_data["end_time"],
                        merged_data["name"],
                        merged_data["notes"],
                        ex["id"],
                    ),
                )
                ex["start_time"] = merged_data["start_time"]
                ex["end_time"] = merged_data["end_time"]
                ex["name"] = merged_data["name"]
                ex["notes"] = merged_data["notes"]
                overlap_found = True
                merged += 1
                break

        if not overlap_found:
            new_id = _insert_clip(recipient_conn, recipient_game_id, clip, shared_by=shared_by)
            existing.append({
                "id": new_id,
                "start_time": clip.get("start_time"),
                "end_time": clip.get("end_time"),
                "video_sequence": clip.get("video_sequence"),
                "name": clip.get("name"),
                "notes": clip.get("notes"),
                "rating": clip.get("rating"),
            })
            inserted += 1

    return {"inserted": inserted, "merged": merged}


def _create_storage_refs(
    sharer_user_id: str,
    sharer_profile_id: str,
    recipient_user_id: str,
    recipient_profile_id: str,
    hashes: list[str],
) -> None:
    """Create game_storage_refs in Postgres for the recipient."""
    for h in hashes:
        sharer_ref = get_game_storage_ref(sharer_user_id, sharer_profile_id, h)
        if sharer_ref:
            insert_game_storage_ref(
                user_id=recipient_user_id,
                profile_id=recipient_profile_id,
                blake3_hash=h,
                game_size_bytes=sharer_ref["game_size_bytes"],
                storage_expires_at=str(sharer_ref["storage_expires_at"]),
            )


def materialize_game_share(
    sharer_user_id: str,
    sharer_profile_id: str,
    recipient_user_id: str,
    recipient_profile_id: str,
    game_id: int,
    tag_name: str,
    share_id: int,
    clip_data: list[dict] | None = None,
    sharer_email: str | None = None,
) -> dict:
    """Materialize a game share into the recipient's profile.

    If clip_data is provided (from a pending share), uses that instead of
    re-querying the sharer's SQLite.

    Returns dict with keys: game_id, inserted, merged, skipped.
    """
    sharer_conn = _open_profile_db(sharer_user_id, sharer_profile_id)

    if clip_data is None:
        if sharer_conn is None:
            raise ValueError(
                f"Sharer profile DB not found: {sharer_user_id}/{sharer_profile_id}"
            )
        clip_data = _filter_clips_for_tag(sharer_conn, game_id, tag_name)

    if not clip_data:
        logger.info(
            f"[Materialize] No clips for tag '{tag_name}' in game {game_id}, skipping"
        )
        if sharer_conn:
            sharer_conn.close()
        mark_game_share_materialized(share_id, recipient_profile_id)
        return {"game_id": None, "inserted": 0, "merged": 0, "skipped": True}

    # Collect video hashes from sharer's game
    if sharer_conn:
        hashes = _collect_video_hashes(sharer_conn, game_id)
    else:
        hashes = []

    recipient_conn = _open_profile_db(recipient_user_id, recipient_profile_id)
    if recipient_conn is None:
        if sharer_conn:
            sharer_conn.close()
        raise ValueError(
            f"Recipient profile DB not found: {recipient_user_id}/{recipient_profile_id}"
        )

    try:
        # Check if the recipient already has this game (dedup by video hash)
        existing_game_id = _find_existing_game_by_hashes(recipient_conn, hashes)

        if existing_game_id:
            recipient_game_id = existing_game_id
            logger.info(
                f"[Materialize] Recipient already has game (id={existing_game_id}), "
                f"merging clips"
            )
        elif sharer_conn:
            recipient_game_id = _copy_game(sharer_conn, recipient_conn, game_id)
            logger.info(
                f"[Materialize] Created game {recipient_game_id} in recipient's DB"
            )
        else:
            recipient_conn.close()
            raise ValueError(
                "Cannot create game without sharer's DB (pending share with no sharer DB)"
            )

        result = _materialize_clips(recipient_conn, recipient_game_id, clip_data, shared_by=sharer_email)
        recipient_conn.commit()

        # Create storage refs in Postgres
        if hashes:
            _create_storage_refs(
                sharer_user_id, sharer_profile_id,
                recipient_user_id, recipient_profile_id,
                hashes,
            )

        mark_game_share_materialized(share_id, recipient_profile_id)

        logger.info(
            f"[Materialize] Done: game_id={recipient_game_id}, "
            f"inserted={result['inserted']}, merged={result['merged']}"
        )
        return {
            "game_id": recipient_game_id,
            "inserted": result["inserted"],
            "merged": result["merged"],
            "skipped": False,
        }

    finally:
        recipient_conn.close()
        if sharer_conn:
            sharer_conn.close()


def serialize_clip_data(clips: list[dict]) -> bytes:
    """Serialize filtered clip data to msgpack for pending_teammate_shares.clip_data."""
    clean = []
    for c in clips:
        clean.append({
            "rating": c.get("rating"),
            "tags": c.get("tags"),
            "name": c.get("name"),
            "notes": c.get("notes"),
            "start_time": c.get("start_time"),
            "end_time": c.get("end_time"),
            "video_sequence": c.get("video_sequence"),
        })
    return encode_data(clean)
