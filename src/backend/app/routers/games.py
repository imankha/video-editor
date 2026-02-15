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
import shutil

from app.database import get_db_connection, get_games_path, get_raw_clips_path, ensure_directories
from app.user_context import get_current_user_id
from app.storage import (
    R2_ENABLED,
    generate_presigned_url,
    generate_presigned_url_global,  # T80: For global game storage
    generate_presigned_upload_url,
    upload_to_r2,
    file_exists_in_r2,
)
# Note: Old extraction functions removed - extraction now happens via finish-annotation endpoint
from fastapi import BackgroundTasks
import tempfile

logger = logging.getLogger(__name__)


def get_game_video_url(video_filename: str) -> Optional[str]:
    """
    Get the best URL for accessing a game video.
    Returns presigned R2 URL if R2 is enabled, otherwise None (use local proxy).
    """
    if not R2_ENABLED or not video_filename:
        return None

    user_id = get_current_user_id()
    return generate_presigned_url(
        user_id=user_id,
        relative_path=f"games/{video_filename}",
        expires_in=3600,  # 1 hour
        content_type="video/mp4"
    )

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
    if game_type == 'tournament' and tournament_name:
        prefix = f"{tournament_name}: Vs"
    elif game_type == 'away':
        prefix = "at"
    else:  # home or default
        prefix = "Vs"

    parts = [prefix, opponent_name]
    if date_str:
        parts.append(date_str)

    return " ".join(parts)


@router.get("")
async def list_games():
    """
    List all saved games.

    T80: Games with blake3_hash use global dedup storage (games/{hash}.mp4).
    Games with video_filename use per-user storage (legacy).
    """
    ensure_directories()

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, video_filename, blake3_hash, created_at,
                   clip_count, brilliant_count, good_count, interesting_count,
                   mistake_count, blunder_count, aggregate_score,
                   opponent_name, game_date, game_type, tournament_name
            FROM games
            ORDER BY created_at DESC
        """)
        rows = cursor.fetchall()

        games = []
        for row in rows:
            # Generate display name from game details
            display_name = generate_game_display_name(
                row['opponent_name'],
                row['game_date'],
                row['game_type'],
                row['tournament_name'],
                row['name']
            )

            # Generate video URL based on storage type
            video_url = None
            if row['blake3_hash'] and R2_ENABLED:
                # Global dedup storage
                video_url = generate_presigned_url_global(
                    f"games/{row['blake3_hash']}.mp4",
                    expires_in=14400
                )
            elif row['video_filename']:
                # Legacy per-user storage
                video_url = get_game_video_url(row['video_filename'])

            games.append({
                'id': row['id'],
                'name': display_name,
                'raw_name': row['name'],
                'blake3_hash': row['blake3_hash'],
                'video_filename': row['video_filename'],
                'video_url': video_url,
                'clip_count': row['clip_count'] or 0,
                'brilliant_count': row['brilliant_count'] or 0,
                'good_count': row['good_count'] or 0,
                'interesting_count': row['interesting_count'] or 0,
                'mistake_count': row['mistake_count'] or 0,
                'blunder_count': row['blunder_count'] or 0,
                'aggregate_score': row['aggregate_score'] or 0,
                'created_at': row['created_at'],
                'opponent_name': row['opponent_name'],
                'game_date': row['game_date'],
                'game_type': row['game_type'],
                'tournament_name': row['tournament_name'],
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


@router.post("")
async def create_game(
    name: str = Form(...),
    video: UploadFile = File(None),  # Video is now optional
    video_duration: Optional[float] = Form(None),
    video_width: Optional[int] = Form(None),
    video_height: Optional[int] = Form(None),
    video_size: Optional[int] = Form(None),
    # Game details for display name
    opponent_name: Optional[str] = Form(None),
    game_date: Optional[str] = Form(None),  # ISO format: YYYY-MM-DD
    game_type: Optional[str] = Form(None),  # 'home', 'away', 'tournament'
    tournament_name: Optional[str] = Form(None),
):
    """
    Create a new game, optionally with video.

    If video is provided, it's saved immediately.
    If not, video can be uploaded later via PUT /{game_id}/video.
    Clip annotations are stored in the raw_clips table.

    Video metadata (duration, width, height, size) can be provided to enable
    instant game loading without re-extracting metadata from the video.

    Game details (opponent_name, game_date, game_type, tournament_name) are used
    to generate a display name like "Vs Team Name Dec 6" or "at Team Name Nov 1".
    """
    ensure_directories()

    # Generate unique base name for video
    base_name = uuid.uuid4().hex[:12]
    video_filename = None
    video_path = None

    try:
        # Upload video file directly to R2 if provided (no local storage)
        if video and video.filename:
            original_ext = os.path.splitext(video.filename)[1] or ".mp4"
            video_filename = f"{base_name}{original_ext}"
            user_id = get_current_user_id()

            # Stream to temp file, then upload to R2
            temp_path = Path(tempfile.gettempdir()) / f"upload_{uuid.uuid4().hex}{original_ext}"
            try:
                with open(temp_path, 'wb') as f:
                    total_size = 0
                    while chunk := await video.read(1024 * 1024):  # 1MB chunks
                        f.write(chunk)
                        total_size += len(chunk)

                video_size_mb = total_size / (1024 * 1024)

                if not upload_to_r2(user_id, f"games/{video_filename}", temp_path):
                    raise HTTPException(status_code=500, detail="Failed to upload game video to R2")
                logger.info(f"Uploaded game video to R2: {video_filename} ({video_size_mb:.1f}MB)")
            finally:
                if temp_path.exists():
                    temp_path.unlink()

        # Save to database with video metadata and game details
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO games (name, video_filename,
                                   video_duration, video_width, video_height, video_size,
                                   opponent_name, game_date, game_type, tournament_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (name, video_filename,
                  video_duration, video_width, video_height, video_size,
                  opponent_name, game_date, game_type, tournament_name))
            conn.commit()
            game_id = cursor.lastrowid

        # Generate display name
        display_name = generate_game_display_name(
            opponent_name, game_date, game_type, tournament_name, name
        )

        logger.info(f"Created game {game_id}: {display_name} (video: {'yes' if video_filename else 'pending'})")

        return {
            'success': True,
            'game': {
                'id': game_id,
                'name': display_name,
                'raw_name': name,
                'video_filename': video_filename,
                'video_url': get_game_video_url(video_filename),  # Presigned R2 URL or None
                'clip_count': 0,
                'has_video': video_filename is not None,
                'video_duration': video_duration,
                'video_width': video_width,
                'video_height': video_height,
                'video_size': video_size,
                'opponent_name': opponent_name,
                'game_date': game_date,
                'game_type': game_type,
                'tournament_name': tournament_name,
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
        user_id = get_current_user_id()

        # Note: Old video in R2 is left as-is (could add delete_from_r2 call here if needed)
        if old_video_filename and old_video_filename != video_filename:
            logger.info(f"Replacing old video: {old_video_filename} with {video_filename}")

        # Stream to temp file, then upload to R2 or local storage
        temp_path = Path(tempfile.gettempdir()) / f"upload_{uuid.uuid4().hex}{original_ext}"
        try:
            with open(temp_path, 'wb') as f:
                total_size = 0
                while chunk := await video.read(1024 * 1024):  # 1MB chunks
                    f.write(chunk)
                    total_size += len(chunk)

            video_size_mb = total_size / (1024 * 1024)

            if R2_ENABLED:
                if not upload_to_r2(user_id, f"games/{video_filename}", temp_path):
                    raise HTTPException(status_code=500, detail="Failed to upload game video to R2")
                logger.info(f"Uploaded game video to R2: {video_filename} ({video_size_mb:.1f}MB)")
            else:
                # Local storage fallback
                local_path = get_games_path() / video_filename
                shutil.copy2(temp_path, local_path)
                logger.info(f"Saved game video locally: {video_filename} ({video_size_mb:.1f}MB)")

            # Update database
            cursor.execute("""
                UPDATE games SET video_filename = ? WHERE id = ?
            """, (video_filename, game_id))
            conn.commit()

            logger.info(f"Updated game {game_id} with video: {video_filename}")

            return {
                'success': True,
                'video_filename': video_filename,
                'video_url': get_game_video_url(video_filename),  # Presigned R2 URL or None
                'size_mb': round(video_size_mb, 1),
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to upload video for game {game_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if temp_path.exists():
                temp_path.unlink()


@router.get("/{game_id}/upload-url")
async def get_upload_url(game_id: int, filename: str = "video.mp4"):
    """
    Get a presigned URL for direct browser-to-R2 video upload.

    This allows the frontend to upload directly to R2, bypassing the backend,
    which roughly halves upload time for large files.

    Returns:
        - upload_url: Presigned PUT URL for direct R2 upload
        - video_filename: The filename to use (for confirmation later)
        - r2_enabled: Whether R2 is enabled (if false, use traditional upload)
    """
    if not R2_ENABLED:
        return {
            'r2_enabled': False,
            'upload_url': None,
            'video_filename': None,
            'message': 'R2 not enabled, use traditional upload endpoint'
        }

    # Verify game exists
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT video_filename FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Generate video filename - reuse existing or create new
        old_video_filename = row['video_filename']
        if old_video_filename:
            base_name = os.path.splitext(old_video_filename)[0]
        else:
            base_name = uuid.uuid4().hex[:12]

        original_ext = os.path.splitext(filename)[1] or ".mp4"
        video_filename = f"{base_name}{original_ext}"

    user_id = get_current_user_id()

    # Generate presigned upload URL (valid for 1 hour)
    upload_url = generate_presigned_upload_url(
        user_id=user_id,
        relative_path=f"games/{video_filename}",
        expires_in=3600,
        content_type="video/mp4"
    )

    if not upload_url:
        raise HTTPException(status_code=500, detail="Failed to generate upload URL")

    logger.info(f"Generated presigned upload URL for game {game_id}: {video_filename}")

    return {
        'r2_enabled': True,
        'upload_url': upload_url,
        'video_filename': video_filename,
    }


@router.post("/{game_id}/confirm-video")
async def confirm_video_upload(
    game_id: int,
    video_filename: str = Form(...),
    video_size: Optional[int] = Form(None),
):
    """
    Confirm that a direct R2 upload has completed.

    Called by frontend after successfully uploading to the presigned URL.
    Verifies the file exists in R2 and updates the game record.
    """
    if not R2_ENABLED:
        raise HTTPException(status_code=400, detail="R2 not enabled")

    user_id = get_current_user_id()

    # Verify the file exists in R2
    if not file_exists_in_r2(user_id, f"games/{video_filename}"):
        raise HTTPException(
            status_code=400,
            detail="Video file not found in R2. Upload may have failed."
        )

    # Update game record
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game not found")

        cursor.execute("""
            UPDATE games SET video_filename = ?, video_size = ?
            WHERE id = ?
        """, (video_filename, video_size, game_id))
        conn.commit()

    video_size_mb = (video_size / (1024 * 1024)) if video_size else 0
    logger.info(f"Confirmed direct R2 upload for game {game_id}: {video_filename} ({video_size_mb:.1f}MB)")

    return {
        'success': True,
        'video_filename': video_filename,
        'video_url': get_game_video_url(video_filename),
        'size_mb': round(video_size_mb, 1) if video_size else None,
    }


@router.get("/{game_id}")
async def get_game(game_id: int):
    """
    Get game details including full annotations from database and video metadata.

    T80: Games with blake3_hash use global dedup storage (games/{hash}.mp4).
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, video_filename, blake3_hash, created_at,
                   video_duration, video_width, video_height, video_size,
                   opponent_name, game_date, game_type, tournament_name
            FROM games
            WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Load annotations from database
        annotations = load_annotations_from_db(game_id)

        # Generate display name
        display_name = generate_game_display_name(
            row['opponent_name'],
            row['game_date'],
            row['game_type'],
            row['tournament_name'],
            row['name']
        )

        # Generate video URL based on storage type
        video_url = None
        if row['blake3_hash'] and R2_ENABLED:
            # Global dedup storage
            video_url = generate_presigned_url_global(
                f"games/{row['blake3_hash']}.mp4",
                expires_in=14400
            )
        elif row['video_filename']:
            # Legacy per-user storage
            video_url = get_game_video_url(row['video_filename'])

        return {
            'id': row['id'],
            'name': display_name,
            'raw_name': row['name'],
            'blake3_hash': row['blake3_hash'],
            'video_filename': row['video_filename'],
            'video_url': video_url,
            'annotations': annotations,
            'clip_count': len(annotations),
            'created_at': row['created_at'],
            # Video metadata for instant loading
            'video_duration': row['video_duration'],
            'video_width': row['video_width'],
            'video_height': row['video_height'],
            'video_size': row['video_size'],
            # Game details
            'opponent_name': row['opponent_name'],
            'game_date': row['game_date'],
            'game_type': row['game_type'],
            'tournament_name': row['tournament_name'],
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
    """Delete a game and its video file. Raw clips are deleted separately."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get video filename before deleting
        cursor.execute("SELECT video_filename FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        video_filename = row['video_filename']

        # Delete from database
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()

        # Delete video file (if exists)
        if video_filename:
            video_path = get_games_path() / video_filename
            if video_path.exists():
                video_path.unlink()
                logger.info(f"Deleted game video: {video_filename}")

        logger.info(f"Deleted game {game_id}")
        return {'success': True}


@router.get("/{game_id}/video")
async def get_game_video(game_id: int, request: Request):
    """
    Stream the game video file. Redirects to R2 when enabled.

    T80: Games with blake3_hash use global dedup storage.

    When R2 is enabled, redirects to presigned URL (R2 handles range requests).
    When local, supports HTTP Range requests (206 Partial Content) for efficient
    video seeking without downloading the entire file.
    """
    from fastapi.responses import RedirectResponse

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT blake3_hash, video_filename FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Check for global dedup storage first
        if row['blake3_hash']:
            if R2_ENABLED:
                presigned_url = generate_presigned_url_global(
                    f"games/{row['blake3_hash']}.mp4",
                    expires_in=14400
                )
                if presigned_url:
                    return RedirectResponse(url=presigned_url, status_code=302)
                raise HTTPException(status_code=404, detail="Failed to generate R2 URL")
            else:
                raise HTTPException(status_code=404, detail="R2 required for global game storage")

        # Legacy per-user storage
        video_filename = row['video_filename']
        if not video_filename:
            raise HTTPException(status_code=404, detail="Video not yet uploaded")

        # If R2 enabled, redirect to presigned URL
        if R2_ENABLED:
            presigned_url = get_game_video_url(video_filename)
            if presigned_url:
                return RedirectResponse(url=presigned_url, status_code=302)
            raise HTTPException(status_code=404, detail="Failed to generate R2 URL")

        # Local mode: serve from filesystem with range support
        video_path = get_games_path() / video_filename

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
    """Load annotations from raw_clips table for a game."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Query raw_clips as the single source of truth for clip annotations
        cursor.execute("""
            SELECT id, start_time, end_time, name, rating, tags, notes
            FROM raw_clips
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
                'id': row['id'],  # raw_clip id for frontend sync
                'raw_clip_id': row['id'],  # Also send as raw_clip_id for importAnnotations
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
    Save annotations to raw_clips table, syncing with existing records.

    Uses natural key (game_id, end_time) to match annotations with raw_clips.
    - Updates existing clips' metadata (name, rating, tags, notes, start_time)
    - Deletes clips that are no longer in the annotations list
    - New clips are expected to be created via real-time save (with FFmpeg extraction)
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get existing raw_clips for this game (using end_time as natural key)
        cursor.execute("""
            SELECT id, end_time, filename, auto_project_id
            FROM raw_clips
            WHERE game_id = ?
        """, (game_id,))
        existing_clips = {row['end_time']: dict(row) for row in cursor.fetchall()}

        # Track which end_times are still present in annotations
        annotation_end_times = set()

        for ann in annotations:
            end_time = ann.get('end_time', ann.get('start_time', 0))
            annotation_end_times.add(end_time)

            tags = ann.get('tags', [])
            tags_json = json.dumps(tags)
            rating = ann.get('rating', 3)
            name = ann.get('name', '')

            # Don't store default names - they should be computed on read
            default_name = generate_clip_name(rating, tags)
            if name == default_name:
                name = ''

            if end_time in existing_clips:
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
                    existing_clips[end_time]['id']
                ))
            else:
                # Create new raw_clip with empty filename (pending extraction)
                # This is a fallback if real-time save failed
                cursor.execute("""
                    INSERT INTO raw_clips (filename, rating, tags, name, notes, start_time, end_time, game_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    '',  # empty filename = pending extraction
                    rating,
                    tags_json,
                    name,
                    ann.get('notes', ''),
                    ann.get('start_time', 0),
                    end_time,
                    game_id
                ))
                logger.info(f"Created pending raw_clip for game {game_id} at end_time {end_time}")

        # Delete raw_clips that are no longer in annotations
        for end_time, clip_data in existing_clips.items():
            if end_time not in annotation_end_times:
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


@router.post("/{game_id}/finish-annotation")
async def finish_annotation(game_id: int):
    """
    Called when user leaves annotation mode for a game.

    This endpoint is a no-op - extraction is NOT triggered here.

    Extraction only happens when:
    1. A clip is added to a project (auto-project for 5-star, or manual add)
    2. User chooses "Use Latest" on outdated clips prompt

    This gives the user full control over when extraction (and GPU costs) occur.
    """
    logger.info(f"[FinishAnnotation] User left annotation mode for game {game_id} (no extraction triggered)")
    return {
        "success": True,
        "tasks_created": 0,
        "message": "Annotation session ended"
    }


