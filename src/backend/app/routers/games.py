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

from fastapi import APIRouter, Form, HTTPException, Body
from typing import Optional, List
import os
import logging
import json

from datetime import datetime
from pydantic import BaseModel, Field

from app.database import get_db_connection, get_raw_clips_path, ensure_directories
from app.constants import GameType, GameCreateStatus
from app.storage import (
    generate_presigned_url_global,
    generate_presigned_url,
    r2_get_object_metadata_global,
    r2_set_object_metadata_global,
    r2_head_object_global,
)
from app.user_context import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games"])


def update_global_access_time(blake3_hash: str) -> None:
    """
    Update last_accessed_at in R2 object metadata.

    This tracks global access time across all users - enables future
    cleanup cron to identify truly unused games (not accessed by ANY user).
    """
    if not blake3_hash:
        return

    r2_key = f"games/{blake3_hash}.mp4"
    try:
        # Get existing metadata to preserve other fields
        existing = r2_get_object_metadata_global(r2_key) or {}
        existing['last_accessed_at'] = datetime.utcnow().isoformat() + 'Z'
        r2_set_object_metadata_global(r2_key, existing)
        logger.debug(f"Updated global access time for {blake3_hash}")
    except Exception as e:
        # Non-fatal - don't fail the request if metadata update fails
        logger.warning(f"Failed to update global access time for {blake3_hash}: {e}")


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


class AddVideosRequest(BaseModel):
    videos: List[VideoReference] = Field(..., description="Video references to add")


class FinishAnnotationRequest(BaseModel):
    viewed_duration: float = Field(0, description="High-water mark of video watched in seconds")


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


def _insert_game_videos(cursor, game_id: int, videos: List[VideoReference]) -> None:
    """Insert game_videos rows for a game. Shared by create and add-videos."""
    for video in videos:
        cursor.execute("""
            INSERT INTO game_videos (game_id, blake3_hash, sequence, duration,
                                     video_width, video_height, video_size)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            game_id,
            video.blake3_hash.lower(),
            video.sequence,
            video.duration,
            video.width,
            video.height,
            video.file_size,
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
    For games without video yet: videos is empty.
    """
    # Validate all video hashes exist in R2
    for video in request.videos:
        _validate_video_in_r2(video.blake3_hash.lower())

    # Check if user already has a game with same video(s)
    if len(request.videos) == 1:
        blake3_hash = request.videos[0].blake3_hash.lower()
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Check games.blake3_hash (legacy single-video)
            cursor.execute("SELECT id, name FROM games WHERE blake3_hash = ?", (blake3_hash,))
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
                WHERE gv.blake3_hash = ?
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

        # Compute total duration and use first video's dimensions
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

        cursor.execute("""
            INSERT INTO games (
                name, blake3_hash, video_filename,
                video_duration, video_width, video_height, video_size,
                opponent_name, game_date, game_type, tournament_name
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        ))
        game_id = cursor.lastrowid

        # Insert game_videos rows (for ALL games, including single-video)
        _insert_game_videos(cursor, game_id, request.videos)

        conn.commit()

    logger.info(f"Created game {game_id}: {display_name} with {len(request.videos)} video(s)")

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

        # Update total duration on games table
        cursor.execute("""
            SELECT SUM(duration) as total_duration FROM game_videos WHERE game_id = ?
        """, (game_id,))
        total = cursor.fetchone()
        if total and total['total_duration']:
            cursor.execute(
                "UPDATE games SET video_duration = ? WHERE id = ?",
                (total['total_duration'], game_id)
            )

        conn.commit()

        videos_response = _get_game_videos_response(cursor, game_id)

    logger.info(f"Added {len(request.videos)} video(s) to game {game_id}")
    return {
        "game_id": game_id,
        "videos_added": len(request.videos),
        "videos": videos_response,
    }


@router.get("")
async def list_games():
    """List all saved games. Videos stored globally at games/{blake3_hash}.mp4."""
    ensure_directories()

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT g.id, g.name, g.blake3_hash, g.video_filename, g.created_at,
                   g.clip_count, g.brilliant_count, g.good_count, g.interesting_count,
                   g.mistake_count, g.blunder_count, g.aggregate_score,
                   g.opponent_name, g.game_date, g.game_type, g.tournament_name,
                   g.video_duration, g.viewed_duration,
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

        games = []
        for row in rows:
            # Warn about games missing expected details (helps identify data issues)
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

            # Support both new (blake3_hash) and old (video_filename) storage
            video_url = get_game_video_url(row['blake3_hash'], row['video_filename'])

            games.append({
                'id': row['id'],
                'name': display_name,
                'raw_name': row['name'],
                'blake3_hash': row['blake3_hash'],
                'video_url': video_url,
                'clip_count': row['clip_count'] or 0,
                'brilliant_count': row['brilliant_count'] or 0,
                'good_count': row['good_count'] or 0,
                'interesting_count': row['interesting_count'] or 0,
                'mistake_count': row['mistake_count'] or 0,
                'blunder_count': row['blunder_count'] or 0,
                'aggregate_score': row['aggregate_score'] or 0,
                'created_at': row['created_at'],
                'video_duration': row['effective_duration'],
                'viewed_duration': row['viewed_duration'] or 0,
            })

        return {'games': games}


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
                   viewed_duration
            FROM games
            WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Update last_accessed_at (local + global)
        cursor.execute(
            "UPDATE games SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (game_id,)
        )
        conn.commit()

        # Update global access time in R2 metadata (for cross-user cleanup)
        # Only for new global storage (blake3_hash)
        if row['blake3_hash']:
            update_global_access_time(row['blake3_hash'])

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
            'video_duration': total_duration,
            'video_width': video_width,
            'video_height': video_height,
            'video_size': row['video_size'],
        }


@router.put("/{game_id:int}")
async def update_game(
    game_id: int,
    name: Optional[str] = Form(None)
):
    """Update game name."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Check game exists
        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game not found")

        if name is None:
            raise HTTPException(status_code=400, detail="No updates provided")

        cursor.execute("UPDATE games SET name = ? WHERE id = ?", (name, game_id))
        conn.commit()

        logger.info(f"Updated game {game_id} name to: {name}")
        return {'success': True}


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
    """Delete a game from user's database. Global video is NOT deleted (may be shared)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game not found")

        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()

        logger.info(f"Deleted game {game_id}")
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
        cursor.execute(
            "UPDATE games SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (game_id,)
        )
        conn.commit()

        # Update global access time in R2 metadata (for cross-user cleanup)
        # Only for new global storage (blake3_hash)
        if row['blake3_hash']:
            update_global_access_time(row['blake3_hash'])

        # Support both new (blake3_hash) and old (video_filename) storage
        presigned_url = get_game_video_url(row['blake3_hash'], row['video_filename'])
        if presigned_url:
            return RedirectResponse(url=presigned_url, status_code=302)
        raise HTTPException(status_code=404, detail="Video not available")


# ============================================================================
# Database-backed annotation functions (for Phase 3+ of the refactor)
# ============================================================================

def calculate_aggregates(annotations: list) -> dict:
    """
    Calculate aggregate counts from a list of annotations.

    Returns dict with:
    - clip_count: total number of annotations
    - brilliant_count: rating 5
    - good_count: rating 4
    - interesting_count: rating 3
    - mistake_count: rating 2
    - blunder_count: rating 1
    - aggregate_score: weighted sum
    """
    counts = {
        'clip_count': len(annotations),
        'brilliant_count': 0,
        'good_count': 0,
        'interesting_count': 0,
        'mistake_count': 0,
        'blunder_count': 0,
    }

    for ann in annotations:
        rating = ann.get('rating', 3)
        if rating == 5:
            counts['brilliant_count'] += 1
        elif rating == 4:
            counts['good_count'] += 1
        elif rating == 3:
            counts['interesting_count'] += 1
        elif rating == 2:
            counts['mistake_count'] += 1
        elif rating == 1:
            counts['blunder_count'] += 1

    # Calculate aggregate score
    # Weighted score that rewards good clips and penalizes bad ones
    counts['aggregate_score'] = (
        counts['brilliant_count'] * 10 +
        counts['good_count'] * 5 +
        counts['interesting_count'] * 2 +
        counts['mistake_count'] * -2 +
        counts['blunder_count'] * -5
    )

    return counts


def update_game_aggregates(cursor, game_id: int, annotations: list) -> None:
    """Update the aggregate columns on a game based on its annotations."""
    agg = calculate_aggregates(annotations)
    cursor.execute("""
        UPDATE games SET
            clip_count = ?,
            brilliant_count = ?,
            good_count = ?,
            interesting_count = ?,
            mistake_count = ?,
            blunder_count = ?,
            aggregate_score = ?
        WHERE id = ?
    """, (
        agg['clip_count'],
        agg['brilliant_count'],
        agg['good_count'],
        agg['interesting_count'],
        agg['mistake_count'],
        agg['blunder_count'],
        agg['aggregate_score'],
        game_id
    ))


def load_annotations_from_db(game_id: int) -> list:
    """Load annotations from raw_clips table for a game."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Query raw_clips as the single source of truth for clip annotations
        cursor.execute("""
            SELECT id, start_time, end_time, name, rating, tags, notes, video_sequence
            FROM raw_clips
            WHERE game_id = ?
            ORDER BY video_sequence, end_time
        """, (game_id,))
        rows = cursor.fetchall()

        annotations = []
        for row in rows:
            # Parse tags from JSON string
            tags = json.loads(row['tags']) if row['tags'] else []

            # Generate default name if empty
            name = row['name']
            if not name:
                name = generate_clip_name(row['rating'], tags)

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
            })

        return annotations


def save_annotations_to_db(game_id: int, annotations: list) -> None:
    """
    Save annotations to raw_clips table, syncing with existing records.

    Uses natural key (game_id, end_time, video_sequence) to match annotations with raw_clips.
    - Updates existing clips' metadata (name, rating, tags, notes, start_time)
    - Deletes clips that are no longer in the annotations list
    - New clips are expected to be created via real-time save (with FFmpeg extraction)
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
            end_time = ann.get('end_time', ann.get('start_time', 0))
            video_sequence = ann.get('video_sequence')
            clip_key = (end_time, video_sequence)
            annotation_keys.add(clip_key)

            tags = ann.get('tags', [])
            tags_json = json.dumps(tags)
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
                    ann.get('start_time', 0),
                    name,
                    rating,
                    tags_json,
                    ann.get('notes', ''),
                    existing_clips[clip_key]['id']
                ))
            else:
                # Create new raw_clip with empty filename (pending extraction)
                # This is a fallback if real-time save failed
                cursor.execute("""
                    INSERT INTO raw_clips (filename, rating, tags, name, notes, start_time, end_time, game_id, video_sequence)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    '',  # empty filename = pending extraction
                    rating,
                    tags_json,
                    name,
                    ann.get('notes', ''),
                    ann.get('start_time', 0),
                    end_time,
                    game_id,
                    video_sequence,
                ))
                logger.info(f"Created pending raw_clip for game {game_id} at end_time {end_time} video_sequence {video_sequence}")

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

        # Update aggregates
        update_game_aggregates(cursor, game_id, annotations)

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

    Extraction is NOT triggered here — only happens when clips are added to projects.
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
    else:
        logger.info(f"[FinishAnnotation] User left annotation mode for game {game_id} (no progress update)")

    return {
        "success": True,
        "tasks_created": 0,
        "message": "Annotation session ended"
    }


