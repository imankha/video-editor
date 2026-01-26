"""
Clip management endpoints.

Two types of clips:
1. Raw Clips - Saved in real-time during annotation, stored in library
2. Working Clips - Assigned to projects for editing

Files are stored in:
- raw_clips/ - Clips extracted from annotated games
- uploads/ - Clips uploaded directly to projects
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import os
import uuid
import json
import logging

from app.database import (
    get_db_connection,
    get_raw_clips_path,
    get_uploads_path,
    get_games_path,
)
from app.queries import latest_working_clips_subquery, derive_clip_name
from app.services.ffmpeg_service import extract_clip
from app.services.modal_client import modal_enabled, call_modal_extract_clip
from app.user_context import get_current_user_id
from app.storage import generate_presigned_url, upload_to_r2, upload_bytes_to_r2, download_from_r2
import tempfile
import asyncio
from pathlib import Path

logger = logging.getLogger(__name__)


def get_raw_clip_url(filename: str) -> Optional[str]:
    """
    Get presigned URL for raw clip.
    """
    if not filename:
        return None

    user_id = get_current_user_id()
    return generate_presigned_url(
        user_id=user_id,
        relative_path=f"raw_clips/{filename}",
        expires_in=3600,
        content_type="video/mp4"
    )


def get_working_clip_url(filename: str, source_type: str) -> Optional[str]:
    """
    Get presigned URL for working clip.
    Working clips can come from raw_clips or uploads directory.
    """
    if not filename:
        return None

    user_id = get_current_user_id()

    # Determine directory based on source type
    if source_type == 'upload':
        directory = 'uploads'
    else:
        directory = 'raw_clips'

    return generate_presigned_url(
        user_id=user_id,
        relative_path=f"{directory}/{filename}",
        expires_in=3600,
        content_type="video/mp4"
    )


router = APIRouter(prefix="/api/clips", tags=["clips"])


def normalize_json_data(value: Optional[str]) -> Optional[str]:
    """Convert empty JSON to NULL for consistent storage.

    This ensures we don't have multiple representations of 'no data'
    (NULL, '', '[]', '{}') which complicates queries.
    """
    if value is None:
        return None
    if value in ('', '[]', '{}', 'null'):
        return None
    return value


class RawClipResponse(BaseModel):
    id: int
    filename: str
    file_url: Optional[str] = None  # Presigned R2 URL or None (use local proxy)
    rating: int
    tags: List[str]
    name: Optional[str] = None
    notes: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    game_id: Optional[int] = None
    auto_project_id: Optional[int] = None
    created_at: str


class RawClipCreate(BaseModel):
    """Request body for creating a raw clip during annotation."""
    game_id: int
    start_time: float
    end_time: float
    name: str = ""
    rating: int = 3
    tags: List[str] = []
    notes: str = ""


class RawClipUpdate(BaseModel):
    """Request body for updating a raw clip."""
    name: Optional[str] = None
    rating: Optional[int] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None


class RawClipSaveResponse(BaseModel):
    """Response from creating a raw clip."""
    raw_clip_id: int
    filename: str
    project_created: bool = False
    project_id: Optional[int] = None


class WorkingClipCreate(BaseModel):
    raw_clip_id: Optional[int] = None  # If adding from library


class WorkingClipResponse(BaseModel):
    id: int
    project_id: int
    raw_clip_id: Optional[int]
    uploaded_filename: Optional[str]
    filename: str
    file_url: Optional[str] = None  # Presigned R2 URL or None (use local proxy)
    name: Optional[str] = None
    notes: Optional[str] = None
    exported_at: Optional[str] = None  # ISO timestamp when clip was exported (NULL = not exported)
    sort_order: int
    crop_data: Optional[str] = None
    timing_data: Optional[str] = None
    segments_data: Optional[str] = None


class WorkingClipUpdate(BaseModel):
    sort_order: Optional[int] = None
    crop_data: Optional[str] = None
    timing_data: Optional[str] = None
    segments_data: Optional[str] = None


# ============ RAW CLIPS (LIBRARY) ============

@router.get("/raw", response_model=List[RawClipResponse])
async def list_raw_clips(game_id: Optional[int] = None, min_rating: Optional[int] = None):
    """List all raw clips in the library, optionally filtered by game and/or rating."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        query = """
            SELECT id, filename, rating, tags, name, notes, start_time, end_time,
                   game_id, auto_project_id, created_at
            FROM raw_clips
            WHERE 1=1
        """
        params = []

        if game_id is not None:
            query += " AND game_id = ?"
            params.append(game_id)

        if min_rating is not None:
            query += " AND rating >= ?"
            params.append(min_rating)

        query += " ORDER BY created_at DESC"

        cursor.execute(query, params)
        clips = cursor.fetchall()

        result = []
        for clip in clips:
            tags = json.loads(clip['tags']) if clip['tags'] else []
            result.append(RawClipResponse(
                id=clip['id'],
                filename=clip['filename'],
                file_url=get_raw_clip_url(clip['filename']),
                rating=clip['rating'],
                tags=tags,
                name=derive_clip_name(clip['name'], clip['rating'], tags),
                notes=clip['notes'],
                start_time=clip['start_time'],
                end_time=clip['end_time'],
                game_id=clip['game_id'],
                auto_project_id=clip['auto_project_id'],
                created_at=clip['created_at']
            ))
        return result


@router.get("/raw/{clip_id}", response_model=RawClipResponse)
async def get_raw_clip(clip_id: int):
    """Get a single raw clip's metadata."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, filename, rating, tags, name, notes, start_time, end_time,
                   game_id, auto_project_id, created_at
            FROM raw_clips WHERE id = ?
        """, (clip_id,))
        clip = cursor.fetchone()

        if not clip:
            raise HTTPException(status_code=404, detail="Raw clip not found")

        tags = json.loads(clip['tags']) if clip['tags'] else []
        return RawClipResponse(
            id=clip['id'],
            filename=clip['filename'],
            file_url=get_raw_clip_url(clip['filename']),
            rating=clip['rating'],
            tags=tags,
            name=derive_clip_name(clip['name'], clip['rating'], tags),
            notes=clip['notes'],
            start_time=clip['start_time'],
            end_time=clip['end_time'],
            game_id=clip['game_id'],
            auto_project_id=clip['auto_project_id'],
            created_at=clip['created_at']
        )


@router.get("/raw/{clip_id}/file")
async def get_raw_clip_file(clip_id: int):
    """Stream a raw clip video file. Redirects to R2 presigned URL."""
    from fastapi.responses import RedirectResponse

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT filename FROM raw_clips WHERE id = ?", (clip_id,))
        clip = cursor.fetchone()

        if not clip:
            raise HTTPException(status_code=404, detail="Raw clip not found")

        presigned_url = get_raw_clip_url(clip['filename'])
        if presigned_url:
            return RedirectResponse(url=presigned_url, status_code=302)
        raise HTTPException(status_code=404, detail="Failed to generate R2 URL")


def _create_auto_project_for_clip(cursor, raw_clip_id: int, clip_name: str) -> int:
    """Create a 9:16 project for a 5-star clip and return the project ID."""
    # Create the project
    project_name = clip_name if clip_name else f"Clip {raw_clip_id}"
    cursor.execute("""
        INSERT INTO projects (name, aspect_ratio)
        VALUES (?, '9:16')
    """, (project_name,))
    project_id = cursor.lastrowid

    # Add the raw clip as a working clip in this project
    cursor.execute("""
        INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version)
        VALUES (?, ?, 0, 1)
    """, (project_id, raw_clip_id))

    # Update the raw clip with the auto_project_id
    cursor.execute("""
        UPDATE raw_clips SET auto_project_id = ? WHERE id = ?
    """, (project_id, raw_clip_id))

    logger.info(f"Created auto-project {project_id} for 5-star clip {raw_clip_id}")
    return project_id


def _delete_auto_project(cursor, project_id: int, raw_clip_id: int) -> bool:
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

    # Clear the auto_project_id from the raw clip
    cursor.execute("""
        UPDATE raw_clips SET auto_project_id = NULL WHERE id = ?
    """, (raw_clip_id,))

    logger.info(f"Deleted unmodified auto-project {project_id}")
    return True


def extract_pending_clips_for_game(game_id: int, video_filename: str) -> dict:
    """
    Extract video files for all pending clips (filename=NULL) for a game.

    Called when a game's video upload completes. Finds all raw_clips that were
    saved during annotation but couldn't be extracted because video wasn't uploaded.

    Returns dict with counts: {extracted: N, failed: N, projects_created: N}
    """
    user_id = get_current_user_id()
    results = {'extracted': 0, 'failed': 0, 'projects_created': 0}

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Find all pending clips (filename is empty) for this game
        cursor.execute("""
            SELECT id, start_time, end_time, rating, name
            FROM raw_clips
            WHERE game_id = ? AND (filename IS NULL OR filename = '')
        """, (game_id,))
        pending_clips = cursor.fetchall()

        if not pending_clips:
            logger.info(f"No pending clips to extract for game {game_id}")
            return results

        logger.info(f"Extracting {len(pending_clips)} pending clips for game {game_id}")

        # Use Modal when enabled (cloud processing, no local downloads)
        if modal_enabled():
            logger.info(f"[Modal] Using Modal for clip extraction (R2 -> Modal -> R2)")

            for clip in pending_clips:
                clip_id = clip['id']
                try:
                    # Generate unique filename for the clip
                    clip_filename = f"{uuid.uuid4().hex[:12]}.mp4"

                    # Call Modal to extract directly from R2
                    result = asyncio.run(call_modal_extract_clip(
                        user_id=user_id,
                        input_key=f"games/{video_filename}",
                        output_key=f"raw_clips/{clip_filename}",
                        start_time=clip['start_time'],
                        end_time=clip['end_time'],
                        copy_codec=True,
                    ))

                    if result.get("status") != "success":
                        logger.error(f"[Modal] Failed to extract clip {clip_id}: {result.get('error')}")
                        results['failed'] += 1
                        continue

                    # Update the clip with the filename
                    cursor.execute("""
                        UPDATE raw_clips SET filename = ? WHERE id = ?
                    """, (clip_filename, clip_id))

                    results['extracted'] += 1
                    logger.info(f"[Modal] Extracted pending clip {clip_id}: {clip_filename}")

                    # If 5-star clip, create auto-project now
                    if clip['rating'] == 5:
                        project_id = _create_auto_project_for_clip(cursor, clip_id, clip['name'])
                        if project_id:
                            results['projects_created'] += 1
                            logger.info(f"Created auto-project {project_id} for pending 5-star clip {clip_id}")

                except Exception as e:
                    logger.error(f"[Modal] Error extracting clip {clip_id}: {e}")
                    results['failed'] += 1

            conn.commit()

        else:
            # Local processing with R2 storage: download from R2, process locally, upload back to R2
            temp_video_path = Path(tempfile.gettempdir()) / f"game_video_{uuid.uuid4().hex[:8]}.mp4"
            if not download_from_r2(user_id, f"games/{video_filename}", temp_video_path):
                logger.error(f"Failed to download game video from R2: {video_filename}")
                return results
            video_path = temp_video_path

            try:
                for clip in pending_clips:
                    clip_id = clip['id']
                    try:
                        # Generate unique filename for the clip
                        clip_filename = f"{uuid.uuid4().hex[:12]}.mp4"
                        temp_clip_path = Path(tempfile.gettempdir()) / f"clip_{uuid.uuid4().hex[:8]}.mp4"

                        # Extract the clip locally
                        success = extract_clip(
                            input_path=str(video_path),
                            output_path=str(temp_clip_path),
                            start_time=clip['start_time'],
                            end_time=clip['end_time'],
                            copy_codec=True
                        )

                        if not success:
                            logger.error(f"Failed to extract clip {clip_id}")
                            results['failed'] += 1
                            continue

                        # Upload to R2
                        if not upload_to_r2(user_id, f"raw_clips/{clip_filename}", temp_clip_path):
                            logger.error(f"Failed to upload clip {clip_id} to R2")
                            results['failed'] += 1
                            if temp_clip_path.exists():
                                temp_clip_path.unlink()
                            continue

                        if temp_clip_path.exists():
                            temp_clip_path.unlink()

                        # Update the clip with the filename
                        cursor.execute("""
                            UPDATE raw_clips SET filename = ? WHERE id = ?
                        """, (clip_filename, clip_id))

                        results['extracted'] += 1
                        logger.info(f"Extracted pending clip {clip_id}: {clip_filename}")

                        # If 5-star clip, create auto-project now
                        if clip['rating'] == 5:
                            project_id = _create_auto_project_for_clip(cursor, clip_id, clip['name'])
                            if project_id:
                                results['projects_created'] += 1
                                logger.info(f"Created auto-project {project_id} for pending 5-star clip {clip_id}")

                    except Exception as e:
                        logger.error(f"Error extracting clip {clip_id}: {e}")
                        results['failed'] += 1

                conn.commit()

            finally:
                # Clean up temp video file
                if temp_video_path and temp_video_path.exists():
                    temp_video_path.unlink()

    logger.info(f"Pending clip extraction complete for game {game_id}: {results}")
    return results


def extract_all_pending_clips() -> dict:
    """
    Extract pending clips for ALL games that have videos uploaded.

    Called on startup recovery or manually via endpoint.
    Finds all raw_clips with filename=NULL where the game has a video,
    and extracts them.

    Returns dict with total counts across all games.
    """
    total_results = {'games_processed': 0, 'extracted': 0, 'failed': 0, 'projects_created': 0}

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Find all games that have videos AND have pending clips
        cursor.execute("""
            SELECT DISTINCT g.id, g.video_filename
            FROM games g
            INNER JOIN raw_clips rc ON rc.game_id = g.id
            WHERE g.video_filename IS NOT NULL AND g.video_filename != ''
              AND (rc.filename IS NULL OR rc.filename = '')
        """)
        games_with_pending = cursor.fetchall()

        if not games_with_pending:
            logger.info("No games with pending clips found")
            return total_results

        logger.info(f"Found {len(games_with_pending)} games with pending clips")

    # Process each game (outside the connection to avoid long locks)
    for game in games_with_pending:
        game_id = game['id']
        video_filename = game['video_filename']

        try:
            results = extract_pending_clips_for_game(game_id, video_filename)
            total_results['games_processed'] += 1
            total_results['extracted'] += results['extracted']
            total_results['failed'] += results['failed']
            total_results['projects_created'] += results['projects_created']
        except Exception as e:
            logger.error(f"Failed to extract pending clips for game {game_id}: {e}")
            total_results['failed'] += 1

    logger.info(f"Pending clip extraction complete: {total_results}")
    return total_results


@router.post("/extract-pending")
async def trigger_pending_extraction():
    """
    Manually trigger extraction of all pending clips.

    Use this for crash recovery or to process clips that failed to extract.
    Finds all raw_clips with filename=NULL where the game has a video uploaded,
    and extracts them.
    """
    results = extract_all_pending_clips()
    return {
        'success': True,
        'games_processed': results['games_processed'],
        'clips_extracted': results['extracted'],
        'clips_failed': results['failed'],
        'projects_created': results['projects_created'],
    }


@router.post("/raw/save", response_model=RawClipSaveResponse)
async def save_raw_clip(clip_data: RawClipCreate):
    """
    Save a raw clip during annotation (real-time save).

    Extracts the clip from the game video and saves it to the library.
    If the clip is rated 5 stars, automatically creates a 9:16 project for it.

    Idempotent: If a clip with the same game_id + end_time already exists,
    returns that clip's ID instead of creating a duplicate.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Check if clip already exists (lookup by game_id + end_time as natural key)
        cursor.execute("""
            SELECT id, filename, rating, auto_project_id FROM raw_clips
            WHERE game_id = ? AND end_time = ?
        """, (clip_data.game_id, clip_data.end_time))
        existing = cursor.fetchone()

        if existing:
            # Clip already exists - update it with new data and return existing ID
            logger.info(f"Found existing clip {existing['id']} for game {clip_data.game_id} at end_time {clip_data.end_time}")

            # Update the existing clip with any new metadata
            cursor.execute("""
                UPDATE raw_clips SET
                    name = ?,
                    rating = ?,
                    tags = ?,
                    notes = ?,
                    start_time = ?
                WHERE id = ?
            """, (
                clip_data.name,
                clip_data.rating,
                json.dumps(clip_data.tags),
                clip_data.notes,
                clip_data.start_time,
                existing['id']
            ))

            # Handle 5-star project sync for existing clip
            old_rating = existing['rating']
            new_rating = clip_data.rating
            project_created = False
            project_id = existing['auto_project_id']

            if new_rating == 5 and old_rating != 5 and not project_id:
                # Upgraded to 5-star, create auto-project
                project_id = _create_auto_project_for_clip(cursor, existing['id'], clip_data.name)
                project_created = True
            elif new_rating != 5 and old_rating == 5 and project_id:
                # Downgraded from 5-star, delete auto-project
                _delete_auto_project(cursor, existing['id'], project_id)
                project_id = None

            conn.commit()

            return RawClipSaveResponse(
                raw_clip_id=existing['id'],
                filename=existing['filename'],
                project_created=project_created,
                project_id=project_id
            )

        # Get the game's video file
        cursor.execute("""
            SELECT video_filename FROM games WHERE id = ?
        """, (clip_data.game_id,))
        game = cursor.fetchone()

        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        # If video isn't uploaded yet, save metadata only (pending extraction)
        if not game['video_filename']:
            logger.info(f"Video not yet uploaded for game {clip_data.game_id}, saving clip metadata only (pending extraction)")

            # Save to database with empty filename (indicates pending extraction)
            # Using empty string instead of NULL for SQLite NOT NULL constraint compatibility
            cursor.execute("""
                INSERT INTO raw_clips (filename, rating, tags, name, notes, start_time, end_time, game_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                '',  # empty string = pending extraction (NOT NULL compatible)
                clip_data.rating,
                json.dumps(clip_data.tags),
                clip_data.name,
                clip_data.notes,
                clip_data.start_time,
                clip_data.end_time,
                clip_data.game_id
            ))
            raw_clip_id = cursor.lastrowid

            # Don't create auto-project yet - will be created after extraction
            conn.commit()
            logger.info(f"Saved pending raw clip {raw_clip_id} (will extract when video uploads)")

            return RawClipSaveResponse(
                raw_clip_id=raw_clip_id,
                filename='',  # empty = pending
                project_created=False,
                project_id=None
            )

        # Generate unique filename for the clip
        clip_filename = f"{uuid.uuid4().hex[:12]}.mp4"
        user_id = get_current_user_id()

        # Use Modal when enabled (cloud processing, no local downloads)
        if modal_enabled():
            logger.info(f"[Modal] Extracting clip via Modal (R2 -> Modal -> R2)")

            result = asyncio.run(call_modal_extract_clip(
                user_id=user_id,
                input_key=f"games/{game['video_filename']}",
                output_key=f"raw_clips/{clip_filename}",
                start_time=clip_data.start_time,
                end_time=clip_data.end_time,
                copy_codec=True,
            ))

            if result.get("status") != "success":
                raise HTTPException(status_code=500, detail=f"Modal clip extraction failed: {result.get('error')}")

            logger.info(f"[Modal] Extracted clip: {clip_filename}")

        else:
            # Local processing with R2 storage: download from R2, process locally, upload back to R2
            temp_video_path = Path(tempfile.gettempdir()) / f"game_video_{uuid.uuid4().hex[:8]}.mp4"
            temp_clip_path = Path(tempfile.gettempdir()) / f"clip_{uuid.uuid4().hex[:8]}.mp4"

            try:
                if not download_from_r2(user_id, f"games/{game['video_filename']}", temp_video_path):
                    raise HTTPException(status_code=404, detail="Game video file not found in R2")

                # Extract the clip using FFmpeg
                success = extract_clip(
                    input_path=str(temp_video_path),
                    output_path=str(temp_clip_path),
                    start_time=clip_data.start_time,
                    end_time=clip_data.end_time,
                    copy_codec=True  # Fast extraction without re-encoding
                )

                if not success:
                    raise HTTPException(status_code=500, detail="Failed to extract clip")

                # Upload extracted clip to R2
                if not upload_to_r2(user_id, f"raw_clips/{clip_filename}", temp_clip_path):
                    raise HTTPException(status_code=500, detail="Failed to upload clip to R2")

                logger.info(f"Extracted and uploaded clip to R2: {clip_filename}")

            finally:
                # Clean up temp files
                if temp_video_path.exists():
                    temp_video_path.unlink()
                if temp_clip_path.exists():
                    temp_clip_path.unlink()

        # Save to database
        cursor.execute("""
            INSERT INTO raw_clips (filename, rating, tags, name, notes, start_time, end_time, game_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            clip_filename,
            clip_data.rating,
            json.dumps(clip_data.tags),
            clip_data.name,
            clip_data.notes,
            clip_data.start_time,
            clip_data.end_time,
            clip_data.game_id
        ))
        raw_clip_id = cursor.lastrowid

        # If 5-star clip, create auto-project
        project_created = False
        project_id = None
        if clip_data.rating == 5:
            project_id = _create_auto_project_for_clip(cursor, raw_clip_id, clip_data.name)
            project_created = True

        conn.commit()
        logger.info(f"Saved raw clip {raw_clip_id} from game {clip_data.game_id}")

        return RawClipSaveResponse(
            raw_clip_id=raw_clip_id,
            filename=clip_filename,
            project_created=project_created,
            project_id=project_id
        )


@router.put("/raw/{clip_id}")
async def update_raw_clip(clip_id: int, update: RawClipUpdate):
    """
    Update a raw clip's metadata.

    Handles 5-star sync:
    - If rating changed TO 5: Create auto-project
    - If rating changed FROM 5: Delete auto-project (if unmodified)
    - If duration changed and has auto-project: Re-extract clip
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get current clip data
        cursor.execute("""
            SELECT id, filename, rating, tags, name, notes, start_time, end_time,
                   game_id, auto_project_id
            FROM raw_clips WHERE id = ?
        """, (clip_id,))
        clip = cursor.fetchone()

        if not clip:
            raise HTTPException(status_code=404, detail="Raw clip not found")

        old_rating = clip['rating']
        new_rating = update.rating if update.rating is not None else old_rating
        old_start = clip['start_time']
        old_end = clip['end_time']
        new_start = update.start_time if update.start_time is not None else old_start
        new_end = update.end_time if update.end_time is not None else old_end
        auto_project_id = clip['auto_project_id']
        game_id = clip['game_id']

        # Check if duration changed
        duration_changed = (new_start != old_start or new_end != old_end)

        # Handle rating change: 5 -> non-5
        if old_rating == 5 and new_rating != 5 and auto_project_id:
            _delete_auto_project(cursor, auto_project_id, clip_id)
            auto_project_id = None

        # Handle rating change: non-5 -> 5
        project_created = False
        if old_rating != 5 and new_rating == 5 and not auto_project_id:
            clip_name = update.name if update.name is not None else clip['name']
            auto_project_id = _create_auto_project_for_clip(cursor, clip_id, clip_name)
            project_created = True

        # Handle duration change: re-extract clip if needed
        if duration_changed and game_id:
            cursor.execute("SELECT video_filename FROM games WHERE id = ?", (game_id,))
            game = cursor.fetchone()
            if game and game['video_filename']:
                user_id = get_current_user_id()

                if modal_enabled():
                    # Use Modal for re-extraction (R2 -> Modal -> R2)
                    logger.info(f"[Modal] Re-extracting clip {clip_id} via Modal")

                    result = asyncio.run(call_modal_extract_clip(
                        user_id=user_id,
                        input_key=f"games/{game['video_filename']}",
                        output_key=f"raw_clips/{clip['filename']}",
                        start_time=new_start,
                        end_time=new_end,
                        copy_codec=True,
                    ))

                    if result.get("status") == "success":
                        logger.info(f"[Modal] Re-extracted clip {clip_id}")
                    else:
                        logger.error(f"[Modal] Failed to re-extract clip {clip_id}: {result.get('error')}")

                else:
                    # Local processing with R2 storage: download from R2, re-extract, upload back to R2
                    temp_video_path = Path(tempfile.gettempdir()) / f"game_video_{uuid.uuid4().hex[:8]}.mp4"
                    temp_clip_path = Path(tempfile.gettempdir()) / f"clip_{uuid.uuid4().hex[:8]}.mp4"

                    try:
                        if download_from_r2(user_id, f"games/{game['video_filename']}", temp_video_path):
                            success = extract_clip(
                                input_path=str(temp_video_path),
                                output_path=str(temp_clip_path),
                                start_time=new_start,
                                end_time=new_end,
                                copy_codec=True
                            )
                            if success:
                                upload_to_r2(user_id, f"raw_clips/{clip['filename']}", temp_clip_path)
                                logger.info(f"Re-extracted clip {clip_id} to R2")
                            else:
                                logger.error(f"Failed to re-extract clip {clip_id}")
                        else:
                            logger.error(f"Failed to download game video for clip {clip_id} re-extraction")
                    finally:
                        if temp_video_path.exists():
                            temp_video_path.unlink()
                        if temp_clip_path.exists():
                            temp_clip_path.unlink()

        # Build update query
        updates = []
        params = []

        if update.name is not None:
            updates.append("name = ?")
            params.append(update.name)
        if update.rating is not None:
            updates.append("rating = ?")
            params.append(update.rating)
        if update.tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(update.tags))
        if update.notes is not None:
            updates.append("notes = ?")
            params.append(update.notes)
        if update.start_time is not None:
            updates.append("start_time = ?")
            params.append(update.start_time)
        if update.end_time is not None:
            updates.append("end_time = ?")
            params.append(update.end_time)

        if updates:
            params.append(clip_id)
            cursor.execute(f"""
                UPDATE raw_clips SET {', '.join(updates)} WHERE id = ?
            """, params)

        conn.commit()
        logger.info(f"Updated raw clip {clip_id}")

        return {
            "success": True,
            "project_created": project_created,
            "project_id": auto_project_id
        }


@router.delete("/raw/{clip_id}")
async def delete_raw_clip(clip_id: int):
    """
    Delete a raw clip from the library.

    Also deletes:
    - The video file from disk
    - Any auto-created project (if unmodified)
    - Working clips that reference this raw clip
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get clip data
        cursor.execute("""
            SELECT filename, auto_project_id FROM raw_clips WHERE id = ?
        """, (clip_id,))
        clip = cursor.fetchone()

        if not clip:
            raise HTTPException(status_code=404, detail="Raw clip not found")

        # Delete auto-project if exists and unmodified
        if clip['auto_project_id']:
            _delete_auto_project(cursor, clip['auto_project_id'], clip_id)

        # Delete working clips that reference this raw clip
        cursor.execute("DELETE FROM working_clips WHERE raw_clip_id = ?", (clip_id,))

        # Delete the raw clip record
        cursor.execute("DELETE FROM raw_clips WHERE id = ?", (clip_id,))

        conn.commit()

        # Delete the file from disk
        file_path = get_raw_clips_path() / clip['filename']
        if file_path.exists():
            os.remove(file_path)
            logger.info(f"Deleted clip file: {file_path}")

        logger.info(f"Deleted raw clip {clip_id}")
        return {"success": True}


# ============ WORKING CLIPS (PROJECT CLIPS) ============

@router.get("/projects/{project_id}/clips", response_model=List[WorkingClipResponse])
async def list_project_clips(project_id: int):
    """List all working clips for a project."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        # Get working clips with resolved filenames and metadata
        # Only show the latest version of each clip (grouped by end_time)
        cursor.execute(f"""
            SELECT
                wc.id,
                wc.project_id,
                wc.raw_clip_id,
                wc.uploaded_filename,
                wc.exported_at,
                wc.sort_order,
                wc.crop_data,
                wc.timing_data,
                wc.segments_data,
                rc.filename as raw_filename,
                rc.name as raw_name,
                rc.notes as raw_notes,
                rc.rating as raw_rating,
                rc.tags as raw_tags
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.project_id = ?
            AND wc.id IN ({latest_working_clips_subquery()})
            ORDER BY wc.sort_order
        """, (project_id, project_id))
        clips = cursor.fetchall()

        result = []
        for clip in clips:
            tags = json.loads(clip['raw_tags']) if clip['raw_tags'] else []
            rating = clip['raw_rating'] or 3
            filename = clip['raw_filename'] or clip['uploaded_filename'] or 'unknown'
            # Determine source type for presigned URL
            source_type = 'upload' if clip['uploaded_filename'] else 'raw'
            result.append(WorkingClipResponse(
                id=clip['id'],
                project_id=clip['project_id'],
                raw_clip_id=clip['raw_clip_id'],
                uploaded_filename=clip['uploaded_filename'],
                filename=filename,
                file_url=get_working_clip_url(filename, source_type),
                name=derive_clip_name(clip['raw_name'], rating, tags),
                notes=clip['raw_notes'],
                exported_at=clip['exported_at'],
                sort_order=clip['sort_order'],
                crop_data=clip['crop_data'],
                timing_data=clip['timing_data'],
                segments_data=clip['segments_data']
            ))
        return result


@router.post("/projects/{project_id}/clips", response_model=WorkingClipResponse)
async def add_clip_to_project(
    project_id: int,
    raw_clip_id: Optional[int] = Form(None),
    file: Optional[UploadFile] = File(None)
):
    """
    Add a clip to a project.

    Either provide:
    - raw_clip_id: to add a clip from the library
    - file: to upload a new clip directly
    """
    if raw_clip_id is None and file is None:
        raise HTTPException(
            status_code=400,
            detail="Must provide either raw_clip_id or file"
        )

    if raw_clip_id is not None and file is not None:
        raise HTTPException(
            status_code=400,
            detail="Cannot provide both raw_clip_id and file"
        )

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        # Get next sort order
        cursor.execute("""
            SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order
            FROM working_clips
            WHERE project_id = ?
        """, (project_id,))
        next_order = cursor.fetchone()['next_order']

        uploaded_filename = None
        raw_filename = None
        next_version = 1

        if raw_clip_id is not None:
            # Adding from library
            cursor.execute("SELECT filename, end_time FROM raw_clips WHERE id = ?", (raw_clip_id,))
            raw_clip = cursor.fetchone()
            if not raw_clip:
                raise HTTPException(status_code=404, detail="Raw clip not found")
            raw_filename = raw_clip['filename']
            end_time = raw_clip['end_time']

            # Get next version for clips with THIS specific end_time
            # Clips are identified by their end timestamp
            cursor.execute("""
                SELECT COALESCE(MAX(wc.version), 0) + 1 as next_version
                FROM working_clips wc
                JOIN raw_clips rc ON wc.raw_clip_id = rc.id
                WHERE wc.project_id = ? AND rc.end_time = ?
            """, (project_id, end_time))
            next_version = cursor.fetchone()['next_version']

            cursor.execute("""
                INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version)
                VALUES (?, ?, ?, ?)
            """, (project_id, raw_clip_id, next_order, next_version))

        else:
            # Uploading new file directly to R2 (no local storage, no temp file)
            ext = os.path.splitext(file.filename)[1] or '.mp4'
            uploaded_filename = f"{uuid.uuid4().hex}{ext}"
            user_id = get_current_user_id()

            # Upload directly from memory to R2
            content = await file.read()
            if not upload_bytes_to_r2(user_id, f"uploads/{uploaded_filename}", content):
                raise HTTPException(status_code=500, detail="Failed to upload clip to R2")

            # For uploaded files, each upload is version 1 (unique filename)
            # No version history for uploaded clips since filename is unique
            cursor.execute("""
                INSERT INTO working_clips (project_id, uploaded_filename, sort_order, version)
                VALUES (?, ?, ?, ?)
            """, (project_id, uploaded_filename, next_order, 1))

        conn.commit()
        clip_id = cursor.lastrowid

        logger.info(f"Added clip {clip_id} to project {project_id}")

        return WorkingClipResponse(
            id=clip_id,
            project_id=project_id,
            raw_clip_id=raw_clip_id,
            uploaded_filename=uploaded_filename,
            filename=raw_filename or uploaded_filename,
            exported_at=None,
            sort_order=next_order
        )


def _ensure_unique_name(cursor, name: str, game_id) -> str:
    """
    Ensure name is unique within the same game (or among no-game clips).
    Appends (n) suffix if name already exists.
    """
    if not name:
        return name

    cursor.execute("""
        SELECT name FROM raw_clips
        WHERE game_id IS ? AND name LIKE ?
    """, (game_id, f"{name}%"))
    existing = {row['name'] for row in cursor.fetchall()}

    if name not in existing:
        return name

    counter = 2
    while f"{name} ({counter})" in existing:
        counter += 1
    return f"{name} ({counter})"


@router.post("/projects/{project_id}/clips/upload-with-metadata", response_model=WorkingClipResponse)
async def upload_clip_with_metadata(
    project_id: int,
    file: UploadFile = File(...),
    name: str = Form(""),
    rating: int = Form(3),
    tags: str = Form("[]"),
    notes: str = Form("")
):
    """
    Upload a clip to a project with metadata.

    Creates a raw_clip entry first (with game_id=NULL since it's a direct upload),
    then adds as working_clip to the project. This ensures:
    - Consistency: All clips have a raw_clip entry
    - Reusability: Uploaded clips can be added to other projects from library
    - Metadata storage: Name, rating, tags, notes are preserved
    """
    # Parse tags
    try:
        tags_list = json.loads(tags) if tags else []
    except json.JSONDecodeError:
        tags_list = []

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        # Ensure unique name within no-game clips
        unique_name = _ensure_unique_name(cursor, name, None)

        # Upload file directly to R2 (no local storage, no temp file)
        ext = os.path.splitext(file.filename)[1] or '.mp4'
        clip_filename = f"{uuid.uuid4().hex}{ext}"
        user_id = get_current_user_id()

        # Upload directly from memory to R2
        content = await file.read()
        if not upload_bytes_to_r2(user_id, f"raw_clips/{clip_filename}", content):
            raise HTTPException(status_code=500, detail="Failed to upload clip to R2")

        logger.info(f"Uploaded clip to R2: {clip_filename}")

        # Create raw_clip entry (game_id=NULL for direct uploads)
        cursor.execute("""
            INSERT INTO raw_clips (filename, rating, tags, name, notes, game_id)
            VALUES (?, ?, ?, ?, ?, NULL)
        """, (
            clip_filename,
            rating,
            json.dumps(tags_list),
            unique_name,
            notes
        ))
        raw_clip_id = cursor.lastrowid

        # Get next sort order for project
        cursor.execute("""
            SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order
            FROM working_clips
            WHERE project_id = ?
        """, (project_id,))
        next_order = cursor.fetchone()['next_order']

        # Add as working_clip to project
        cursor.execute("""
            INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version)
            VALUES (?, ?, ?, 1)
        """, (project_id, raw_clip_id, next_order))
        working_clip_id = cursor.lastrowid

        conn.commit()

        logger.info(f"Created raw_clip {raw_clip_id} and working_clip {working_clip_id} for project {project_id}")

        return WorkingClipResponse(
            id=working_clip_id,
            project_id=project_id,
            raw_clip_id=raw_clip_id,
            uploaded_filename=None,
            filename=clip_filename,
            name=derive_clip_name(unique_name, rating, tags_list),
            notes=notes,
            exported_at=None,
            sort_order=next_order
        )


@router.put("/projects/{project_id}/clips/reorder")
async def reorder_clips(project_id: int, clip_ids: List[int]):
    """Reorder clips by providing the new order of clip IDs."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        for index, clip_id in enumerate(clip_ids):
            cursor.execute("""
                UPDATE working_clips
                SET sort_order = ?
                WHERE id = ? AND project_id = ?
            """, (index, clip_id, project_id))

        conn.commit()
        return {"success": True}


@router.get("/projects/{project_id}/clips/{clip_id}/file")
async def get_working_clip_file(project_id: int, clip_id: int, stream: bool = False):
    """
    Stream a working clip video file.

    By default, redirects to R2 presigned URL for better performance with video elements.
    Use ?stream=true to proxy the content through the backend (avoids CORS for fetch API).
    """
    from fastapi.responses import RedirectResponse, StreamingResponse
    import httpx

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT wc.raw_clip_id, wc.uploaded_filename, rc.filename as raw_filename
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.id = ? AND wc.project_id = ?
        """, (clip_id, project_id))
        clip = cursor.fetchone()

        if not clip:
            raise HTTPException(status_code=404, detail="Working clip not found")

        # Determine filename and source type
        if clip['raw_clip_id']:
            filename = clip['raw_filename']
            source_type = 'raw'
        else:
            filename = clip['uploaded_filename']
            source_type = 'upload'

        presigned_url = get_working_clip_url(filename, source_type)
        if not presigned_url:
            raise HTTPException(status_code=404, detail="Failed to generate R2 URL")

        # Stream mode: proxy the content through backend (avoids CORS issues)
        if stream:
            logger.info(f"Streaming clip {clip_id} through backend proxy")

            async def stream_from_r2():
                async with httpx.AsyncClient() as client:
                    async with client.stream("GET", presigned_url) as response:
                        if response.status_code != 200:
                            raise HTTPException(
                                status_code=response.status_code,
                                detail=f"R2 returned {response.status_code}"
                            )
                        async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):  # 1MB chunks
                            yield chunk

            return StreamingResponse(
                stream_from_r2(),
                media_type="video/mp4",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Cache-Control": "no-cache"
                }
            )

        # Default: redirect to presigned URL (best for video elements)
        return RedirectResponse(url=presigned_url, status_code=302)


@router.put("/projects/{project_id}/clips/{clip_id}")
async def update_working_clip(
    project_id: int,
    clip_id: int,
    update: WorkingClipUpdate
):
    """Update a working clip's sort order or framing edits.

    Version creation logic:
    - If the clip was previously exported (exported_at IS NOT NULL) AND this update contains
      framing changes (crop_data, timing_data, or segments_data), a NEW version
      is created instead of updating the existing clip.
    - Otherwise, the existing clip is updated in place.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Fetch current clip data
        cursor.execute("""
            SELECT id, project_id, raw_clip_id, uploaded_filename, exported_at, sort_order, version,
                   crop_data, timing_data, segments_data
            FROM working_clips
            WHERE id = ? AND project_id = ?
        """, (clip_id, project_id))
        current_clip = cursor.fetchone()

        if not current_clip:
            raise HTTPException(status_code=404, detail="Working clip not found")

        # Check if this is a framing change on an exported clip
        is_framing_change = (
            update.crop_data is not None or
            update.timing_data is not None or
            update.segments_data is not None
        )
        was_exported = current_clip['exported_at'] is not None

        # Check if data actually changed (avoid creating new versions for no-op saves)
        data_actually_changed = False
        if is_framing_change:
            if update.crop_data is not None and update.crop_data != current_clip['crop_data']:
                data_actually_changed = True
            if update.timing_data is not None and update.timing_data != current_clip['timing_data']:
                data_actually_changed = True
            if update.segments_data is not None and update.segments_data != current_clip['segments_data']:
                data_actually_changed = True

        if is_framing_change and was_exported and data_actually_changed:
            # Create a NEW version of this clip instead of updating
            new_version = current_clip['version'] + 1

            logger.info(f"Creating new version {new_version} of clip {clip_id} (was exported)")

            cursor.execute("""
                INSERT INTO working_clips (
                    project_id, raw_clip_id, uploaded_filename, sort_order, version,
                    crop_data, timing_data, segments_data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                project_id,
                current_clip['raw_clip_id'],
                current_clip['uploaded_filename'],
                current_clip['sort_order'],
                new_version,
                normalize_json_data(update.crop_data if update.crop_data is not None else current_clip['crop_data']),
                normalize_json_data(update.timing_data if update.timing_data is not None else current_clip['timing_data']),
                normalize_json_data(update.segments_data if update.segments_data is not None else current_clip['segments_data']),
                # exported_at defaults to NULL for new version (not exported yet)
            ))
            conn.commit()

            new_clip_id = cursor.lastrowid
            logger.info(f"Created new clip version: {new_clip_id} (version {new_version})")

            # Tell client the new clip ID so it can switch to it
            return {
                "success": True,
                "refresh_required": True,
                "new_clip_id": new_clip_id,
                "new_version": new_version
            }

        # Regular update (no versioning needed)
        updates = []
        params = []
        if update.sort_order is not None:
            updates.append("sort_order = ?")
            params.append(update.sort_order)
        if update.crop_data is not None:
            updates.append("crop_data = ?")
            params.append(normalize_json_data(update.crop_data))
        if update.timing_data is not None:
            updates.append("timing_data = ?")
            params.append(normalize_json_data(update.timing_data))
        if update.segments_data is not None:
            updates.append("segments_data = ?")
            params.append(normalize_json_data(update.segments_data))

        if updates:
            params.append(clip_id)
            cursor.execute(f"""
                UPDATE working_clips SET {', '.join(updates)} WHERE id = ?
            """, params)
            conn.commit()

        # No refresh needed - client already has the data they just sent
        return {"success": True, "refresh_required": False}


@router.delete("/projects/{project_id}/clips/{clip_id}")
async def remove_clip_from_project(project_id: int, clip_id: int):
    """Remove a clip from a project."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id FROM working_clips
            WHERE id = ? AND project_id = ?
        """, (clip_id, project_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Working clip not found")

        # Delete the clip from the database
        cursor.execute("""
            DELETE FROM working_clips WHERE id = ?
        """, (clip_id,))
        conn.commit()

        logger.info(f"Removed clip {clip_id} from project {project_id}")
        return {"success": True}
