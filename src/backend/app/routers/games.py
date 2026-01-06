"""
Games endpoints for the Video Editor API.

This router handles game storage and management:
- /api/games - List all games
- /api/games - Create a game (POST with video)
- /api/games/{id} - Get game details (including annotations from file)
- /api/games/{id} - Update game name
- /api/games/{id} - Delete a game
- /api/games/{id}/video - Stream game video
- /api/games/{id}/annotations - Update annotations (saves to file)
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Body, Request
from fastapi.responses import FileResponse, StreamingResponse
from pathlib import Path
from typing import Optional, List
import os
import uuid
import logging
import mimetypes
import json

from app.database import get_db_connection, GAMES_PATH, ensure_directories

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games"])

# Import rating constants from shared module (single source of truth)
from app.constants import (
    RATING_ADJECTIVES,
    TAG_SHORT_NAMES,
    get_rating_adjective,
    get_tag_short_name,
)


def generate_clip_name(rating: int, tags: list) -> str:
    """
    Generate a default clip name based on rating and tags.
    Must match frontend generateClipName() in soccerTags.js.
    """
    if not tags:
        return ''

    adjective = get_rating_adjective(rating)

    # Convert tag names to short names
    short_names = [get_tag_short_name(tag) for tag in tags]

    # Join with "and" for multiple tags
    if len(short_names) == 1:
        tag_part = short_names[0]
    else:
        tag_part = ', '.join(short_names[:-1]) + ' and ' + short_names[-1]

    return f"{adjective} {tag_part}"


@router.get("")
async def list_games():
    """List all saved games with cached aggregate counts."""
    ensure_directories()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, video_filename, created_at,
                   clip_count, brilliant_count, good_count, interesting_count,
                   mistake_count, blunder_count, aggregate_score
            FROM games
            ORDER BY created_at DESC
        """)
        rows = cursor.fetchall()

        games = []
        for row in rows:
            games.append({
                'id': row['id'],
                'name': row['name'],
                'video_filename': row['video_filename'],
                'clip_count': row['clip_count'] or 0,
                'brilliant_count': row['brilliant_count'] or 0,
                'good_count': row['good_count'] or 0,
                'interesting_count': row['interesting_count'] or 0,
                'mistake_count': row['mistake_count'] or 0,
                'blunder_count': row['blunder_count'] or 0,
                'aggregate_score': row['aggregate_score'] or 0,
                'created_at': row['created_at']
            })

        return {'games': games}


@router.post("")
async def create_game(
    name: str = Form(...),
    video: UploadFile = File(None),  # Video is now optional
    video_duration: Optional[float] = Form(None),
    video_width: Optional[int] = Form(None),
    video_height: Optional[int] = Form(None),
    video_size: Optional[int] = Form(None),
):
    """
    Create a new game, optionally with video.

    If video is provided, it's saved immediately.
    If not, video can be uploaded later via PUT /{game_id}/video.
    Annotations are stored in the database (annotations table).

    Video metadata (duration, width, height, size) can be provided to enable
    instant game loading without re-extracting metadata from the video.
    """
    ensure_directories()

    # Generate unique base name for video
    base_name = uuid.uuid4().hex[:12]
    video_filename = None
    video_path = None

    try:
        # Save video file if provided
        if video and video.filename:
            original_ext = os.path.splitext(video.filename)[1] or ".mp4"
            video_filename = f"{base_name}{original_ext}"
            video_path = GAMES_PATH / video_filename

            # Stream to file in chunks to handle large files
            with open(video_path, 'wb') as f:
                total_size = 0
                while chunk := await video.read(1024 * 1024):  # 1MB chunks
                    f.write(chunk)
                    total_size += len(chunk)

            video_size_mb = total_size / (1024 * 1024)
            logger.info(f"Saved game video: {video_filename} ({video_size_mb:.1f}MB)")

        # Save to database with video metadata
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO games (name, video_filename,
                                   video_duration, video_width, video_height, video_size)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (name, video_filename,
                  video_duration, video_width, video_height, video_size))
            conn.commit()
            game_id = cursor.lastrowid

        logger.info(f"Created game {game_id}: {name} (video: {'yes' if video_filename else 'pending'})")

        return {
            'success': True,
            'game': {
                'id': game_id,
                'name': name,
                'video_filename': video_filename,
                'clip_count': 0,
                'has_video': video_filename is not None,
                'video_duration': video_duration,
                'video_width': video_width,
                'video_height': video_height,
                'video_size': video_size,
            }
        }

    except Exception as e:
        # Clean up video file if database insert failed
        if video_path and video_path.exists():
            video_path.unlink()
        logger.error(f"Failed to create game: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{game_id}/video")
async def upload_game_video(
    game_id: int,
    video: UploadFile = File(...)
):
    """
    Upload or replace video for an existing game.
    This allows creating a game first (for annotations) then uploading video later.
    """
    ensure_directories()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT video_filename FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        old_video_filename = row['video_filename']

        # Generate new video filename
        # If replacing existing video, use same base name; otherwise generate new UUID
        if old_video_filename:
            base_name = os.path.splitext(old_video_filename)[0]
        else:
            base_name = uuid.uuid4().hex[:12]
        original_ext = os.path.splitext(video.filename or "video.mp4")[1] or ".mp4"
        video_filename = f"{base_name}{original_ext}"
        video_path = GAMES_PATH / video_filename

        try:
            # Delete old video if exists and different filename
            if old_video_filename and old_video_filename != video_filename:
                old_video_path = GAMES_PATH / old_video_filename
                if old_video_path.exists():
                    old_video_path.unlink()
                    logger.info(f"Deleted old video: {old_video_filename}")

            # Stream new video to file in chunks
            with open(video_path, 'wb') as f:
                total_size = 0
                while chunk := await video.read(1024 * 1024):  # 1MB chunks
                    f.write(chunk)
                    total_size += len(chunk)

            video_size_mb = total_size / (1024 * 1024)
            logger.info(f"Saved game video: {video_filename} ({video_size_mb:.1f}MB)")

            # Update database
            cursor.execute("""
                UPDATE games SET video_filename = ? WHERE id = ?
            """, (video_filename, game_id))
            conn.commit()

            logger.info(f"Updated game {game_id} with video: {video_filename}")

            return {
                'success': True,
                'video_filename': video_filename,
                'size_mb': round(video_size_mb, 1)
            }

        except Exception as e:
            # Clean up new video if update failed
            if video_path.exists():
                video_path.unlink()
            logger.error(f"Failed to upload video for game {game_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/{game_id}")
async def get_game(game_id: int):
    """Get game details including full annotations from database and video metadata."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, video_filename, created_at,
                   video_duration, video_width, video_height, video_size
            FROM games
            WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Load annotations from database
        annotations = load_annotations_from_db(game_id)

        return {
            'id': row['id'],
            'name': row['name'],
            'video_filename': row['video_filename'],
            'annotations': annotations,
            'clip_count': len(annotations),
            'created_at': row['created_at'],
            # Video metadata for instant loading
            'video_duration': row['video_duration'],
            'video_width': row['video_width'],
            'video_height': row['video_height'],
            'video_size': row['video_size'],
        }


@router.put("/{game_id}")
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


@router.put("/{game_id}/annotations")
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


@router.delete("/{game_id}")
async def delete_game(game_id: int):
    """Delete a game and its video file. Annotations are deleted via CASCADE."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get video filename before deleting
        cursor.execute("SELECT video_filename FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        video_filename = row['video_filename']

        # Delete from database (annotations deleted via CASCADE)
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()

        # Delete video file (if exists)
        if video_filename:
            video_path = GAMES_PATH / video_filename
            if video_path.exists():
                video_path.unlink()
                logger.info(f"Deleted game video: {video_filename}")

        logger.info(f"Deleted game {game_id}")
        return {'success': True}


@router.get("/{game_id}/video")
async def get_game_video(game_id: int, request: Request):
    """
    Stream the game video file with Range request support.

    Supports HTTP Range requests (206 Partial Content) for efficient
    video seeking without downloading the entire file.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT video_filename FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        video_filename = row['video_filename']
        if not video_filename:
            raise HTTPException(status_code=404, detail="Video not yet uploaded")

        video_path = GAMES_PATH / video_filename

        if not video_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        file_size = video_path.stat().st_size

        # Determine media type
        media_type, _ = mimetypes.guess_type(str(video_path))
        if not media_type:
            media_type = 'video/mp4'

        # Check for Range header
        range_header = request.headers.get('range')

        if range_header:
            # Parse Range header (e.g., "bytes=0-1000")
            try:
                range_spec = range_header.replace('bytes=', '')
                range_parts = range_spec.split('-')
                start = int(range_parts[0]) if range_parts[0] else 0
                end = int(range_parts[1]) if range_parts[1] else file_size - 1

                # Clamp to valid range
                start = max(0, start)
                end = min(end, file_size - 1)
                content_length = end - start + 1

                def iter_file():
                    with open(video_path, 'rb') as f:
                        f.seek(start)
                        remaining = content_length
                        chunk_size = 1024 * 1024  # 1MB chunks
                        while remaining > 0:
                            chunk = f.read(min(chunk_size, remaining))
                            if not chunk:
                                break
                            remaining -= len(chunk)
                            yield chunk

                headers = {
                    'Content-Range': f'bytes {start}-{end}/{file_size}',
                    'Accept-Ranges': 'bytes',
                    'Content-Length': str(content_length),
                    'Content-Type': media_type,
                }

                return StreamingResponse(
                    iter_file(),
                    status_code=206,
                    headers=headers,
                    media_type=media_type
                )
            except (ValueError, IndexError):
                # Invalid range header, fall through to full file response
                pass

        # No Range header or invalid - return full file
        return FileResponse(
            path=str(video_path),
            media_type=media_type,
            filename=video_filename,
            headers={'Accept-Ranges': 'bytes'}
        )


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
    """Load annotations from the database for a game."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, start_time, end_time, name, rating, tags, notes
            FROM annotations
            WHERE game_id = ?
            ORDER BY end_time
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
                'start_time': row['start_time'],
                'end_time': row['end_time'],
                'name': name,
                'rating': row['rating'],
                'tags': tags,
                'notes': row['notes'] or ''
            })

        return annotations


def save_annotations_to_db(game_id: int, annotations: list) -> None:
    """
    Save annotations to the database, replacing any existing ones.

    This uses a batch replace pattern:
    1. DELETE all existing annotations for the game
    2. INSERT all new annotations
    3. UPDATE aggregates on the game
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Delete existing annotations
        cursor.execute("DELETE FROM annotations WHERE game_id = ?", (game_id,))

        # Insert new annotations
        for ann in annotations:
            tags = ann.get('tags', [])
            tags_json = json.dumps(tags)
            rating = ann.get('rating', 3)
            name = ann.get('name', '')

            # Don't store default names - they should be computed on read
            # A name is "default" if it matches what generate_clip_name would produce
            default_name = generate_clip_name(rating, tags)
            if name == default_name:
                name = ''  # Store empty, will be regenerated on load

            cursor.execute("""
                INSERT INTO annotations (game_id, start_time, end_time, name, rating, tags, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                game_id,
                ann.get('start_time', 0),
                ann.get('end_time', ann.get('start_time', 0)),
                name,
                rating,
                tags_json,
                ann.get('notes', '')
            ))

        # Update aggregates
        update_game_aggregates(cursor, game_id, annotations)

        conn.commit()
