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

from app.database import get_db_connection, GAMES_PATH, ensure_directories

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games"])

# TSV column headers (must match frontend useAnnotate.js REQUIRED_COLUMNS)
TSV_COLUMNS = ['start_time', 'rating', 'tags', 'clip_name', 'clip_duration', 'notes']


def format_time_for_tsv(seconds: float) -> str:
    """Format seconds as M:SS or MM:SS for TSV export."""
    total_seconds = int(seconds)
    minutes = total_seconds // 60
    secs = total_seconds % 60
    return f"{minutes}:{secs:02d}"


def parse_time_from_tsv(time_str: str) -> float:
    """Parse M:SS or MM:SS time string to seconds."""
    parts = time_str.split(':')
    minutes = int(parts[0])
    seconds = int(parts[1])
    return minutes * 60 + seconds


def get_annotations_path(annotations_filename: str) -> Path:
    """Get the full path to an annotations file."""
    return GAMES_PATH / annotations_filename


def load_annotations(annotations_filename: Optional[str]) -> list:
    """Load annotations from a TSV file."""
    if not annotations_filename:
        return []

    annotations_path = get_annotations_path(annotations_filename)
    if not annotations_path.exists():
        return []

    try:
        with open(annotations_path, 'r', encoding='utf-8') as f:
            lines = f.read().strip().split('\n')

        if len(lines) < 2:  # Header only or empty
            return []

        # Skip header, parse data rows
        annotations = []
        for line in lines[1:]:
            if not line.strip():
                continue

            cols = line.split('\t')
            # Pad missing columns (notes is optional)
            while len(cols) < len(TSV_COLUMNS):
                cols.append('')

            start_time = parse_time_from_tsv(cols[0])
            rating = int(cols[1])
            tags = [t.strip() for t in cols[2].split(',') if t.strip()]
            clip_name = cols[3]
            clip_duration = float(cols[4]) if cols[4] else 0
            notes = cols[5] if len(cols) > 5 else ''

            annotations.append({
                'start_time': start_time,
                'end_time': start_time + clip_duration,
                'name': clip_name,
                'tags': tags,
                'notes': notes,
                'rating': rating
            })

        return annotations
    except (ValueError, IOError) as e:
        logger.error(f"Failed to load annotations from {annotations_filename}: {e}")
        return []


def save_annotations(annotations_filename: str, annotations: list) -> bool:
    """Save annotations to a TSV file."""
    annotations_path = get_annotations_path(annotations_filename)
    try:
        with open(annotations_path, 'w', encoding='utf-8') as f:
            # Write header
            f.write('\t'.join(TSV_COLUMNS) + '\n')

            # Write data rows
            for ann in annotations:
                start_time = ann.get('start_time', 0)
                end_time = ann.get('end_time', start_time)
                duration = end_time - start_time

                # Format duration with max 1 decimal place
                duration_str = f"{duration:.1f}" if duration % 1 else str(int(duration))

                row = [
                    format_time_for_tsv(start_time),
                    str(ann.get('rating', 3)),
                    ','.join(ann.get('tags', [])),
                    ann.get('name', ''),
                    duration_str,
                    ann.get('notes', '')
                ]
                f.write('\t'.join(row) + '\n')

        return True
    except IOError as e:
        logger.error(f"Failed to save annotations to {annotations_filename}: {e}")
        return False


@router.get("")
async def list_games():
    """List all saved games."""
    ensure_directories()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, video_filename, annotations_filename, created_at
            FROM games
            ORDER BY created_at DESC
        """)
        rows = cursor.fetchall()

        games = []
        for row in rows:
            # Load annotations to get clip count
            annotations = load_annotations(row['annotations_filename'])
            games.append({
                'id': row['id'],
                'name': row['name'],
                'video_filename': row['video_filename'],
                'clip_count': len(annotations),
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
    An empty annotations file is always created.

    Video metadata (duration, width, height, size) can be provided to enable
    instant game loading without re-extracting metadata from the video.
    """
    ensure_directories()

    # Generate unique base name for video and annotations
    base_name = uuid.uuid4().hex[:12]
    annotations_filename = f"{base_name}_annotations.tsv"
    annotations_path = GAMES_PATH / annotations_filename

    video_filename = None
    video_path = None

    try:
        # Create empty annotations file (TSV with header only)
        with open(annotations_path, 'w', encoding='utf-8') as f:
            f.write('\t'.join(TSV_COLUMNS) + '\n')
        logger.info(f"Created annotations file: {annotations_filename}")

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
                INSERT INTO games (name, video_filename, annotations_filename,
                                   video_duration, video_width, video_height, video_size)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (name, video_filename, annotations_filename,
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
                'annotations_filename': annotations_filename,
                'clip_count': 0,
                'has_video': video_filename is not None,
                'video_duration': video_duration,
                'video_width': video_width,
                'video_height': video_height,
                'video_size': video_size,
            }
        }

    except Exception as e:
        # Clean up files if database insert failed
        if video_path and video_path.exists():
            video_path.unlink()
        if annotations_path.exists():
            annotations_path.unlink()
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
        cursor.execute("""
            SELECT video_filename, annotations_filename FROM games WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        old_video_filename = row['video_filename']
        annotations_filename = row['annotations_filename']

        # Generate new video filename using same base as annotations
        base_name = annotations_filename.replace('_annotations.tsv', '')
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
    """Get game details including full annotations from file and video metadata."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, video_filename, annotations_filename, created_at,
                   video_duration, video_width, video_height, video_size
            FROM games
            WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Load annotations from file
        annotations = load_annotations(row['annotations_filename'])

        return {
            'id': row['id'],
            'name': row['name'],
            'video_filename': row['video_filename'],
            'annotations_filename': row['annotations_filename'],
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

    Saves annotations to the TSV file associated with this game.
    Call this whenever annotations change in the frontend.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT annotations_filename FROM games WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        annotations_filename = row['annotations_filename']

        if not annotations_filename:
            # Create annotations file if it doesn't exist
            cursor.execute("SELECT video_filename FROM games WHERE id = ?", (game_id,))
            video_row = cursor.fetchone()
            base_name = os.path.splitext(video_row['video_filename'])[0]
            annotations_filename = f"{base_name}_annotations.tsv"
            cursor.execute("""
                UPDATE games SET annotations_filename = ? WHERE id = ?
            """, (annotations_filename, game_id))
            conn.commit()

        # Save annotations to file
        if not save_annotations(annotations_filename, annotations):
            raise HTTPException(status_code=500, detail="Failed to save annotations")

        logger.info(f"Updated annotations for game {game_id}: {len(annotations)} clips")
        return {
            'success': True,
            'clip_count': len(annotations)
        }


@router.delete("/{game_id}")
async def delete_game(game_id: int):
    """Delete a game, its video file, and its annotations file."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get filenames before deleting
        cursor.execute("""
            SELECT video_filename, annotations_filename FROM games WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        video_filename = row['video_filename']
        annotations_filename = row['annotations_filename']

        # Delete from database
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()

        # Delete video file (if exists)
        if video_filename:
            video_path = GAMES_PATH / video_filename
            if video_path.exists():
                video_path.unlink()
                logger.info(f"Deleted game video: {video_filename}")

        # Delete annotations file
        if annotations_filename:
            annotations_path = GAMES_PATH / annotations_filename
            if annotations_path.exists():
                annotations_path.unlink()
                logger.info(f"Deleted annotations file: {annotations_filename}")

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
