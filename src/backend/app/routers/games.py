"""
Games endpoints for the Video Editor API.

This router handles game storage and management:
- POST /api/games - Create a game with 0-N video references
- GET /api/games - List all games
- GET /api/games/{id} - Get game details (including annotations)
- PUT /api/games/{id} - Update game name
- DELETE /api/games/{id} - Delete a game
- POST /api/games/{id}/videos - Add video(s) to existing game
- GET /api/games/{id}/video - Stream game video
- PUT /api/games/{id}/annotations - Update annotations
"""

from fastapi import APIRouter, Form, HTTPException, Body, Request
from typing import Optional, List
from math import isfinite
import asyncio
import os
import logging
import json

from app.analytics import record_milestone
from app.utils.encoding import encode_data, decode_data
from app.utils.clip_range import normalize_clip_range

from datetime import datetime
from pydantic import BaseModel, Field

from app.database import get_db_connection, get_raw_clips_path, ensure_directories
from app.services.pg import get_pg
from app.constants import GameType, GameCreateStatus, GameStatus
from app.storage import (
    generate_presigned_url_global,
    generate_presigned_url,
    r2_head_object_global,
    download_from_r2,
    file_exists_in_r2,
)
from app.user_context import get_current_user_id
from app.profile_context import get_current_profile_id
from app.services.storage_credits import calculate_upload_cost, calculate_extension_cost, storage_expires_at
from app.services.user_db import deduct_credits
from app.services.auth_db import (
    insert_game_storage_ref,
    get_game_storage_ref,
    get_grace_deletion_hashes,
    delete_ref,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games"])



def get_game_video_url(blake3_hash: str, video_filename: str) -> str:
    """
    Get presigned URL for a game video, supporting both old and new storage.

    New storage (T80): games/{blake3_hash}.mp4 (global)
    Old storage: {user_id}/games/{video_filename} (per-user)

    Returns presigned URL or None if video not available.
    """
    if blake3_hash:
        # New global storage
        return generate_presigned_url_global(
            f"games/{blake3_hash}.mp4",
            expires_in=14400
        )
    elif video_filename:
        # Old per-user storage (pre-T80 migration)
        user_id = get_current_user_id()
        return generate_presigned_url(
            user_id=user_id,
            relative_path=f"games/{video_filename}",
            expires_in=14400,
            content_type="video/mp4"
        )
    return None

# Import rating constants from shared module (single source of truth)
from app.constants import (
    RATING_ADJECTIVES,
    get_rating_adjective,
)


def generate_clip_name(rating: int, tags: list) -> str:
    """
    Generate a default clip name based on rating and tags.
    Must match frontend generateClipName() in soccerTags.js.
    Tags are already stored as short names in the DB.
    """
    if not tags:
        return ''

    adjective = get_rating_adjective(rating)

    # Tags are already short names (stored that way by the frontend)
    if len(tags) == 1:
        tag_part = tags[0]
    else:
        tag_part = ', '.join(tags[:-1]) + ' and ' + tags[-1]

    return f"{adjective} {tag_part}"


def generate_game_display_name(
    opponent_name: Optional[str],
    game_date: Optional[str],
    game_type: Optional[str],
    tournament_name: Optional[str],
    fallback_name: str
) -> str:
    """
    Generate a display name for a game based on its details.

    Format:
    - Home: "Vs <Opponent> <Date>"
    - Away: "at <Opponent> <Date>"
    - Tournament: "<Tournament>: Vs <Opponent> <Date>"

    Falls back to the stored name if opponent_name is not set.
    """
    if not opponent_name:
        return fallback_name

    # Format date as "Mon D" (e.g., "Dec 6")
    date_str = ""
    if game_date:
        try:
            from datetime import datetime
            dt = datetime.strptime(game_date, "%Y-%m-%d")
            date_str = dt.strftime("%b %-d")  # "Dec 6"
        except (ValueError, Exception):
            # On Windows, %-d may not work, try %#d
            try:
                from datetime import datetime
                dt = datetime.strptime(game_date, "%Y-%m-%d")
                date_str = dt.strftime("%b %d").replace(" 0", " ")  # Remove leading zero
            except:
                date_str = game_date

    # Build the name based on game type
    if game_type == GameType.TOURNAMENT and tournament_name:
        prefix = f"{tournament_name}: Vs"
    elif game_type == GameType.AWAY:
        prefix = "at"
    else:  # home or default
        prefix = "Vs"

    parts = [prefix, opponent_name]
    if date_str:
        parts.append(date_str)

    return " ".join(parts)


# ==============================================================================
# Request/Response Models
# ==============================================================================

class VideoReference(BaseModel):
    blake3_hash: str = Field(..., description="BLAKE3 hash of the video file")
    sequence: int = Field(..., description="Video sequence number (1-based)")
    duration: Optional[float] = Field(None, description="Video duration in seconds")
    width: Optional[int] = Field(None, description="Video width in pixels")
    height: Optional[int] = Field(None, description="Video height in pixels")
    file_size: Optional[int] = Field(None, description="File size in bytes")


class CreateGameRequest(BaseModel):
    opponent_name: Optional[str] = Field(None, description="Opponent team name")
    game_date: Optional[str] = Field(None, description="Game date (YYYY-MM-DD)")
    game_type: Optional[str] = Field(None, description="home, away, or tournament")
    tournament_name: Optional[str] = Field(None, description="Tournament name")
    videos: List[VideoReference] = Field(default_factory=list, description="Video references (0-N)")
    status: Optional[str] = Field(None, description="Game status: 'pending' (pre-upload) or 'ready' (default)")


class AddVideosRequest(BaseModel):
    videos: List[VideoReference] = Field(..., description="Video references to add")


class FinishAnnotationRequest(BaseModel):
    viewed_duration: float = Field(0, description="High-water mark of video watched in seconds")


class PlayheadRequest(BaseModel):
    position: float = Field(..., ge=0, description="Exact last playhead position in seconds")


# ==============================================================================
# Game Management Endpoints
# ==============================================================================

def _validate_video_in_r2(blake3_hash: str) -> None:
    """Validate that a video exists in R2. Raises HTTPException if not found."""
    r2_key = f"games/{blake3_hash}.mp4"
    if not r2_head_object_global(r2_key):
        raise HTTPException(
            status_code=400,
            detail=f"Video {blake3_hash} not found in R2. Upload it first."
        )


def _probe_video_metadata(blake3_hash: str) -> Optional[dict]:
    """
    Probe a game video in R2 via ffprobe for fps, duration, width, height.
    Returns dict with all available fields, or None on failure.
    """
    from app.storage import get_r2_client, R2_BUCKET
    from app.services.video_probe import probe_r2_video
    try:
        client = get_r2_client()
        if client is None:
            return None
        return probe_r2_video(client, R2_BUCKET, f"games/{blake3_hash}.mp4")
    except Exception as e:
        logger.warning(f"[games] video probe failed for {blake3_hash}: {e}")
        return None


def _insert_game_videos(cursor, game_id: int, videos: List[VideoReference], skip_fps_probe: bool = False) -> None:
    """Insert game_videos rows for a game. Shared by create and add-videos.

    skip_fps_probe: True for pending games (video not in R2 yet). FPS is
    probed when the game is activated after upload completes.
    """
    for video in videos:
        fps = None
        if not skip_fps_probe:
            meta = _probe_video_metadata(video.blake3_hash.lower())
            fps = meta.get("fps") if meta else None
        cursor.execute("""
            INSERT INTO game_videos (game_id, blake3_hash, sequence, duration,
                                     video_width, video_height, video_size, fps)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            game_id,
            video.blake3_hash.lower(),
            video.sequence,
            video.duration,
            video.width,
            video.height,
            video.file_size,
            fps,
        ))


def _get_game_videos_response(cursor, game_id: int) -> list:
    """Get game_videos as response dicts with presigned URLs."""
    cursor.execute("""
        SELECT blake3_hash, sequence, duration, video_width, video_height, video_size
        FROM game_videos WHERE game_id = ? ORDER BY sequence
    """, (game_id,))
    rows = cursor.fetchall()

    videos = []
    for row in rows:
        video_url = generate_presigned_url_global(
            f"games/{row['blake3_hash']}.mp4", expires_in=14400
        )
        videos.append({
            'sequence': row['sequence'],
            'blake3_hash': row['blake3_hash'],
            'duration': row['duration'],
            'video_url': video_url,
            'video_width': row['video_width'],
            'video_height': row['video_height'],
        })
    return videos


@router.post("")
async def create_game(request: CreateGameRequest):
    """
    Create a new game with 0, 1, or N video references.

    Videos must already exist in R2 (uploaded via prepare-upload/finalize-upload).
    Each video is referenced by its blake3_hash.

    For single-video games: videos has 1 entry.
    For multi-video games (e.g., halves): videos has 2+ entries.

    T1180: empty videos is rejected. Callers must hash the first video
    before calling this endpoint; additional videos are attached via
    POST /api/games/{id}/videos. This prevents games rows from being
    committed with NULL video_filename and no game_videos rows.
    """
    if not request.videos:
        raise HTTPException(
            status_code=400,
            detail="At least one video reference is required. Hash the first video before creating the game.",
        )

    # Determine game status (pending = pre-upload, ready = default)
    game_status = GameStatus.PENDING if request.status == GameStatus.PENDING else GameStatus.READY

    # Skip R2 validation for pending games (video upload hasn't started yet)
    if game_status == GameStatus.READY:
        for video in request.videos:
            _validate_video_in_r2(video.blake3_hash.lower())

    # If a pending game already exists for this hash, return it so the
    # frontend can resume the upload and activate it.
    if game_status == GameStatus.PENDING and len(request.videos) == 1:
        blake3_hash = request.videos[0].blake3_hash.lower()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, name FROM games WHERE blake3_hash = ? AND status = 'pending'",
                (blake3_hash,)
            )
            existing_pending = cursor.fetchone()
            if existing_pending:
                logger.info(f"Reusing pending game {existing_pending['id']} for hash {blake3_hash}")
                return {
                    "status": GameCreateStatus.CREATED,
                    "game_id": existing_pending['id'],
                    "name": existing_pending['name'],
                    "video_url": None,
                    "videos": [],
                }

    # Check if user already has a READY game with same video(s).
    # Pending games are excluded — they represent an in-progress upload that
    # needs to complete, not a duplicate to skip.
    if len(request.videos) == 1:
        blake3_hash = request.videos[0].blake3_hash.lower()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Check games.blake3_hash (legacy single-video)
            cursor.execute(
                "SELECT id, name FROM games WHERE blake3_hash = ? AND status = 'ready'",
                (blake3_hash,)
            )
            existing = cursor.fetchone()
            if existing:
                video_url = generate_presigned_url_global(
                    f"games/{blake3_hash}.mp4", expires_in=14400
                )
                return {
                    "status": GameCreateStatus.ALREADY_OWNED,
                    "game_id": existing['id'],
                    "name": existing['name'],
                    "video_url": video_url,
                }
            # Also check game_videos table
            cursor.execute("""
                SELECT gv.game_id, g.name FROM game_videos gv
                JOIN games g ON g.id = gv.game_id
                WHERE gv.blake3_hash = ? AND g.status = 'ready'
            """, (blake3_hash,))
            existing = cursor.fetchone()
            if existing:
                video_url = generate_presigned_url_global(
                    f"games/{blake3_hash}.mp4", expires_in=14400
                )
                return {
                    "status": GameCreateStatus.ALREADY_OWNED,
                    "game_id": existing['game_id'],
                    "name": existing['name'],
                    "video_url": video_url,
                }

    # Generate display name
    fallback = "New Game"
    display_name = generate_game_display_name(
        request.opponent_name,
        request.game_date,
        request.game_type,
        request.tournament_name,
        fallback
    )

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # For single-video, also set blake3_hash on games table (legacy compat)
        single_hash = request.videos[0].blake3_hash.lower() if len(request.videos) == 1 else None
        single_filename = f"{single_hash}.mp4" if single_hash else None

        total_duration = None
        video_width = None
        video_height = None
        total_size = None
        if request.videos:
            durations = [v.duration for v in request.videos if v.duration]
            total_duration = sum(durations) if durations else None
            video_width = request.videos[0].width
            video_height = request.videos[0].height
            sizes = [v.file_size for v in request.videos if v.file_size]
            total_size = sum(sizes) if sizes else None

            missing = []
            if not total_duration:
                missing.append("duration")
            if not video_width or not video_height:
                missing.append("dimensions")
            if not total_size:
                missing.append("size")
            if missing:
                logger.warning(
                    f"[create_game] Missing metadata from client: {', '.join(missing)}. "
                    f"Will backfill from R2 probe at activation."
                )

        cursor.execute("""
            INSERT INTO games (
                name, blake3_hash, video_filename,
                video_duration, video_width, video_height, video_size,
                opponent_name, game_date, game_type, tournament_name,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            display_name,
            single_hash,
            single_filename,
            total_duration,
            video_width,
            video_height,
            total_size,
            request.opponent_name,
            request.game_date,
            request.game_type,
            request.tournament_name,
            game_status.value,
        ))
        game_id = cursor.lastrowid

        # Insert game_videos rows (for ALL games, including single-video)
        _insert_game_videos(cursor, game_id, request.videos,
                            skip_fps_probe=(game_status == GameStatus.PENDING))

        conn.commit()

    record_milestone(get_current_user_id(), "game_created", {"game_id": game_id, "game_name": display_name})
    logger.info(f"Created game {game_id}: {display_name} with {len(request.videos)} video(s) status={game_status.value}")

    # Build response with video URLs
    with get_db_connection() as conn:
        cursor = conn.cursor()
        videos_response = _get_game_videos_response(cursor, game_id)

    # For single-video, include video_url at top level for backward compat
    video_url = videos_response[0]['video_url'] if videos_response else None

    return {
        "status": GameCreateStatus.CREATED,
        "game_id": game_id,
        "name": display_name,
        "video_url": video_url,
        "videos": videos_response,
    }


@router.post("/{game_id:int}/videos")
async def add_game_videos(game_id: int, request: AddVideosRequest):
    """
    Add video(s) to an existing game.

    Videos must already exist in R2.
    Use this to add a second half to an existing game, for example.
    """
    if not request.videos:
        raise HTTPException(status_code=400, detail="No videos provided")

    # Validate all videos exist in R2
    for video in request.videos:
        _validate_video_in_r2(video.blake3_hash.lower())

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Check game exists
        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game not found")

        # Insert new game_videos rows
        _insert_game_videos(cursor, game_id, request.videos)

        # Update games table with video metadata
        cursor.execute("""
            SELECT COUNT(*) as cnt, SUM(duration) as total_duration, SUM(video_size) as total_size
            FROM game_videos WHERE game_id = ?
        """, (game_id,))
        agg = cursor.fetchone()

        updates = []
        params = []
        if agg and agg['total_duration']:
            updates.append("video_duration = ?")
            params.append(agg['total_duration'])
        if agg and agg['total_size']:
            updates.append("video_size = ?")
            params.append(agg['total_size'])

        # For single-video games, set legacy fields + dimensions
        total_videos = agg['cnt'] if agg else 0
        if total_videos == 1:
            v = request.videos[0]
            h = v.blake3_hash.lower()
            updates += ["blake3_hash = ?", "video_filename = ?"]
            params += [h, f"{h}.mp4"]
            if v.width:
                updates.append("video_width = ?")
                params.append(v.width)
            if v.height:
                updates.append("video_height = ?")
                params.append(v.height)
            # T1500: mirror fps from the game_videos row we just inserted+probed
            cursor.execute(
                "SELECT fps FROM game_videos WHERE game_id = ? AND sequence = ?",
                (game_id, v.sequence),
            )
            gv_row = cursor.fetchone()
            if gv_row and gv_row['fps']:
                updates.append("video_fps = ?")
                params.append(gv_row['fps'])

        if updates:
            params.append(game_id)
            cursor.execute(f"UPDATE games SET {', '.join(updates)} WHERE id = ?", params)

        conn.commit()

        videos_response = _get_game_videos_response(cursor, game_id)

    logger.info(f"Added {len(request.videos)} video(s) to game {game_id}")
    return {
        "game_id": game_id,
        "videos_added": len(request.videos),
        "videos": videos_response,
    }


@router.post("/{game_id:int}/activate")
async def activate_game(game_id: int):
    """
    T1540: Flip a pending game to ready after video upload completes.

    Validates all game_videos have their blake3_hash present in R2,
    probes FPS for any videos missing it, then sets status='ready'.
    Idempotent: returns success if game is already ready.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id, status, blake3_hash FROM games WHERE id = ?", (game_id,))
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        if game['status'] == GameStatus.READY:
            return {"game_id": game_id, "status": GameStatus.READY}

        # Validate all videos exist in R2
        cursor.execute(
            "SELECT blake3_hash FROM game_videos WHERE game_id = ?",
            (game_id,)
        )
        video_rows = cursor.fetchall()

        for row in video_rows:
            _validate_video_in_r2(row['blake3_hash'])

        # Also validate the legacy blake3_hash on the games row if present
        if game['blake3_hash']:
            _validate_video_in_r2(game['blake3_hash'])

        # Backfill missing metadata from R2 probe (pending games skip probe at creation)
        for row in video_rows:
            cursor.execute(
                "SELECT fps, duration, video_width, video_height FROM game_videos WHERE game_id = ? AND blake3_hash = ?",
                (game_id, row['blake3_hash'])
            )
            gv = cursor.fetchone()
            if not gv:
                continue

            needs_probe = not gv['fps'] or not gv['duration'] or not gv['video_width'] or not gv['video_height']
            if not needs_probe:
                continue

            meta = _probe_video_metadata(row['blake3_hash'])
            if not meta:
                logger.warning(f"[activate] probe failed for game={game_id} hash={row['blake3_hash']}, metadata will remain incomplete")
                continue

            gv_updates = []
            gv_params = []
            if not gv['fps'] and meta.get('fps'):
                gv_updates.append("fps = ?")
                gv_params.append(meta['fps'])
            if not gv['duration'] and meta.get('duration'):
                gv_updates.append("duration = ?")
                gv_params.append(meta['duration'])
            if not gv['video_width'] and meta.get('width'):
                gv_updates.append("video_width = ?")
                gv_params.append(meta['width'])
            if not gv['video_height'] and meta.get('height'):
                gv_updates.append("video_height = ?")
                gv_params.append(meta['height'])

            if gv_updates:
                logger.info(f"[activate] backfilling game_videos game={game_id} hash={row['blake3_hash']}: {', '.join(gv_updates)}")
                cursor.execute(
                    f"UPDATE game_videos SET {', '.join(gv_updates)} WHERE game_id = ? AND blake3_hash = ?",
                    (*gv_params, game_id, row['blake3_hash'])
                )

            if meta.get('fps'):
                cursor.execute(
                    "UPDATE games SET video_fps = ? WHERE id = ? AND video_fps IS NULL",
                    (meta['fps'], game_id)
                )

        # Backfill games table aggregates from game_videos
        cursor.execute("""
            SELECT SUM(duration) as total_duration, SUM(video_size) as total_size,
                   MIN(video_width) as width, MIN(video_height) as height
            FROM game_videos WHERE game_id = ?
        """, (game_id,))
        agg = cursor.fetchone()
        if agg:
            game_updates = []
            game_params = []
            if agg['total_duration']:
                game_updates.append("video_duration = COALESCE(video_duration, ?)")
                game_params.append(agg['total_duration'])
            if agg['total_size']:
                game_updates.append("video_size = COALESCE(video_size, ?)")
                game_params.append(agg['total_size'])
            if agg['width']:
                game_updates.append("video_width = COALESCE(video_width, ?)")
                game_params.append(agg['width'])
            if agg['height']:
                game_updates.append("video_height = COALESCE(video_height, ?)")
                game_params.append(agg['height'])
            if game_updates:
                cursor.execute(
                    f"UPDATE games SET {', '.join(game_updates)} WHERE id = ?",
                    (*game_params, game_id)
                )

        # Backfill working_clips created before activation (fps was NULL
        # because game_videos hadn't been probed yet during pending creation)
        cursor.execute("""
            UPDATE working_clips
            SET fps = (
                SELECT gv.fps FROM raw_clips rc
                JOIN game_videos gv ON gv.game_id = rc.game_id
                    AND gv.sequence = COALESCE(rc.video_sequence, 1)
                WHERE rc.id = working_clips.raw_clip_id
            )
            WHERE fps IS NULL
            AND raw_clip_id IN (
                SELECT id FROM raw_clips WHERE game_id = ?
            )
        """, (game_id,))

        # T1580: Compute total size and deduct storage credits
        cursor.execute(
            "SELECT blake3_hash, video_size FROM game_videos WHERE game_id = ?",
            (game_id,),
        )
        game_video_rows = cursor.fetchall()
        total_size = sum(r["video_size"] or 0 for r in game_video_rows)

        user_id = get_current_user_id()
        profile_id = get_current_profile_id()
        upload_cost = calculate_upload_cost(total_size) if total_size > 0 else 1

        result = deduct_credits(user_id, upload_cost, source="game_upload", reference_id=str(game_id))
        if not result["success"]:
            raise HTTPException(
                status_code=402,
                detail={
                    "message": "Insufficient credits for game upload",
                    "required": upload_cost,
                    "balance": result["balance"],
                },
            )

        # Set game ready and record cross-user storage refs
        expires_str = storage_expires_at().isoformat()
        cursor.execute(
            "UPDATE games SET status = ? WHERE id = ?",
            (GameStatus.READY, game_id),
        )
        conn.commit()

        for vr in game_video_rows:
            if vr["blake3_hash"]:
                insert_game_storage_ref(
                    user_id, profile_id, vr["blake3_hash"],
                    vr["video_size"] or 0, expires_str,
                )

    logger.info(f"Activated game {game_id}: status=ready, cost={upload_cost}cr")
    return {
        "game_id": game_id,
        "status": GameStatus.READY,
        "upload_cost_charged": upload_cost,
    }



BADGE_TAGS = frozenset({
    'Goal', 'Assist', 'Chance Creation',
    'Touchdown Pass', 'Touchdown Catch', 'Touchdown Run', 'Field Goal',
    'Scoring', 'Dunk',
    'Try',
    'Shot',
    'Kill', 'Ace',
    'Home Run',
})

_EMPTY_ATHLETE_STATS = {
    'clip_count': 0,
    'brilliant_count': 0, 'good_count': 0, 'interesting_count': 0,
    'mistake_count': 0, 'blunder_count': 0, 'aggregate_score': 0,
    'tag_badges': {},
}


def _compute_athlete_stats(cursor, game_ids: list) -> dict:
    """Compute rating counts and tag badges for my_athlete=true clips, per game."""
    placeholders = ','.join('?' * len(game_ids))
    cursor.execute(f"""
        SELECT game_id, rating, tags, my_athlete
        FROM raw_clips WHERE game_id IN ({placeholders})
    """, game_ids)

    from collections import defaultdict
    per_game = defaultdict(lambda: {
        'clip_count': 0,
        'brilliant_count': 0, 'good_count': 0, 'interesting_count': 0,
        'mistake_count': 0, 'blunder_count': 0,
        'tag_badges': defaultdict(int),
    })

    for row in cursor.fetchall():
        gid = row['game_id']
        # clip_count is the TOTAL clips in the game (shared clips have my_athlete=0,
        # so it must be counted before the athlete filter); rating badges stay
        # my_athlete-filtered below.
        per_game[gid]['clip_count'] += 1

        is_athlete = row['my_athlete'] is None or bool(row['my_athlete'])
        if not is_athlete:
            continue

        stats = per_game[gid]
        rating = row['rating'] or 3
        if rating == 5:
            stats['brilliant_count'] += 1
        elif rating == 4:
            stats['good_count'] += 1
        elif rating == 3:
            stats['interesting_count'] += 1
        elif rating == 2:
            stats['mistake_count'] += 1
        elif rating == 1:
            stats['blunder_count'] += 1

        tags = decode_data(row['tags']) or []
        for tag in tags:
            if tag in BADGE_TAGS:
                stats['tag_badges'][tag] += 1

    result = {}
    for gid, stats in per_game.items():
        b = stats['brilliant_count']
        g = stats['good_count']
        m = stats['mistake_count']
        bl = stats['blunder_count']
        result[gid] = {
            'clip_count': stats['clip_count'],
            'brilliant_count': b,
            'good_count': g,
            'interesting_count': stats['interesting_count'],
            'mistake_count': m,
            'blunder_count': bl,
            'aggregate_score': b * 3 + g * 2 + m * -1 + bl * -2,
            'tag_badges': dict(stats['tag_badges']),
        }
    return result


async def list_games_metadata():
    """Return game metadata without presigned URLs (used by bootstrap endpoint)."""
    ensure_directories()
    return await _list_games_impl(skip_presigned_urls=True)


@router.get("")
async def list_games():
    """List all saved games. Videos stored globally at games/{blake3_hash}.mp4."""
    ensure_directories()
    return await _list_games_impl(skip_presigned_urls=False)


async def _list_games_impl(skip_presigned_urls=False):
    from app.profile_context import get_current_profile_id
    from app.user_context import get_current_user_id
    from app.database import get_database_path
    _profile = get_current_profile_id()
    _db_path = get_database_path()
    logger.info(f"[list_games] user={get_current_user_id()} profile={_profile} db={_db_path}")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT g.id, g.name, g.blake3_hash, g.video_filename, g.created_at,
                   g.opponent_name, g.game_date, g.game_type, g.tournament_name,
                   g.video_duration, g.viewed_duration, g.status, g.video_size,
                   g.auto_export_status, g.recap_video_url,
                   COALESCE(gv_sum.total_duration, g.video_duration) AS effective_duration
            FROM games g
            LEFT JOIN (
                SELECT game_id, SUM(duration) AS total_duration
                FROM game_videos
                GROUP BY game_id
            ) gv_sum ON gv_sum.game_id = g.id
            ORDER BY g.created_at DESC
        """)
        rows = cursor.fetchall()

        # Storage expiry from profile SQLite (per-user, single source of truth)
        user_id = get_current_user_id()
        storage_rows = cursor.execute(
            "SELECT blake3_hash, storage_expires_at FROM game_storage"
        ).fetchall()
        expiry_by_hash = {r['blake3_hash']: r['storage_expires_at'] for r in storage_rows}
        grace_hashes = get_grace_deletion_hashes()
        all_ref_hashes = {r['blake3_hash'] for r in storage_rows}

        # T2880: Pre-generate presigned URLs for all games concurrently.
        # T3380: Skip when called from bootstrap (URLs loaded lazily on demand).
        if not skip_presigned_urls:
            unique_hashes = {row['blake3_hash'] for row in rows if row['blake3_hash']}
            if unique_hashes:
                await asyncio.gather(*[
                    asyncio.to_thread(generate_presigned_url_global, f"games/{h}.mp4", 14400)
                    for h in unique_hashes
                ])

        # Compute my_athlete-filtered stats and tag badges per game
        game_ids = [row['id'] for row in rows]
        athlete_stats = _compute_athlete_stats(cursor, game_ids) if game_ids else {}

        games = []
        for row in rows:
            if not row['opponent_name'] or not row['game_date'] or not row['game_type']:
                logger.warning(
                    f"Game {row['id']} missing details: opponent={row['opponent_name']}, "
                    f"date={row['game_date']}, type={row['game_type']}, name={row['name']}"
                )

            display_name = generate_game_display_name(
                row['opponent_name'],
                row['game_date'],
                row['game_type'],
                row['tournament_name'],
                row['name']
            )

            video_url = None if skip_presigned_urls else get_game_video_url(row['blake3_hash'], row['video_filename'])

            expires_at_val = expiry_by_hash.get(row['blake3_hash'])
            if expires_at_val:
                try:
                    exp_dt = expires_at_val if isinstance(expires_at_val, datetime) else datetime.fromisoformat(expires_at_val)
                    is_expired = exp_dt.replace(tzinfo=None) < datetime.utcnow()
                except (ValueError, TypeError):
                    is_expired = False
                storage_status = 'expired' if is_expired else 'active'
            elif row['auto_export_status']:
                storage_status = 'expired'
            else:
                storage_status = 'active'

            blake3 = row['blake3_hash']
            can_extend = blake3 in all_ref_hashes or blake3 in grace_hashes

            stats = athlete_stats.get(row['id'], _EMPTY_ATHLETE_STATS)

            games.append({
                'id': row['id'],
                'name': display_name,
                'raw_name': row['name'],
                'opponent_name': row['opponent_name'],
                'game_date': row['game_date'],
                'game_type': row['game_type'],
                'tournament_name': row['tournament_name'],
                'blake3_hash': blake3,
                'video_url': video_url,
                'clip_count': stats['clip_count'],  # derived live from raw_clips, not the stale stored column
                'brilliant_count': stats['brilliant_count'],
                'good_count': stats['good_count'],
                'interesting_count': stats['interesting_count'],
                'mistake_count': stats['mistake_count'],
                'blunder_count': stats['blunder_count'],
                'aggregate_score': stats['aggregate_score'],
                'tag_badges': stats['tag_badges'],
                'created_at': row['created_at'],
                'video_duration': row['effective_duration'],
                'viewed_duration': row['viewed_duration'] or 0,
                'status': row['status'] or 'ready',
                'storage_status': storage_status,
                'storage_expires_at': expires_at_val,
                'video_size': row['video_size'],
                'auto_export_status': row['auto_export_status'],
                'recap_video_url': row['recap_video_url'],
                'can_extend': can_extend,
            })

        logger.info(f"[list_games] returning {len(games)} games for profile={_profile}")
        return {'games': games}


@router.get("/{game_id:int}/urls")
async def get_game_urls(game_id: int):
    """Return presigned URLs for a single game (lazy-loaded on demand)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT blake3_hash, video_filename, recap_video_url FROM games WHERE id = ?",
            (game_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Game not found")
        video_url = get_game_video_url(row['blake3_hash'], row['video_filename'])
        return {
            "game_id": game_id,
            "video_url": video_url,
            "recap_video_url": row['recap_video_url'],
        }


@router.get("/{game_id:int}/recap-url")
async def get_recap_url(game_id: int):
    """Get presigned URL for a game's recap video."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        game = cursor.execute(
            "SELECT recap_video_url FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()

    if not game or not game['recap_video_url']:
        raise HTTPException(status_code=404, detail="No recap video")

    user_id = get_current_user_id()
    url = generate_presigned_url(user_id, game['recap_video_url'], expires_in=14400)
    return {"url": url}


def _try_load_recap_mapping(user_id: str, game_id: int):
    """Try loading stored clip mapping JSON from R2. Returns list or None."""
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        local_path = Path(tmp) / "clips.json"
        if not download_from_r2(user_id, f"recaps/{game_id}_clips.json", local_path):
            return None
        with open(local_path) as f:
            return json.load(f)


def _compute_recap_clips(game_id: int):
    """Compute recap clip positions from DB by summing durations in concat order."""
    from collections import defaultdict
    from app.services.auto_export import _get_annotated_clips

    clips = _get_annotated_clips(game_id)
    clips_by_hash = defaultdict(list)
    for clip in clips:
        clips_by_hash[clip['video_hash']].append(clip)

    result = []
    offset = 0.0
    for hash_clips in clips_by_hash.values():
        for clip in hash_clips:
            duration = clip['end_time'] - clip['start_time']
            result.append({
                'id': clip['id'],
                'name': clip['name'],
                'rating': clip['rating'],
                'tags': decode_data(clip['tags']) or [],
                'notes': clip['notes'] or '',
                'recap_start': round(offset, 3),
                'recap_end': round(offset + duration, 3),
            })
            offset += duration
    return result


def _compute_game_clips(game_id: int):
    """Clips with timestamps relative to the GAME video (not a stitched recap).

    Field names mirror _compute_recap_clips (recap_start / recap_end) because the
    recap viewer's useRecapPlayback consumes those keys; here they carry the
    game-relative clip start/end so the same player can seek each clip inside the
    full game video. Ordered by (video_sequence, start_time) via _get_annotated_clips.
    """
    from app.services.auto_export import _get_annotated_clips

    result = []
    for clip in _get_annotated_clips(game_id):
        if clip['start_time'] is None or clip['end_time'] is None:
            continue
        result.append({
            'id': clip['id'],
            'name': clip['name'],
            'rating': clip['rating'],
            'tags': decode_data(clip['tags']) or [],
            'notes': clip['notes'] or '',
            'recap_start': round(clip['start_time'], 3),
            'recap_end': round(clip['end_time'], 3),
        })
    return result


@router.get("/{game_id:int}/recap-data")
async def get_recap_data(game_id: int):
    """Get a playable video URL + clip timeline for the recap / annotation viewer.

    Resolution order (robust for expired in-grace games whose stitched recap may
    never have existed):
      1. Stitched recap exists in R2  -> recap url + recap-relative clips.
      2. Else game video exists in R2 -> game video url + game-relative clips.
      3. Else (post-grace hard-delete) -> url=None + clips so the modal lists them.

    Only 404s when the game row itself is missing. video_kind tells the client
    which source was chosen ('recap' | 'game' | None).
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        game = cursor.execute(
            "SELECT blake3_hash, video_filename, recap_video_url FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()

    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    user_id = get_current_user_id()
    recap_key = game['recap_video_url']
    blake3 = game['blake3_hash']
    game_video_key = f"games/{blake3}.mp4" if blake3 else None

    recap_exists = bool(recap_key) and file_exists_in_r2(user_id, recap_key)
    game_video_exists = bool(game_video_key) and (r2_head_object_global(game_video_key) is not None)

    if recap_exists:
        url = generate_presigned_url(user_id, recap_key, expires_in=14400)
        clips = _try_load_recap_mapping(user_id, game_id)
        if clips is None:
            clips = _compute_recap_clips(game_id)
        video_kind = 'recap'
        source = f"recap ({recap_key})"
    elif game_video_exists:
        url = get_game_video_url(blake3, game['video_filename'])
        clips = _compute_game_clips(game_id)
        video_kind = 'game'
        source = f"game video ({game_video_key})"
    else:
        url = None
        clips = _compute_game_clips(game_id)
        video_kind = None
        source = "none (video unavailable post-grace)"

    logger.info(
        f"[recap-data] game={game_id} "
        f"recap_key={recap_key!r} recap_exists={recap_exists} "
        f"game_video_key={game_video_key!r} game_video_exists={game_video_exists} "
        f"-> source={source}, video_kind={video_kind}, clips={len(clips)}"
    )

    return {"url": url, "clips": clips, "video_kind": video_kind}


@router.get("/{game_id:int}/brilliant-clips")
async def get_brilliant_clips(game_id: int):
    """Get brilliant clip exports for a game (5-star or 4-star fallback auto-exports)."""
    from app.queries import exclude_teammate_reels_clause, latest_final_videos_subquery

    user_id = get_current_user_id()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        rows = cursor.execute(
            f"""SELECT fv.id, fv.name, fv.duration
                FROM final_videos fv
                WHERE fv.source_type = 'brilliant_clip'
                  AND fv.game_id = ?
                  AND fv.published_at IS NOT NULL
                  AND fv.id IN ({latest_final_videos_subquery()})
                  {exclude_teammate_reels_clause()}
                ORDER BY fv.id""",
            (game_id,),
        ).fetchall()

    clips = [
        {"id": row["id"], "name": row["name"] or f"Clip {row['id']}", "duration": row["duration"]}
        for row in rows
    ]
    return {"clips": clips}


class ExtendStorageRequest(BaseModel):
    days: int = Field(..., ge=1, le=365)


@router.post("/{game_id:int}/extend-storage")
async def extend_game_storage(game_id: int, request: ExtendStorageRequest):
    """Extend storage expiry for a game by N days. Deducts credits."""
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        game = cursor.execute(
            "SELECT id, blake3_hash, video_size FROM games WHERE id = ?",
            (game_id,),
        ).fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        game_size = game['video_size'] or 0
        cost = calculate_extension_cost(game_size, request.days)

        ext_ref = f"{game_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        result = deduct_credits(user_id, cost, source="storage_extension", reference_id=ext_ref)
        if not result["success"]:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_credits",
                    "required": cost,
                    "balance": result["balance"],
                },
            )

        # Get current expiry from profile SQLite (per-user source of truth)
        ref = get_game_storage_ref(user_id, profile_id, game['blake3_hash']) if game['blake3_hash'] else None
        current_expiry = ref['storage_expires_at'] if ref else None
        if current_expiry:
            exp_dt = current_expiry if isinstance(current_expiry, datetime) else datetime.fromisoformat(current_expiry)
            base = max(exp_dt.replace(tzinfo=None), datetime.utcnow())
        else:
            base = datetime.utcnow()
        new_expiry = storage_expires_at(from_dt=base, days=request.days)
        new_expiry_str = new_expiry.isoformat()

        game_video_rows = cursor.execute(
            "SELECT blake3_hash, video_size FROM game_videos WHERE game_id = ?",
            (game_id,),
        ).fetchall()

    for vr in game_video_rows:
        insert_game_storage_ref(
            user_id, profile_id, vr["blake3_hash"],
            vr["video_size"] or 0, new_expiry_str,
        )

    logger.info(
        f"[extend_storage] game={game_id} extended by {request.days}d, "
        f"cost={cost}cr, new_expiry={new_expiry_str}"
    )

    return {
        "success": True,
        "new_expires_at": new_expiry_str,
        "cost_credits": cost,
        "new_balance": result["balance"],
    }


@router.get("/tournaments")
async def list_tournaments():
    """
    List all unique tournament names that have been used.
    Returns tournaments sorted alphabetically for dropdown selection.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT tournament_name
            FROM games
            WHERE tournament_name IS NOT NULL
              AND tournament_name != ''
              AND status = 'ready'
            ORDER BY tournament_name ASC
        """)
        rows = cursor.fetchall()
        tournaments = [row['tournament_name'] for row in rows]

    return {'tournaments': tournaments}


@router.get("/{game_id:int}")
async def get_game(game_id: int):
    """Get game details including annotations. Updates last_accessed_at."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, blake3_hash, video_filename, created_at,
                   video_duration, video_width, video_height, video_size,
                   opponent_name, game_date, game_type, tournament_name,
                   viewed_duration, last_playhead_position, status
            FROM games
            WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Update last_accessed_at (local + global)
        cursor.execute_local(
            "UPDATE games SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (game_id,)
        )
        conn.commit()

        annotations = load_annotations_from_db(game_id)

        display_name = generate_game_display_name(
            row['opponent_name'],
            row['game_date'],
            row['game_type'],
            row['tournament_name'],
            row['name']
        )

        # Check for game_videos (T82: multi-video support)
        videos = _get_game_videos_response(cursor, game_id)

        if videos:
            # Use game_videos as source of truth
            video_url = videos[0]['video_url'] if videos else None
            total_duration = sum(v['duration'] for v in videos if v['duration'])
            video_width = videos[0].get('video_width') or row['video_width']
            video_height = videos[0].get('video_height') or row['video_height']
        else:
            # Legacy single-video (no game_videos rows)
            video_url = get_game_video_url(row['blake3_hash'], row['video_filename'])
            total_duration = row['video_duration']
            video_width = row['video_width']
            video_height = row['video_height']

        return {
            'id': row['id'],
            'name': display_name,
            'raw_name': row['name'],
            'blake3_hash': row['blake3_hash'],
            'video_url': video_url,
            'videos': videos,
            'annotations': annotations,
            'clip_count': len(annotations),
            'created_at': row['created_at'],
            'viewed_duration': row['viewed_duration'] or 0,
            'last_playhead_position': row['last_playhead_position'],
            'video_duration': total_duration,
            'video_width': video_width,
            'video_height': video_height,
            'video_size': row['video_size'],
        }


@router.put("/{game_id:int}")
async def update_game(
    game_id: int,
    name: Optional[str] = Form(None),
    opponent_name: Optional[str] = Form(None),
    game_date: Optional[str] = Form(None),
    game_type: Optional[str] = Form(None),
    tournament_name: Optional[str] = Form(None),
):
    """Update game metadata (opponent, date, type, tournament)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute(
            "SELECT id, name, opponent_name, game_date, game_type, tournament_name FROM games WHERE id = ?",
            (game_id,),
        )
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        updates = {}
        if opponent_name is not None:
            updates['opponent_name'] = opponent_name
        if game_date is not None:
            updates['game_date'] = game_date
        if game_type is not None:
            if game_type not in (GameType.HOME, GameType.AWAY, GameType.TOURNAMENT):
                raise HTTPException(status_code=422, detail=f"Invalid game_type: {game_type}")
            updates['game_type'] = game_type
        if tournament_name is not None:
            updates['tournament_name'] = tournament_name
        if name is not None:
            updates['name'] = name

        if not updates:
            raise HTTPException(status_code=400, detail="No updates provided")

        # Regenerate display name if any metadata field changed
        metadata_fields = {'opponent_name', 'game_date', 'game_type', 'tournament_name'}
        if metadata_fields & updates.keys():
            final_opponent = updates.get('opponent_name', game['opponent_name'])
            final_date = updates.get('game_date', game['game_date'])
            final_type = updates.get('game_type', game['game_type'])
            final_tournament = updates.get('tournament_name', game['tournament_name'])
            updates['name'] = generate_game_display_name(
                final_opponent, final_date, final_type, final_tournament, game['name']
            )

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [game_id]
        cursor.execute(f"UPDATE games SET {set_clause} WHERE id = ?", values)
        conn.commit()

        logger.info(f"Updated game {game_id}: {list(updates.keys())}")
        return {'success': True}


@router.patch("/{game_id:int}/duration")
async def correct_game_duration(game_id: int, duration: float = Body(..., embed=True)):
    """Correct video_duration when the browser detects a longer actual duration than stored."""
    if not isfinite(duration) or duration <= 0:
        raise HTTPException(status_code=422, detail="Invalid duration")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT video_duration FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        stored = row['video_duration'] or 0
        if duration <= stored + 1:
            return {'success': True, 'updated': False}

        cursor.execute("UPDATE games SET video_duration = ? WHERE id = ?", (duration, game_id))
        cursor.execute(
            "UPDATE game_videos SET duration = ? WHERE game_id = ? AND sequence = 1",
            (duration, game_id),
        )
        conn.commit()
        logger.warning(f"Corrected game {game_id} duration: {stored:.1f}s -> {duration:.1f}s")
        return {'success': True, 'updated': True}


@router.put("/{game_id:int}/annotations")
async def update_annotations(
    game_id: int,
    annotations: List = Body(...)
):
    """
    Update game annotations.

    Saves annotations to the database.
    Call this whenever annotations change in the frontend.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game not found")

    # Save annotations to database
    save_annotations_to_db(game_id, annotations)

    logger.info(f"Updated annotations for game {game_id}: {len(annotations)} clips")
    return {
        'success': True,
        'clip_count': len(annotations)
    }


@router.delete("/{game_id:int}")
async def delete_game(game_id: int):
    """Delete a game from user's database. Global video is NOT deleted (may be shared).

    Cleanup order matters for FK constraints:
    - raw_clips cascade from games (ON DELETE CASCADE)
    - But working_clips/working_videos/final_videos reference raw_clips and projects
      without cascade, so we must delete those manually first.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game not found")

        # Collect video hashes before cascade delete removes game_videos rows
        video_hashes = [
            row['blake3_hash'] for row in
            cursor.execute("SELECT blake3_hash FROM game_videos WHERE game_id = ?", (game_id,)).fetchall()
        ]

        # Find all projects linked to this game's clips (auto-created or manual)
        cursor.execute("""
            SELECT DISTINCT p.id FROM projects p
            JOIN working_clips wc ON wc.project_id = p.id
            JOIN raw_clips rc ON rc.id = wc.raw_clip_id
            WHERE rc.game_id = ?
        """, (game_id,))
        project_ids_before = {row['id'] for row in cursor.fetchall()}

        # Delete the game — cascades to raw_clips, which cascades to working_clips
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))

        # Delete any projects that are now empty (all their clips came from this game)
        if project_ids_before:
            placeholders = ','.join('?' * len(project_ids_before))
            cursor.execute(f"""
                DELETE FROM projects WHERE id IN ({placeholders})
                AND id NOT IN (SELECT DISTINCT project_id FROM working_clips)
            """, list(project_ids_before))
            orphaned = cursor.rowcount
        else:
            orphaned = 0

        conn.commit()

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    for h in video_hashes:
        delete_ref(user_id, profile_id, h)

    logger.info(f"Deleted game {game_id} ({orphaned} orphaned projects cleaned up, {len(video_hashes)} storage refs removed)")
    return {'success': True}


@router.get("/{game_id:int}/video")
async def get_game_video(game_id: int):
    """Redirect to presigned R2 URL for game video. Updates last_accessed_at."""
    from fastapi.responses import RedirectResponse

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT blake3_hash, video_filename FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Update last_accessed_at (local + global)
        cursor.execute_local(
            "UPDATE games SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (game_id,)
        )
        conn.commit()

        # Support both new (blake3_hash) and old (video_filename) storage
        presigned_url = get_game_video_url(row['blake3_hash'], row['video_filename'])
        if presigned_url:
            return RedirectResponse(url=presigned_url, status_code=302)
        raise HTTPException(status_code=404, detail="Video not available")


# ============================================================================
# Database-backed annotation functions (for Phase 3+ of the refactor)
# ============================================================================

def load_annotations_from_db(game_id: int) -> list:
    """Load annotations from raw_clips table for a game."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Query raw_clips as the single source of truth for clip annotations
        cursor.execute("""
            SELECT rc.id, rc.start_time, rc.end_time, rc.name, rc.rating, rc.tags, rc.notes, rc.video_sequence,
                   rc.tagged_teammates, rc.my_athlete, rc.shared_by,
                   CASE WHEN p.id IS NOT NULL AND p.archived_at IS NULL THEN rc.auto_project_id ELSE NULL END AS auto_project_id
            FROM raw_clips rc
            LEFT JOIN projects p ON p.id = rc.auto_project_id
            WHERE rc.game_id = ?
            ORDER BY rc.video_sequence, rc.end_time
        """, (game_id,))
        rows = cursor.fetchall()

        annotations = []
        for row in rows:
            tags = decode_data(row['tags']) or []

            # Generate default name if empty
            name = row['name']
            if not name:
                name = generate_clip_name(row['rating'], tags)

            tagged_teammates = decode_data(row['tagged_teammates']) if row['tagged_teammates'] else None
            my_athlete_val = row['my_athlete']
            my_athlete = True if my_athlete_val is None else bool(my_athlete_val)

            annotations.append({
                'id': row['id'],  # raw_clip id for frontend sync
                'raw_clip_id': row['id'],  # Also send as raw_clip_id for importAnnotations
                'start_time': row['start_time'],
                'end_time': row['end_time'],
                'name': name,
                'rating': row['rating'],
                'tags': tags,
                'notes': row['notes'] or '',
                'video_sequence': row['video_sequence'],  # T82: which video (null = single-video)
                'auto_project_id': row['auto_project_id'],
                'tagged_teammates': tagged_teammates,
                'my_athlete': my_athlete,
                'shared_by': row['shared_by'],
            })

        return annotations


def save_annotations_to_db(game_id: int, annotations: list) -> None:
    """
    Save annotations to raw_clips table, syncing with existing records.

    Uses natural key (game_id, end_time, video_sequence) to match annotations with raw_clips.
    - Updates existing clips' metadata (name, rating, tags, notes, start_time)
    - Deletes clips that are no longer in the annotations list
    - New clips are expected to be created via real-time save
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get existing raw_clips for this game (using (end_time, video_sequence) as natural key)
        cursor.execute("""
            SELECT id, end_time, video_sequence, filename, auto_project_id
            FROM raw_clips
            WHERE game_id = ?
        """, (game_id,))
        existing_clips = {(row['end_time'], row['video_sequence']): dict(row) for row in cursor.fetchall()}

        # Track which keys are still present in annotations
        annotation_keys = set()

        for ann in annotations:
            # Normalize an inverted range before it becomes the end_time-keyed
            # natural key or hits the DB, so start_time <= end_time always holds.
            start_time, end_time = normalize_clip_range(
                ann.get('start_time', 0),
                ann.get('end_time', ann.get('start_time', 0)),
            )
            video_sequence = ann.get('video_sequence')
            clip_key = (end_time, video_sequence)
            annotation_keys.add(clip_key)

            tags = ann.get('tags', [])
            tags_encoded = encode_data(tags)
            rating = ann.get('rating', 3)
            name = ann.get('name', '')

            # Don't store default names - they should be computed on read
            default_name = generate_clip_name(rating, tags)
            if name == default_name:
                name = ''

            if clip_key in existing_clips:
                # Update existing raw_clip metadata
                cursor.execute("""
                    UPDATE raw_clips
                    SET start_time = ?, name = ?, rating = ?, tags = ?, notes = ?
                    WHERE id = ?
                """, (
                    start_time,
                    name,
                    rating,
                    tags_encoded,
                    ann.get('notes', ''),
                    existing_clips[clip_key]['id']
                ))
            else:
                # Create new raw_clip (fallback if real-time save failed)
                cursor.execute("""
                    INSERT INTO raw_clips (filename, rating, tags, name, notes, start_time, end_time, game_id, video_sequence)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    '',
                    rating,
                    tags_encoded,
                    name,
                    ann.get('notes', ''),
                    start_time,
                    end_time,
                    game_id,
                    video_sequence,
                ))
                logger.info(f"Created raw_clip for game {game_id} at end_time {end_time} video_sequence {video_sequence}")

        # Delete raw_clips that are no longer in annotations
        for clip_key, clip_data in existing_clips.items():
            if clip_key not in annotation_keys:
                clip_id = clip_data['id']
                filename = clip_data['filename']
                auto_project_id = clip_data['auto_project_id']

                # Delete auto-project if exists and unmodified
                if auto_project_id:
                    _delete_auto_project_if_unmodified(cursor, auto_project_id)

                # Delete working clips that reference this raw clip
                cursor.execute("DELETE FROM working_clips WHERE raw_clip_id = ?", (clip_id,))

                # Delete the raw clip record
                cursor.execute("DELETE FROM raw_clips WHERE id = ?", (clip_id,))

                # Delete the file from disk
                if filename:
                    file_path = get_raw_clips_path() / filename
                    if file_path.exists():
                        os.unlink(file_path)
                        logger.info(f"Deleted clip file: {file_path}")

        conn.commit()


def _delete_auto_project_if_unmodified(cursor, project_id: int) -> bool:
    """Delete an auto-created project if it hasn't been modified."""
    # Check if project has been modified (has working video, final video, or multiple clips)
    cursor.execute("""
        SELECT p.working_video_id, p.final_video_id,
               (SELECT COUNT(*) FROM working_clips WHERE project_id = p.id) as clip_count
        FROM projects p WHERE p.id = ?
    """, (project_id,))
    project = cursor.fetchone()

    if not project:
        return False

    # Don't delete if project has been worked on
    if project['working_video_id'] or project['final_video_id'] or project['clip_count'] > 1:
        logger.info(f"Keeping modified auto-project {project_id}")
        return False

    # Delete the working clip first (foreign key constraint)
    cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))

    # Delete the project
    cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    logger.info(f"Deleted unmodified auto-project {project_id}")
    return True


@router.post("/{game_id:int}/finish-annotation")
async def finish_annotation(game_id: int, body: FinishAnnotationRequest = FinishAnnotationRequest()):
    """
    Called when user leaves annotation mode for a game.
    Persists the high-water mark of video watched (viewed_duration).

    Persists high-water mark only; no side effects.
    """
    if body.viewed_duration > 0:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # High-water mark: never decrease viewed_duration
            cursor.execute(
                "UPDATE games SET viewed_duration = MAX(COALESCE(viewed_duration, 0), ?) WHERE id = ?",
                (body.viewed_duration, game_id)
            )
            conn.commit()
            logger.info(f"[FinishAnnotation] Updated viewed_duration={body.viewed_duration:.1f}s for game {game_id}")

        from ..analytics import record_milestone
        record_milestone(get_current_user_id(), "annotation_completed", {"game_id": game_id})
    else:
        logger.info(f"[FinishAnnotation] User left annotation mode for game {game_id} (no progress update)")

    return {
        "success": True,
        "tasks_created": 0,
        "message": "Annotation session ended"
    }


@router.post("/{game_id:int}/playhead")
async def save_playhead(game_id: int, body: PlayheadRequest):
    """Persist the exact last playhead position for a game (single-video resume).

    Unlike viewed_duration (a high-water mark for review progress), this is a
    direct overwrite — it may move backward so reopening lands exactly where the
    user left off. Designed to accept navigator.sendBeacon on tab close.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE games SET last_playhead_position = ? WHERE id = ?",
            (body.position, game_id)
        )
        conn.commit()
        logger.info(f"[Playhead] Saved last_playhead_position={body.position:.1f}s for game {game_id}")

    return {"success": True}


def _is_game_storage_expired(cursor, blake3_hash: str | None) -> bool:
    """Return True if a game's storage has expired.

    Mirrors the is_expired computation in list_games (~L877-884): reads
    storage_expires_at from game_storage (per-profile SQLite) and compares to
    utcnow(). Used to gate sharing of expired games. Annotation/recap playback
    is intentionally NOT gated -- those endpoints stay open for expired games.
    """
    if not blake3_hash:
        return False
    row = cursor.execute(
        "SELECT storage_expires_at FROM game_storage WHERE blake3_hash = ?",
        (blake3_hash,),
    ).fetchone()
    if not row or not row["storage_expires_at"]:
        return False
    expires_at_val = row["storage_expires_at"]
    try:
        exp_dt = expires_at_val if isinstance(expires_at_val, datetime) else datetime.fromisoformat(expires_at_val)
        return exp_dt.replace(tzinfo=None) < datetime.utcnow()
    except (ValueError, TypeError):
        return False


class ShareGameRequest(BaseModel):
    emails: list[str]


@router.post("/{game_id:int}/share")
async def share_game(game_id: int, body: ShareGameRequest):
    """Share a game with recipients via email. Game-only sharing (no annotations)."""
    import asyncio
    from app.services.email import send_game_share_email, _resolve_sender_name, _is_existing_user
    from app.services.auth_db import get_user_by_id, get_user_by_email
    from app.services.sharing_db import (
        create_game_share, revoke_share, get_share_by_token,
        create_pending_share,
    )
    from app.services.user_db import get_profiles
    from app.services.materialization import (
        materialize_game_share, serialize_clip_data,
    )

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    sharer = get_user_by_id(user_id)
    sharer_email = sharer["email"] if sharer else user_id
    sender_name = _resolve_sender_name(sharer_email)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, blake3_hash FROM games WHERE id = ?", (game_id,))
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        game_name = game["name"] or "Untitled Game"

        game_blake3 = game["blake3_hash"]
        if not game_blake3:
            cursor.execute(
                "SELECT blake3_hash FROM game_videos WHERE game_id = ? ORDER BY sequence LIMIT 1",
                (game_id,),
            )
            gv_row = cursor.fetchone()
            if gv_row:
                game_blake3 = gv_row["blake3_hash"]

        if _is_game_storage_expired(cursor, game_blake3):
            raise HTTPException(
                status_code=410,
                detail="Storage expired - extend storage to share this game.",
            )

    email_results = []
    all_sent = True

    share_records = []
    for email in body.emails:
        try:
            share = create_game_share(
                game_id=game_id,
                tag_name=None,
                sharer_user_id=user_id,
                sharer_profile_id=profile_id,
                recipient_email=email,
                game_name=game_name,
                game_blake3=game_blake3,
            )
            share_records.append(share)
        except Exception as e:
            logger.error(f"[share-game] Failed to create share record: {e}")
            share_records.append(None)

    tasks = {}
    for email, share in zip(body.emails, share_records):
        is_first_touch = not _is_existing_user(email)
        tasks[email] = send_game_share_email(
            recipient_email=email,
            sharer_email=sharer_email,
            game_name=game_name,
            share_token=share["share_token"] if share else None,
            sender_name=sender_name,
            is_first_touch=is_first_touch,
        )

    if tasks:
        send_results = await asyncio.gather(*tasks.values())
        for (email, share), sent in zip(
            zip(body.emails, share_records), send_results
        ):
            email_results.append({"email": email, "sent": sent})
            if not sent:
                all_sent = False
                if share:
                    try:
                        revoke_share(share["share_token"], user_id)
                    except Exception:
                        pass

    if all_sent and email_results:
        for email, share in zip(body.emails, share_records):
            if not share:
                continue
            try:
                recipient_user = get_user_by_email(email)
                share_record = get_share_by_token(share["share_token"])
                if not share_record:
                    continue

                if not recipient_user:
                    create_pending_share(
                        share_id=share_record["id"],
                        sharer_user_id=user_id,
                        sharer_profile_id=profile_id,
                        recipient_email=email,
                        game_id=game_id,
                        tag_name=None,
                        clip_data_bytes=serialize_clip_data([]),
                    )
                    logger.info(f"[share-game] Created pending share for non-user {email}")
                    continue

                profiles = get_profiles(recipient_user["user_id"])
                if len(profiles) == 1:
                    materialize_game_share(
                        sharer_user_id=user_id,
                        sharer_profile_id=profile_id,
                        recipient_user_id=recipient_user["user_id"],
                        recipient_profile_id=profiles[0]["id"],
                        game_id=game_id,
                        tag_name=None,
                        share_id=share_record["id"],
                        sharer_email=sharer_email,
                    )
                    logger.info(f"[share-game] Materialized for {email}")
                else:
                    create_pending_share(
                        share_id=share_record["id"],
                        sharer_user_id=user_id,
                        sharer_profile_id=profile_id,
                        recipient_email=email,
                        game_id=game_id,
                        tag_name=None,
                        clip_data_bytes=serialize_clip_data([]),
                    )
                    logger.info(f"[share-game] Created pending share for multi-profile user {email}")
            except Exception as e:
                logger.error(f"[share-game] Materialization failed for {email}: {e}")

    return {"results": email_results, "all_sent": all_sent}


class SharePlaybackRequest(BaseModel):
    emails: list[str]


@router.post("/{game_id:int}/share-playback")
async def share_playback(game_id: int, body: SharePlaybackRequest):
    """Share all annotated clips for a game with recipients via email."""
    import asyncio
    from app.services.email import send_playback_share_email, _resolve_sender_name, _is_existing_user
    from app.services.auth_db import get_user_by_id, get_user_by_email
    from app.services.sharing_db import (
        create_game_share, revoke_share, get_share_by_token,
        create_pending_share, list_shares_for_game,
    )
    from app.services.user_db import get_profiles
    from app.services.materialization import (
        materialize_game_share, serialize_clip_data,
    )

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    sharer = get_user_by_id(user_id)
    sharer_email = sharer["email"] if sharer else user_id
    sender_name = _resolve_sender_name(sharer_email)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, blake3_hash FROM games WHERE id = ?", (game_id,))
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        game_name = game["name"] or "Untitled Game"

        game_blake3 = game["blake3_hash"]
        if not game_blake3:
            cursor.execute(
                "SELECT blake3_hash FROM game_videos WHERE game_id = ? ORDER BY sequence LIMIT 1",
                (game_id,),
            )
            gv_row = cursor.fetchone()
            if gv_row:
                game_blake3 = gv_row["blake3_hash"]

        if _is_game_storage_expired(cursor, game_blake3):
            raise HTTPException(
                status_code=410,
                detail="Storage expired - extend storage to share this game.",
            )

        cursor.execute(
            """SELECT id, rating, tags, name, notes, start_time, end_time, video_sequence
               FROM raw_clips WHERE game_id = ?""",
            (game_id,),
        )
        clips = [dict(row) for row in cursor.fetchall()]
        clip_names = [c["name"] for c in clips if c.get("name")]
        first_clip_start = clips[0]["start_time"] if clips else None

    existing_shares = list_shares_for_game(game_id, user_id)

    email_results = []
    all_sent = True
    share_records = []

    for email in body.emails:
        duplicate = next(
            (s for s in existing_shares
             if s["recipient_email"] == email.lower().strip()
             and s["share_type"] == "annotation_playback"
             and not s.get("revoked_at")),
            None,
        )
        if duplicate:
            share_records.append({
                "share_token": duplicate["share_token"],
                "recipient_email": email,
                "duplicate": True,
            })
            continue

        try:
            share = create_game_share(
                game_id=game_id,
                tag_name="",
                sharer_user_id=user_id,
                sharer_profile_id=profile_id,
                recipient_email=email,
                game_name=game_name,
                game_blake3=game_blake3,
                first_clip_start=first_clip_start,
                clip_names=clip_names,
                share_type="annotation_playback",
            )
            share_records.append(share)
        except Exception as e:
            logger.error(f"[share-playback] Failed to create share record: {e}")
            share_records.append(None)

    if not os.getenv("RESEND_API_KEY"):
        from app.services.email import _get_share_url
        for email, share in zip(body.emails, share_records):
            if share:
                url = _get_share_url(share["share_token"], "game")
                logger.warning(f"[share-playback] DEV MODE -- {email}: {url}")

    tasks = {}
    for email, share in zip(body.emails, share_records):
        if email in [r["email"] for r in email_results]:
            continue
        if share and share.get("duplicate"):
            # Recipient already has an active share for this game; don't resend email.
            continue
        is_first_touch = not _is_existing_user(email)
        tasks[email] = send_playback_share_email(
            recipient_email=email,
            sharer_email=sharer_email,
            game_name=game_name,
            share_token=share["share_token"] if share else None,
            sender_name=sender_name,
            is_first_touch=is_first_touch,
        )

    if tasks:
        send_results = await asyncio.gather(*tasks.values())
        for (email, share), sent in zip(
            [(e, s) for e, s in zip(body.emails, share_records) if e not in [r["email"] for r in email_results]],
            send_results,
        ):
            email_results.append({"email": email, "sent": sent})
            if not sent:
                all_sent = False
                if share:
                    try:
                        revoke_share(share["share_token"], user_id)
                    except Exception:
                        pass

    if all_sent and email_results:
        clip_data_bytes = serialize_clip_data(clips)
        for email, share in zip(body.emails, share_records):
            if not share:
                continue
            try:
                recipient_user = get_user_by_email(email)
                share_record = get_share_by_token(share["share_token"])
                if not share_record:
                    continue

                if not recipient_user:
                    create_pending_share(
                        share_id=share_record["id"],
                        sharer_user_id=user_id,
                        sharer_profile_id=profile_id,
                        recipient_email=email,
                        game_id=game_id,
                        tag_name="",
                        clip_data_bytes=clip_data_bytes,
                    )
                    logger.info(f"[share-playback] Created pending share for non-user {email}")
                    continue

                profiles = get_profiles(recipient_user["user_id"])
                if len(profiles) == 1:
                    materialize_game_share(
                        sharer_user_id=user_id,
                        sharer_profile_id=profile_id,
                        recipient_user_id=recipient_user["user_id"],
                        recipient_profile_id=profiles[0]["id"],
                        game_id=game_id,
                        tag_name="",
                        share_id=share_record["id"],
                        clip_data=clips,
                        sharer_email=sharer_email,
                    )
                    logger.info(f"[share-playback] Materialized for {email}")
                else:
                    create_pending_share(
                        share_id=share_record["id"],
                        sharer_user_id=user_id,
                        sharer_profile_id=profile_id,
                        recipient_email=email,
                        game_id=game_id,
                        tag_name="",
                        clip_data_bytes=clip_data_bytes,
                    )
                    logger.info(f"[share-playback] Created pending share for multi-profile user {email}")
            except Exception as e:
                logger.error(f"[share-playback] Materialization failed for {email}: {e}")

    return {"results": email_results, "all_sent": all_sent}


@router.get("/{game_id:int}/playback-url")
async def get_game_playback_url(game_id: int):
    """Return presigned R2 URL for direct browser playback."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                COALESCE(gv.blake3_hash, g.blake3_hash) AS blake3_hash,
                g.video_filename,
                COALESCE(gv.video_size, g.video_size) AS video_size
            FROM games g
            LEFT JOIN game_videos gv
                ON gv.game_id = g.id AND gv.sequence = 1
            WHERE g.id = ?
        """, (game_id,))
        row = cursor.fetchone()

    if not row:
        raise HTTPException(404, "Game not found")
    if not row['blake3_hash']:
        raise HTTPException(422, "Game video missing blake3 hash")

    url = get_game_video_url(row['blake3_hash'], row['video_filename'])
    if not url:
        raise HTTPException(502, "Failed to generate R2 URL")

    return {
        "url": url,
        "expires_in": 14400,
        "file_size": row['video_size'],
    }


@router.get("/{game_id:int}/load")
async def load_game(game_id: int):
    """Single endpoint returning everything needed to render the annotate screen.

    Combines: get_game + playback-url + teammate-tags + teammate-shares
    into one request to eliminate sequential fetch waterfall and thread pool contention.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # 1. Game data (same as get_game)
        cursor.execute("""
            SELECT id, name, blake3_hash, video_filename, created_at,
                   video_duration, video_width, video_height, video_size,
                   opponent_name, game_date, game_type, tournament_name,
                   viewed_duration, last_playhead_position, status
            FROM games
            WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        cursor.execute_local(
            "UPDATE games SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (game_id,)
        )

        annotations = load_annotations_from_db(game_id)

        display_name = generate_game_display_name(
            row['opponent_name'],
            row['game_date'],
            row['game_type'],
            row['tournament_name'],
            row['name']
        )

        videos = _get_game_videos_response(cursor, game_id)

        if videos:
            video_url = videos[0]['video_url'] if videos else None
            total_duration = sum(v['duration'] for v in videos if v['duration'])
            video_width = videos[0].get('video_width') or row['video_width']
            video_height = videos[0].get('video_height') or row['video_height']
        else:
            video_url = get_game_video_url(row['blake3_hash'], row['video_filename'])
            total_duration = row['video_duration']
            video_width = row['video_width']
            video_height = row['video_height']

        game = {
            'id': row['id'],
            'name': display_name,
            'raw_name': row['name'],
            'blake3_hash': row['blake3_hash'],
            'video_url': video_url,
            'videos': videos,
            'annotations': annotations,
            'clip_count': len(annotations),
            'created_at': row['created_at'],
            'viewed_duration': row['viewed_duration'] or 0,
            'last_playhead_position': row['last_playhead_position'],
            'video_duration': total_duration,
            'video_width': video_width,
            'video_height': video_height,
            'video_size': row['video_size'],
        }

        # 2. Playback URL (same as get_game_playback_url)
        cursor.execute("""
            SELECT
                COALESCE(gv.blake3_hash, g.blake3_hash) AS blake3_hash,
                g.video_filename,
                COALESCE(gv.video_size, g.video_size) AS video_size
            FROM games g
            LEFT JOIN game_videos gv
                ON gv.game_id = g.id AND gv.sequence = 1
            WHERE g.id = ?
        """, (game_id,))
        pb_row = cursor.fetchone()

        playback_url = None
        if pb_row and pb_row['blake3_hash']:
            playback_url = get_game_video_url(pb_row['blake3_hash'], pb_row['video_filename'])

        # 3. Teammate tags (same as clips.get_teammate_tags)
        cursor.execute("""
            SELECT tag_name, COUNT(*) as cnt
            FROM clip_teammates
            GROUP BY tag_name
            ORDER BY cnt DESC
        """)
        teammate_tags = [r["tag_name"] for r in cursor.fetchall()]

        # 4. Teammate shares (same as clips.get_teammate_shares)
        cursor.execute(
            "SELECT tag_name, shared_clip_ids, created_at FROM teammate_shares WHERE game_id = ? ORDER BY created_at",
            (game_id,)
        )
        teammate_shares = [
            {
                "tag_name": r["tag_name"],
                "shared_clip_ids": json.loads(r["shared_clip_ids"]),
                "shared_at": r["created_at"],
            }
            for r in cursor.fetchall()
        ]

        conn.commit()

    return {
        "game": game,
        "playback_url": {
            "url": playback_url,
            "expires_in": 14400,
            "file_size": pb_row['video_size'] if pb_row else None,
        } if playback_url else None,
        "teammate_tags": teammate_tags,
        "teammate_shares": teammate_shares,
    }


@router.get("/{game_id:int}/stream")
async def stream_game_bounded(
    game_id: int,
    request: Request,
    t: Optional[float] = None,
):
    """
    Bounded streaming proxy for annotation playback. Serves byte ranges
    covering the moov atom + annotated clip regions instead of the full
    game video. Same three-window strategy as T1430's clip proxy.

    If no clips exist for this game, all ranges are allowed (full video).
    """
    MOOV_WINDOW_END = 10 * 1024 * 1024 - 1
    MOOV_TAIL_SIZE = 10 * 1024 * 1024
    PRE_PAD_SECONDS = 2.0
    POST_PAD_SECONDS = 5.0
    MIN_PAD_BYTES = 5 * 1024 * 1024
    GAP_OVERRUN_EXTRA = 20 * 1024 * 1024
    from fastapi.responses import StreamingResponse
    import httpx

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                COALESCE(gv.blake3_hash, g.blake3_hash) AS blake3_hash,
                g.video_filename,
                COALESCE(gv.duration, g.video_duration) AS video_duration,
                COALESCE(gv.video_size, g.video_size) AS video_size
            FROM games g
            LEFT JOIN game_videos gv
                ON gv.game_id = g.id AND gv.sequence = 1
            WHERE g.id = ?
        """, (game_id,))
        game_row = cursor.fetchone()

        if not game_row:
            raise HTTPException(404, "Game not found")
        if not game_row['video_duration'] or not game_row['video_size']:
            raise HTTPException(422, "Game video missing duration/size metadata")
        if not game_row['blake3_hash']:
            raise HTTPException(422, "Game video missing blake3 hash")

        blake3_hash = game_row['blake3_hash']
        video_filename = game_row['video_filename']
        duration = game_row['video_duration']
        size = game_row['video_size']

        cursor.execute(
            "SELECT start_time, end_time FROM raw_clips WHERE game_id = ? ORDER BY start_time",
            (game_id,),
        )
        clips = cursor.fetchall()

    moov_end = min(size - 1, MOOV_WINDOW_END)
    moov_tail_start = max(0, size - MOOV_TAIL_SIZE)

    if not clips:
        clip_windows = [(0, size - 1)]
    else:
        raw_windows = []
        for clip in clips:
            start_byte_raw = int((clip['start_time'] / duration) * size)
            end_byte_raw = int((clip['end_time'] / duration) * size)
            pre_pad = max(int((PRE_PAD_SECONDS / duration) * size), MIN_PAD_BYTES)
            post_pad = max(int((POST_PAD_SECONDS / duration) * size), MIN_PAD_BYTES)
            raw_windows.append((
                max(0, start_byte_raw - pre_pad),
                min(size - 1, end_byte_raw + post_pad),
            ))
        raw_windows.sort()
        clip_windows = [raw_windows[0]]
        for start, end in raw_windows[1:]:
            prev_start, prev_end = clip_windows[-1]
            if start <= prev_end + 1:
                clip_windows[-1] = (prev_start, max(prev_end, end))
            else:
                clip_windows.append((start, end))

    presigned_url = get_game_video_url(blake3_hash, video_filename)
    if not presigned_url:
        raise HTTPException(404, "Failed to generate R2 URL")

    # No upfront R2 probe -- it added ~1.5s of latency per seek
    # (separate TCP/TLS handshake). Errors are caught in stream_from_r2().

    range_hdr = request.headers.get("range") or request.headers.get("Range")
    req_start = 0
    req_end = size - 1
    if range_hdr and range_hdr.startswith("bytes="):
        spec = range_hdr[len("bytes="):].strip()
        if "-" in spec:
            lo_s, hi_s = spec.split("-", 1)
            try:
                if lo_s:
                    req_start = int(lo_s)
                if hi_s:
                    req_end = int(hi_s)
            except ValueError:
                raise HTTPException(416, "Malformed Range header")

    window_kind = None
    window_end = None

    if req_start <= moov_end:
        window_end = moov_end
        window_kind = "moov"
    else:
        for win_start, win_end_val in clip_windows:
            if win_start <= req_start <= win_end_val:
                window_end = win_end_val
                window_kind = "clip"
                break

        if window_kind is None and req_start >= moov_tail_start:
            window_end = size - 1
            window_kind = "moov_tail"

        if window_kind is None:
            for _, win_end_val in clip_windows:
                if win_end_val < req_start <= win_end_val + GAP_OVERRUN_EXTRA:
                    window_end = min(
                        win_end_val + GAP_OVERRUN_EXTRA,
                        moov_tail_start - 1 if moov_tail_start > 0 else size - 1,
                    )
                    window_kind = "clip_overrun"
                    logger.info(
                        f"[game-stream] overrun game_id={game_id} req={req_start}-{req_end} "
                        f"clip_win_end={win_end_val} overrun_end={window_end}"
                    )
                    break

    if window_kind is None:
        # Window must be large enough for smooth playback (~2 min of
        # video) but not so large that seeks become sluggish (browser
        # has to cancel a huge in-flight download on each seek).
        MIN_SEEK = 20 * 1024 * 1024   # 20 MB floor
        MAX_SEEK = 100 * 1024 * 1024  # 100 MB cap
        two_min_bytes = int((120.0 / max(duration, 1)) * size)
        seek_size = max(MIN_SEEK, min(two_min_bytes, MAX_SEEK))
        window_end = min(req_start + seek_size, size - 1)
        window_kind = "seek"

    req_end = min(req_end, window_end)
    if req_start > req_end:
        raise HTTPException(
            status_code=416,
            detail="Invalid range",
            headers={"Content-Range": f"bytes */{size}"},
        )

    segment_len = req_end - req_start + 1
    logger.info(
        f"[game-stream] game_id={game_id} window={window_kind} "
        f"range={req_start}-{req_end} segment_len={segment_len}"
    )

    async def stream_from_r2():
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            async with client.stream(
                "GET",
                presigned_url,
                headers={"Range": f"bytes={req_start}-{req_end}"},
            ) as response:
                if response.status_code not in (200, 206):
                    error_body = ""
                    try:
                        raw = await response.aread()
                        error_body = raw[:500].decode("utf-8", errors="replace")
                    except Exception:
                        error_body = "(unreadable)"
                    logger.error(
                        f"[game-stream] R2 error game_id={game_id} "
                        f"r2_status={response.status_code} blake3={blake3_hash} "
                        f"range={req_start}-{req_end} window={window_kind} "
                        f"body_snippet={error_body!r}"
                    )
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"R2 returned {response.status_code}",
                    )
                bytes_streamed = 0
                try:
                    async for chunk in response.aiter_bytes(chunk_size=4 * 1024 * 1024):
                        bytes_streamed += len(chunk)
                        yield chunk
                except Exception as e:
                    logger.error(
                        f"[game-stream] R2 stream interrupted game_id={game_id} "
                        f"window={window_kind} range={req_start}-{req_end} "
                        f"bytes_streamed={bytes_streamed}/{segment_len} "
                        f"error={type(e).__name__}: {e}"
                    )

    return StreamingResponse(
        stream_from_r2(),
        status_code=206,
        media_type="video/mp4",
        headers={
            "Content-Range": f"bytes {req_start}-{req_end}/{size}",
            "Content-Length": str(segment_len),
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=300, immutable",
        },
    )
