"""
Annotate endpoints for the Video Editor API.

This router handles clip extraction from full game footage:
- /api/annotate/export - Export clips, save to DB, create projects
- /api/annotate/download/{filename} - Download generated files

v3: Removed full_annotated.mp4, added TSV export, streaming downloads
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse
from starlette.background import BackgroundTask
from pathlib import Path
from typing import List, Dict, Any, Optional
import json
import os
import tempfile
import uuid
import subprocess
import logging
import re
import shutil
import asyncio

from app.database import get_db_connection, get_raw_clips_path, get_downloads_path, get_games_path, get_final_videos_path, ensure_directories
from app.services.clip_cache import get_clip_cache
from app.services.ffmpeg_service import get_encoding_command_parts
from app.services.modal_client import modal_enabled, call_modal_annotate_compilation
from app.storage import generate_presigned_url, upload_to_r2, download_from_r2, download_from_r2_with_progress, R2_ENABLED
from app.user_context import get_current_user_id
from app.websocket import manager, export_progress
from app.constants import ExportStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/annotate", tags=["annotate"])


def sanitize_filename(name: str) -> str:
    """Sanitize clip name for use as filename."""
    sanitized = name.replace(':', '-')
    sanitized = sanitized.replace(' ', '_')
    sanitized = re.sub(r'[^\w\-.]', '', sanitized)
    if len(sanitized) > 50:
        sanitized = sanitized[:50]
    if not sanitized:
        sanitized = 'clip'
    return sanitized


def format_time_for_ffmpeg(seconds: float) -> str:
    """Convert seconds to HH:MM:SS.mmm format for FFmpeg."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"


def format_time_for_tsv(seconds: float) -> str:
    """Convert seconds to MM:SS.mm format for TSV export (matching import format)."""
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes}:{secs:05.2f}"


def ensure_unique_filename(base_name: str, existing_names: set) -> str:
    """Ensure filename is unique by adding suffix if needed."""
    if base_name not in existing_names:
        return base_name
    counter = 1
    while f"{base_name}_{counter}" in existing_names:
        counter += 1
    return f"{base_name}_{counter}"


async def extract_clip_to_file(
    source_path: str,
    output_path: str,
    start_time: float,
    end_time: float,
    clip_name: str,
    clip_notes: str
) -> bool:
    """Extract a single clip from source video using FFmpeg (non-blocking)."""
    duration = end_time - start_time

    cmd = [
        'ffmpeg', '-y',
        '-ss', format_time_for_ffmpeg(start_time),
        '-i', source_path,
        '-t', format_time_for_ffmpeg(duration),
        '-metadata', f'title={clip_name}',
        '-metadata', f'description={clip_notes}',
        '-c', 'copy',
        output_path
    ]

    logger.info(f"Extracting clip: {clip_name} ({start_time:.2f}s - {end_time:.2f}s)")

    # Use async subprocess to avoid blocking the event loop
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await process.communicate()

    if process.returncode != 0:
        logger.error(f"FFmpeg error: {stderr.decode()}")
        return False
    return True


# Import rating constants from shared module (single source of truth)
from app.constants import (
    RATING_NOTATION,
    RATING_COLORS_HEX as RATING_COLORS,  # Alias for backward compatibility
    OVERLAY_STYLE_VERSION,
    get_rating_notation,
    get_rating_color_hex,
)


async def create_clip_with_burned_text(
    source_path: str,
    output_path: str,
    start_time: float,
    end_time: float,
    clip_name: str,
    clip_notes: str,
    rating: int,
    tags: List[str],
    use_cache: bool = True
) -> bool:
    """
    Extract clip with burned-in text overlay showing annotations.
    Uses caching to avoid re-encoding if clip hasn't changed.

    Overlay style matches the playback overlay:
    - Centered white box at top of video with colored border
    - Border color matches rating (red→amber→blue→green→light green)
    - Rating notation (!, !!, !?, ?, ??) before the clip name
    - Notes below the name in the same box
    """
    cache = get_clip_cache()
    cache_key = None

    # Check cache first
    if use_cache:
        cache_key = cache.generate_key(
            cache_type='annotate',
            video_id=cache.get_video_identity(source_path),
            start=round(start_time, 3),
            end=round(end_time, 3),
            name=clip_name,
            notes=(clip_notes or '')[:100],  # Match truncation in FFmpeg filter
            rating=rating,
            tags=sorted(tags) if tags else [],
            style_version=OVERLAY_STYLE_VERSION  # Invalidate cache when style changes
        )
        cached_path = cache.get(cache_key)
        if cached_path:
            # Copy from cache to output
            shutil.copy2(cached_path, output_path)
            return True

    duration = end_time - start_time

    # Get rating notation symbol and color
    rating_notation = get_rating_notation(rating)
    rating_color = get_rating_color_hex(rating)

    def escape_drawtext(text: str) -> str:
        """
        Escape text for FFmpeg drawtext filter.
        Order matters: escape backslashes first, then special chars.
        """
        # First escape backslashes
        text = text.replace('\\', '\\\\')
        # Escape single quotes (close quote, add escaped quote, reopen)
        text = text.replace("'", "'\\''")
        # Escape colons (special in FFmpeg filter syntax)
        text = text.replace(':', '\\:')
        # Escape other special FFmpeg filter chars
        text = text.replace('[', '\\[')
        text = text.replace(']', '\\]')
        text = text.replace(';', '\\;')
        return text

    # Build filter complex for centered white text overlay (matching playback style)
    filter_parts = []

    # Centered white background box at top
    # Box width is 80% of video width, centered
    # Height depends on whether we have notes
    box_height = 80 if clip_notes else 50
    border_thickness = 4

    # Draw colored border first (slightly larger box)
    filter_parts.append(
        f"drawbox=x=(iw*0.1-{border_thickness}):y=(10-{border_thickness}):w=(iw*0.8+{border_thickness*2}):h=({box_height}+{border_thickness*2}):color={rating_color}:t=fill"
    )

    # Draw white fill on top
    filter_parts.append(
        f"drawbox=x=(iw*0.1):y=10:w=(iw*0.8):h={box_height}:color=white@0.95:t=fill"
    )

    # Rating notation + clip name (centered, black text on white)
    # Combine notation and name into single text for proper centering
    title_text = f"{rating_notation}  {clip_name}"
    escaped_title = escape_drawtext(title_text)
    filter_parts.append(
        f"drawtext=text='{escaped_title}':fontsize=24:fontcolor=black:x=(w-text_w)/2:y=20"
    )

    # Notes (if any) - below name, also centered
    if clip_notes:
        escaped_notes = escape_drawtext(clip_notes[:100])
        filter_parts.append(
            f"drawtext=text='{escaped_notes}':fontsize=16:fontcolor=0x333333:x=(w-text_w)/2:y=50"
        )

    filter_complex = ','.join(filter_parts)

    # Use GPU encoding if available
    encoding_params = get_encoding_command_parts(prefer_quality=True)

    cmd = [
        'ffmpeg', '-y',
        '-ss', format_time_for_ffmpeg(start_time),
        '-i', source_path,
        '-t', format_time_for_ffmpeg(duration),
        '-vf', filter_complex,
    ]
    cmd.extend(encoding_params)
    cmd.extend(['-c:a', 'aac', output_path])

    logger.info(f"Creating burned-in clip: {clip_name} (encoder: {encoding_params[1]})")

    # Use async subprocess to avoid blocking the event loop
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await process.communicate()

    if process.returncode != 0:
        logger.error(f"FFmpeg error: {stderr.decode()}")
        return False

    # Save to cache for future use
    if use_cache and cache_key:
        try:
            cache.put(output_path, cache_key)
        except Exception as e:
            logger.warning(f"Failed to cache clip: {e}")

    return True


async def concatenate_videos(input_paths: List[str], output_path: str) -> bool:
    """Concatenate multiple video clips into one (non-blocking)."""
    if not input_paths:
        return False

    # Create concat file
    concat_file = output_path + '.txt'
    with open(concat_file, 'w') as f:
        for path in input_paths:
            f.write(f"file '{path}'\n")

    cmd = [
        'ffmpeg', '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concat_file,
        '-c', 'copy',
        output_path
    ]

    # Use async subprocess to avoid blocking the event loop
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await process.communicate()

    # Clean up concat file
    os.remove(concat_file)

    if process.returncode != 0:
        logger.error(f"FFmpeg concat error: {stderr.decode()}")
        return False
    return True


def generate_annotations_tsv(clips: List[Dict[str, Any]], original_filename: str) -> str:
    """
    Generate TSV content for annotations export.
    Format matches import: start_time, end_time, name, rating, tags, notes
    """
    lines = []
    # Header
    lines.append("start_time\tend_time\tname\trating\ttags\tnotes")

    for clip in clips:
        start = format_time_for_tsv(clip['start_time'])
        end = format_time_for_tsv(clip['end_time'])
        name = clip.get('name', 'clip')
        rating = clip.get('rating', 3)
        tags = ','.join(clip.get('tags', []))
        notes = clip.get('notes', '').replace('\t', ' ').replace('\n', ' ')

        lines.append(f"{start}\t{end}\t{name}\t{rating}\t{tags}\t{notes}")

    return '\n'.join(lines)


def cleanup_temp_dir(temp_dir: str):
    """Clean up temporary directory."""
    import shutil
    try:
        shutil.rmtree(temp_dir)
        logger.info(f"Cleaned up temp directory: {temp_dir}")
    except Exception as e:
        logger.warning(f"Failed to clean up: {e}")


# ============================================================================
# Export Job Tracking (T12: Progress State Recovery)
# ============================================================================

def create_annotate_export_job(export_id: str, game_id: Optional[int], game_name: Optional[str], clip_count: int) -> str:
    """
    Create an export_jobs record for annotate export.
    Uses project_id=0 since annotate exports don't belong to a project.
    """
    input_data = json.dumps({
        "type": "annotate",
        "game_id": game_id,
        "clip_count": clip_count,
    })

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO export_jobs (id, project_id, type, status, input_data, game_id, game_name)
            VALUES (?, 0, 'annotate', 'processing', ?, ?, ?)
        """, (export_id, input_data, game_id, game_name))
        conn.commit()

    logger.info(f"[AnnotateExport] Created export job {export_id} for game {game_id} ({game_name})")
    return export_id


def complete_annotate_export_job(export_id: str, output_filename: Optional[str] = None):
    """Mark annotate export job as complete."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE export_jobs
            SET status = ?, completed_at = datetime('now'), output_filename = ?
            WHERE id = ?
        """, (ExportStatus.COMPLETE, output_filename, export_id))
        conn.commit()

    logger.info(f"[AnnotateExport] Completed export job {export_id}")


def fail_annotate_export_job(export_id: str, error_message: str):
    """Mark annotate export job as failed."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE export_jobs
            SET status = ?, completed_at = datetime('now'), error = ?
            WHERE id = ?
        """, (ExportStatus.ERROR, error_message, export_id))
        conn.commit()

    logger.error(f"[AnnotateExport] Failed export job {export_id}: {error_message}")


@router.get("/download/{filename}")
async def download_file(filename: str):
    """
    Download a generated file from the downloads folder.
    Files are cleaned up after 1 hour by a background task (TODO).
    """
    logger.info(f"[Download] Request for file: {filename}")

    # Security: prevent path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        logger.error(f"[Download] VALIDATION ERROR - Path traversal attempt detected: {filename}")
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Determine media type
    if filename.endswith('.mp4'):
        media_type = 'video/mp4'
    elif filename.endswith('.tsv'):
        media_type = 'text/tab-separated-values'
    else:
        media_type = 'application/octet-stream'

    # Redirect to R2 presigned URL
    user_id = get_current_user_id()
    presigned_url = generate_presigned_url(
        user_id=user_id,
        relative_path=f"downloads/{filename}",
        expires_in=3600,
        content_type=media_type
    )
    if presigned_url:
        return RedirectResponse(url=presigned_url, status_code=302)
    raise HTTPException(status_code=404, detail="Failed to generate R2 URL for download")


@router.post("/export")
async def export_clips(
    video: UploadFile = File(None),  # Optional if game_id provided
    clips_json: str = Form(...),
    save_to_db: str = Form("true"),  # "true" = import to projects, "false" = download only
    settings_json: str = Form("{}"),  # Project creation settings
    game_id: str = Form(None),  # Optional: use existing game's video instead of upload
    export_id: str = Form(None)  # Optional: ID for progress tracking via SSE
):
    """
    Export clips from source video.

    Video source (one required):
    - video: Upload video file directly
    - game_id: Use video from existing game (already on server)

    Modes:
    - save_to_db="true": Save clips to DB, create projects, generate downloads
    - save_to_db="false": Only generate downloadable files (TSV + compilation video)

    Clip JSON format:
    [
      {
        "start_time": 150.5,
        "end_time": 165.5,
        "name": "Brilliant Goal",
        "notes": "Amazing finish",
        "rating": 5,
        "tags": ["Goal", "Dribble"]
      }
    ]

    Settings JSON format:
    {
      "minRatingForLibrary": 4,
      "createGameProject": true,
      "gameProjectAspectRatio": "16:9",
      "createClipProjects": true,
      "clipProjectMinRating": 5,
      "clipProjectAspectRatio": "9:16"
    }

    Response:
    - downloads: URLs for downloadable files (TSV, compilation video)
    - created: info about created raw_clips and projects (only if save_to_db=true)
    """
    # Log request parameters for debugging
    logger.info(f"[Export] Request received - save_to_db={save_to_db}, game_id={game_id}, video={video.filename if video else None}, export_id={export_id}")
    logger.debug(f"[Export] clips_json length: {len(clips_json) if clips_json else 0} chars")
    logger.debug(f"[Export] settings_json: {settings_json}")

    should_save_to_db = save_to_db.lower() == "true"

    # Parse settings with defaults
    try:
        settings = json.loads(settings_json) if settings_json else {}
    except json.JSONDecodeError as e:
        logger.error(f"[Export] Failed to parse settings JSON: {e}")
        logger.error(f"[Export] settings_json content: {settings_json}")
        settings = {}

    # Apply defaults for missing settings
    min_rating_for_library = settings.get('minRatingForLibrary', 4)
    create_game_project = settings.get('createGameProject', True)
    game_project_aspect = settings.get('gameProjectAspectRatio', '16:9')
    create_clip_projects = settings.get('createClipProjects', True)
    clip_project_min_rating = settings.get('clipProjectMinRating', 5)
    clip_project_aspect = settings.get('clipProjectAspectRatio', '9:16')

    # Parse clips JSON
    try:
        clips = json.loads(clips_json)
        logger.info(f"[Export] Parsed {len(clips)} clips from JSON")
    except json.JSONDecodeError as e:
        logger.error(f"[Export] VALIDATION ERROR - Invalid clips JSON: {e}")
        logger.error(f"[Export] clips_json content (first 500 chars): {clips_json[:500]}")
        raise HTTPException(status_code=400, detail="Invalid clips JSON")

    if not clips:
        logger.error("[Export] VALIDATION ERROR - No clips defined in request")
        raise HTTPException(status_code=400, detail="No clips defined")

    # Validate clips
    for i, clip in enumerate(clips):
        if 'start_time' not in clip or 'end_time' not in clip:
            logger.error(f"[Export] VALIDATION ERROR - Clip {i} missing times: {clip}")
            raise HTTPException(status_code=400, detail=f"Clip {i} missing times")
        if clip['start_time'] >= clip['end_time']:
            logger.error(f"[Export] VALIDATION ERROR - Clip {i} invalid range: start={clip['start_time']}, end={clip['end_time']}")
            raise HTTPException(status_code=400, detail=f"Clip {i} invalid range")

    # Ensure directories exist
    ensure_directories()

    # Determine video source: uploaded file OR existing game video
    if game_id:
        # Use existing game's video
        logger.info(f"[Export] Using game_id source: {game_id}")
        try:
            game_id_int = int(game_id)
        except ValueError:
            logger.error(f"[Export] VALIDATION ERROR - Invalid game_id format: {game_id}")
            raise HTTPException(status_code=400, detail="Invalid game_id")

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name, video_filename FROM games WHERE id = ?", (game_id_int,))
            row = cursor.fetchone()

            if not row:
                logger.error(f"[Export] VALIDATION ERROR - Game not found: game_id={game_id_int}")
                raise HTTPException(status_code=404, detail="Game not found")
            if not row['video_filename']:
                logger.error(f"[Export] VALIDATION ERROR - Game {game_id_int} has no video uploaded")
                raise HTTPException(status_code=400, detail="Game has no video uploaded")

            original_filename = row['name'] + ".mp4"
            video_filename = row['video_filename']

            # Check if video exists - either locally or in R2
            local_path = get_games_path() / video_filename
            if R2_ENABLED:
                # Download from R2 to temp directory (will be created below)
                # Set source_path to None for now, will download after temp_dir is created
                source_path = None
                source_from_r2 = True
                logger.info(f"[Export] Will download game {game_id} video from R2: games/{video_filename}")
            elif os.path.exists(local_path):
                source_path = str(local_path)
                source_from_r2 = False
                logger.info(f"[Export] Using local game {game_id} video: {video_filename}")
            else:
                logger.error(f"[Export] VALIDATION ERROR - Game video file not found: {local_path}")
                raise HTTPException(status_code=404, detail="Game video file not found")

    elif video and video.filename:
        # Use uploaded video - need temp dir
        logger.info(f"[Export] Using uploaded video: {video.filename}")
        source_from_r2 = False
        video_filename = None
        game_id_int = None
        game_name = None
    else:
        logger.error("[Export] VALIDATION ERROR - Neither video file nor game_id provided")
        raise HTTPException(status_code=400, detail="Either video file or game_id required")

    # Track game_name for display (T12: Progress Recovery)
    if game_id:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM games WHERE id = ?", (game_id_int,))
            game_row = cursor.fetchone()
            game_name = game_row['name'] if game_row else f"Game {game_id}"
    else:
        game_name = video.filename if video else "Uploaded Video"

    # Create export job for progress recovery (T12)
    # Only create job if export_id is provided (frontend wants progress tracking)
    if export_id:
        create_annotate_export_job(export_id, game_id_int, game_name, len(clips))

    # Create temp directory for processing
    temp_dir = tempfile.mkdtemp(prefix="annotate_")
    logger.info(f"Created temp directory: {temp_dir}")

    try:
        # If using game video from R2, download it to temp directory
        # Skip download if using Modal for compilation-only mode (Modal streams from R2 directly)
        use_modal_for_compilation = modal_enabled() and game_id and video_filename and not should_save_to_db

        if game_id and source_from_r2 and not use_modal_for_compilation:
            user_id = get_current_user_id()
            source_path = os.path.join(temp_dir, f"game_{uuid.uuid4().hex[:8]}.mp4")
            r2_key = f"games/{video_filename}"

            logger.info(f"[Export] Downloading game video from R2: {r2_key}")
            if export_id:
                # Use DRY helper for download with progress (5% -> 15%)
                if not await download_from_r2_with_progress(
                    user_id, r2_key, Path(source_path),
                    export_id=export_id, export_type='annotate'
                ):
                    logger.error(f"[Export] Failed to download game video from R2: {r2_key}")
                    raise HTTPException(status_code=404, detail="Game video not found in storage")
            else:
                # No export_id, use simple download
                if not download_from_r2(user_id, r2_key, Path(source_path)):
                    logger.error(f"[Export] Failed to download game video from R2: {r2_key}")
                    raise HTTPException(status_code=404, detail="Game video not found in storage")
            logger.info(f"[Export] Downloaded game video to: {source_path}")
        elif use_modal_for_compilation:
            logger.info(f"[Export] Skipping game video download - Modal will stream from R2")

        # If video was uploaded (not using game), save it to temp
        if not game_id:
            original_filename = video.filename or "source_video.mp4"
            source_path = os.path.join(temp_dir, f"source_{uuid.uuid4().hex[:8]}.mp4")

            with open(source_path, 'wb') as f:
                content = await video.read()
                f.write(content)

            source_size_mb = len(content) / (1024 * 1024)
            logger.info(f"Saved source video: {source_size_mb:.1f}MB")

        # Generate unique ID for download filenames
        download_id = uuid.uuid4().hex[:8]
        video_base = sanitize_filename(os.path.splitext(original_filename)[0])

        # Helper function to update progress via WebSocket (same pattern as overlay)
        # T12: Include gameId and gameName for progress recovery
        async def update_progress(current: int, total: int, phase: str, message: str, done: bool = False):
            if export_id:
                progress_data = {
                    'current': current,
                    'total': total,
                    'phase': phase,
                    'message': message,
                    'done': done,
                    'progress': int((current / total) * 100) if total > 0 else 0,
                    'status': ExportStatus.COMPLETE if done else 'processing',
                    'type': 'annotate',
                    # T12: Include game info for progress recovery
                    'gameId': game_id_int,
                    'gameName': game_name,
                }
                export_progress[export_id] = progress_data
                await manager.send_progress(export_id, progress_data)
                if current % 5 == 0 or done:
                    logger.info(f"[Annotate Progress] {export_id}: {current}/{total} ({phase}) - {message}")

        # Separate clips by rating using configurable threshold
        good_clips = [c for c in clips if c.get('rating', 3) >= min_rating_for_library]

        # Initialize progress tracking
        # Calculate total_steps based on mode:
        # - save_to_db=true: extract good clips + TSV (no burned-in compilation)
        # - save_to_db=false: burned-in clips + TSV + concatenation
        if should_save_to_db:
            total_steps = len(good_clips) + 1  # extracting good clips + TSV
        else:
            total_steps = len(clips) + 2  # burned-in clips + TSV + concatenation
        await update_progress(0, total_steps, 'starting', 'Initializing export...')
        all_clips = clips

        used_names = set()
        created_raw_clips = []
        burned_clip_paths = []
        created_projects = []

        # Track progress step counter
        step = 0

        # Only save to DB and create projects if requested
        if should_save_to_db:
            # Process good/brilliant clips (4+ stars) - save to DB and filesystem
            for idx, clip in enumerate(good_clips):
                clip_name = clip.get('name', 'clip')
                step += 1
                await update_progress(step, total_steps, 'extracting', f'Extracting clip {idx + 1}/{len(good_clips)}: {clip_name}')

                base_name = sanitize_filename(clip_name)
                unique_name = ensure_unique_filename(base_name, used_names)
                used_names.add(unique_name)

                filename = f"{unique_name}.mp4"
                # Extract to temp directory, then upload to R2 (no local raw_clips storage)
                output_path = os.path.join(temp_dir, f"clip_{uuid.uuid4().hex[:8]}.mp4")

                # Extract clip to temp file
                success = await extract_clip_to_file(
                    source_path=source_path,
                    output_path=output_path,
                    start_time=clip['start_time'],
                    end_time=clip['end_time'],
                    clip_name=clip_name,
                    clip_notes=clip.get('notes', '')
                )

                if success:
                    # Upload to R2
                    user_id = get_current_user_id()
                    if not upload_to_r2(user_id, f"raw_clips/{filename}", Path(output_path)):
                        logger.error(f"Failed to upload raw clip to R2: {filename}")
                        continue

                    # Save to database with full metadata
                    with get_db_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            INSERT INTO raw_clips (filename, rating, tags, name, notes, start_time, end_time)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (
                            filename,
                            clip['rating'],
                            json.dumps(clip.get('tags', [])),
                            clip_name,
                            clip.get('notes', ''),
                            clip['start_time'],
                            clip['end_time']
                        ))
                        conn.commit()
                        raw_clip_id = cursor.lastrowid

                    created_raw_clips.append({
                        'id': raw_clip_id,
                        'filename': filename,
                        'rating': clip['rating'],
                        'name': clip_name,
                        'notes': clip.get('notes', ''),
                        'tags': clip.get('tags', []),
                        'start_time': clip['start_time'],
                        'end_time': clip['end_time']
                    })

                    logger.info(f"Uploaded raw clip {raw_clip_id} to R2: {filename}")

            # Create projects from the saved clips (based on settings)
            if created_raw_clips:
                with get_db_connection() as conn:
                    cursor = conn.cursor()

                    # 1. Create "game" project with ALL clips meeting min rating (if enabled)
                    if create_game_project:
                        game_project_name = f"{video_base}_game"

                        cursor.execute("""
                            INSERT INTO projects (name, aspect_ratio)
                            VALUES (?, ?)
                        """, (game_project_name, game_project_aspect))
                        game_project_id = cursor.lastrowid

                        # Add all clips to game project
                        for i, raw_clip in enumerate(created_raw_clips):
                            cursor.execute("""
                                INSERT INTO working_clips (project_id, raw_clip_id, sort_order)
                                VALUES (?, ?, ?)
                            """, (game_project_id, raw_clip['id'], i))

                        created_projects.append({
                            'id': game_project_id,
                            'name': game_project_name,
                            'type': 'game',
                            'clip_count': len(created_raw_clips)
                        })

                    # 2. Create individual projects for clips meeting clip project rating (if enabled)
                    if create_clip_projects:
                        top_clips = [c for c in created_raw_clips if c['rating'] >= clip_project_min_rating]

                        for raw_clip in top_clips:
                            clip_project_name = f"{sanitize_filename(raw_clip['name'])}_clip"

                            cursor.execute("""
                                INSERT INTO projects (name, aspect_ratio)
                                VALUES (?, ?)
                            """, (clip_project_name, clip_project_aspect))
                            clip_project_id = cursor.lastrowid

                            cursor.execute("""
                                INSERT INTO working_clips (project_id, raw_clip_id, sort_order)
                                VALUES (?, ?, ?)
                            """, (clip_project_id, raw_clip['id'], 0))

                            created_projects.append({
                                'id': clip_project_id,
                                'name': clip_project_name,
                                'type': 'clip',
                                'clip_count': 1
                            })

                    conn.commit()

        # Generate downloadable files
        download_urls = {}

        # 1. Generate annotations.tsv
        step += 1
        await update_progress(step, total_steps, 'tsv', 'Generating annotations TSV...')
        tsv_filename = f"{video_base}_{download_id}_annotations.tsv"
        tsv_path = os.path.join(temp_dir, tsv_filename)  # Write to temp dir
        tsv_content = generate_annotations_tsv(all_clips, original_filename)
        with open(tsv_path, 'w', encoding='utf-8') as f:
            f.write(tsv_content)

        # Upload TSV to R2
        user_id = get_current_user_id()
        if not upload_to_r2(user_id, f"downloads/{tsv_filename}", Path(tsv_path)):
            logger.error(f"Failed to upload TSV to R2: {tsv_filename}")
        else:
            logger.info(f"Uploaded annotations TSV to R2: {tsv_filename}")

        download_urls['annotations'] = {
            'filename': tsv_filename,
            'url': f"/api/annotate/download/{tsv_filename}"
        }

        # 2. Generate clips_compilation.mp4 with burned-in overlays
        # Only generate compilation video for "Download Clips Review" mode (save_to_db=false)
        # When importing into projects, users don't need the compilation since clips are saved to DB
        if not should_save_to_db:
            compilation_filename = f"{video_base}_{download_id}_clips_review.mp4"
            user_id = get_current_user_id()

            # Use Modal for cloud processing if enabled (avoids downloading large game video)
            if modal_enabled() and game_id and video_filename:
                logger.info(f"[Export] Using Modal for annotated compilation ({len(all_clips)} clips)")
                await update_progress(step + 1, total_steps, 'modal', 'Sending to cloud for processing...')

                # Progress callback for Modal - map Modal's 0-100% to our 10-100% range
                # This prevents progress from going backwards after initial backend steps (0-7%)
                async def modal_progress(progress: float, message: str, phase: str = "modal_processing"):
                    # Map Modal's 0-100 range to 10-100 of overall progress
                    mapped_progress = 10 + int(progress * 0.9)
                    await update_progress(mapped_progress, 100, phase, message)

                # R2 keys
                input_r2_key = f"games/{video_filename}"
                output_r2_key = f"downloads/{compilation_filename}"
                final_filename = f"{uuid.uuid4().hex[:12]}.mp4"
                gallery_r2_key = f"final_videos/{final_filename}"

                modal_result = await call_modal_annotate_compilation(
                    job_id=export_id or f"annotate_{download_id}",
                    user_id=user_id,
                    input_key=input_r2_key,
                    output_key=output_r2_key,
                    clips=all_clips,
                    gallery_output_key=gallery_r2_key,
                    progress_callback=modal_progress,
                )

                if modal_result.get("status") == "success":
                    logger.info(f"[Export] Modal compilation complete: {modal_result.get('clips_processed')} clips")
                    download_urls['clips_compilation'] = {
                        'filename': compilation_filename,
                        'url': f"/api/annotate/download/{compilation_filename}"
                    }

                    # Modal already uploaded to both downloads/ and final_videos/
                    # Now add the gallery entry to the database
                    with get_db_connection() as conn:
                        cursor = conn.cursor()
                        game_name = video_base
                        rating_counts_json = None
                        if game_id:
                            cursor.execute("""
                                SELECT name, clip_count, brilliant_count, good_count,
                                       interesting_count, mistake_count, blunder_count
                                FROM games WHERE id = ?
                            """, (int(game_id),))
                            game_row = cursor.fetchone()
                            if game_row:
                                game_name = game_row['name']
                                rating_counts_json = json.dumps({
                                    'brilliant': game_row['brilliant_count'] or 0,
                                    'good': game_row['good_count'] or 0,
                                    'interesting': game_row['interesting_count'] or 0,
                                    'mistake': game_row['mistake_count'] or 0,
                                    'blunder': game_row['blunder_count'] or 0
                                })

                        cursor.execute("""
                            SELECT COALESCE(MAX(version), 0) + 1 as next_version
                            FROM final_videos WHERE game_id = ?
                        """, (int(game_id) if game_id else None,))
                        next_version = cursor.fetchone()['next_version']

                        annotated_name = f"{game_name} (Annotated)"
                        cursor.execute("""
                            INSERT INTO final_videos (project_id, filename, version, source_type, game_id, name, rating_counts)
                            VALUES (0, ?, ?, 'annotated_game', ?, ?, ?)
                        """, (final_filename, next_version, int(game_id) if game_id else None, annotated_name, rating_counts_json))
                        conn.commit()
                        logger.info(f"Added annotated export to gallery: name={annotated_name}")
                else:
                    logger.error(f"[Export] Modal compilation failed: {modal_result.get('error')}")
                    raise HTTPException(status_code=500, detail=f"Cloud processing failed: {modal_result.get('error')}")

            else:
                # Local processing (fallback or when Modal not available)
                # Use same progress allocation as Modal for consistency:
                # clips: 15-85% (70% range), concat: 85-92%, upload: 92-100%
                logger.info(f"[Export] Using local processing for annotated compilation")

                total_clips = len(all_clips)
                clip_progress_start = 15
                clip_progress_range = 70  # 70% of progress for processing clips

                for idx, clip in enumerate(all_clips):
                    clip_name = clip.get('name', 'clip')
                    # Calculate progress same as Modal (15-85% for clips)
                    clip_base_progress = clip_progress_start + (idx / total_clips) * clip_progress_range
                    # Apply same 10 + progress * 0.9 mapping as Modal path
                    mapped_progress = 10 + int(clip_base_progress * 0.9)
                    await update_progress(mapped_progress, 100, 'processing', f'Processing clip {idx + 1}/{total_clips}: {clip_name}')

                    burned_path = os.path.join(temp_dir, f"burned_{uuid.uuid4().hex[:8]}.mp4")

                    success = await create_clip_with_burned_text(
                        source_path=source_path,
                        output_path=burned_path,
                        start_time=clip['start_time'],
                        end_time=clip['end_time'],
                        clip_name=clip_name,
                        clip_notes=clip.get('notes', ''),
                        rating=clip.get('rating', 3),
                        tags=clip.get('tags', [])
                    )

                    if success:
                        burned_clip_paths.append(burned_path)

                # Concatenate burned clips into compilation (85% in Modal's allocation)
                if burned_clip_paths:
                    mapped_progress = 10 + int(85 * 0.9)  # 86%
                    await update_progress(mapped_progress, 100, 'concatenating', f'Merging {len(burned_clip_paths)} clips into compilation...')
                    compilation_path = os.path.join(temp_dir, compilation_filename)

                    if await concatenate_videos(burned_clip_paths, compilation_path):
                        compilation_size = os.path.getsize(compilation_path)
                        logger.info(f"Generated clips compilation: {compilation_filename} ({compilation_size / (1024*1024):.1f}MB)")

                        # Upload to R2 (92% in Modal's allocation)
                        mapped_progress = 10 + int(92 * 0.9)  # 92%
                        await update_progress(mapped_progress, 100, 'uploading', 'Uploading result...')

                        # Upload to R2 downloads folder for the download endpoint
                        if not upload_to_r2(user_id, f"downloads/{compilation_filename}", Path(compilation_path)):
                            logger.error(f"Failed to upload compilation to R2 downloads: {compilation_filename}")
                        else:
                            logger.info(f"Uploaded compilation to R2 downloads: {compilation_filename}")
                            download_urls['clips_compilation'] = {
                                'filename': compilation_filename,
                                'url': f"/api/annotate/download/{compilation_filename}"
                            }

                        # Add to gallery (final_videos table)
                        with get_db_connection() as conn:
                            cursor = conn.cursor()

                            game_name = video_base
                            rating_counts_json = None
                            if game_id:
                                cursor.execute("""
                                    SELECT name, clip_count, brilliant_count, good_count,
                                           interesting_count, mistake_count, blunder_count
                                    FROM games WHERE id = ?
                                """, (int(game_id),))
                                game_row = cursor.fetchone()
                                if game_row:
                                    game_name = game_row['name']
                                    rating_counts_json = json.dumps({
                                        'brilliant': game_row['brilliant_count'] or 0,
                                        'good': game_row['good_count'] or 0,
                                        'interesting': game_row['interesting_count'] or 0,
                                        'mistake': game_row['mistake_count'] or 0,
                                        'blunder': game_row['blunder_count'] or 0
                                    })

                            final_filename = f"{uuid.uuid4().hex[:12]}.mp4"
                            if not upload_to_r2(user_id, f"final_videos/{final_filename}", Path(compilation_path)):
                                logger.error(f"Failed to upload annotated compilation to R2 final_videos - skipping gallery save")
                            else:
                                cursor.execute("""
                                    SELECT COALESCE(MAX(version), 0) + 1 as next_version
                                    FROM final_videos WHERE game_id = ?
                                """, (int(game_id) if game_id else None,))
                                next_version = cursor.fetchone()['next_version']

                                annotated_name = f"{game_name} (Annotated)"
                                cursor.execute("""
                                    INSERT INTO final_videos (project_id, filename, version, source_type, game_id, name, rating_counts)
                                    VALUES (0, ?, ?, 'annotated_game', ?, ?, ?)
                                """, (final_filename, next_version, int(game_id) if game_id else None, annotated_name, rating_counts_json))
                                final_video_id = cursor.lastrowid

                                conn.commit()
                                logger.info(f"Added annotated export to gallery: final_video={final_video_id}, name={annotated_name}")

        if should_save_to_db:
            logger.info(f"Export complete: {len(created_raw_clips)} clips saved, {len(created_projects)} projects created")
            message = f"Saved {len(created_raw_clips)} clips and created {len(created_projects)} projects"
        else:
            logger.info(f"Export complete: Generated downloads only (no DB save)")
            message = f"Generated annotated video with {len(all_clips)} clips"

        # Mark progress as done
        await update_progress(total_steps, total_steps, 'done', message, done=True)

        # Mark export job as complete (T12: Progress Recovery)
        if export_id:
            output_file = download_urls.get('clips_compilation', {}).get('filename')
            complete_annotate_export_job(export_id, output_file)

        # Build response
        response_data = {
            'success': True,
            'downloads': download_urls,
            'created': {
                'raw_clips': created_raw_clips,
                'projects': created_projects
            },
            'saved_to_db': should_save_to_db,
            'message': message
        }

        return JSONResponse(response_data, background=BackgroundTask(cleanup_temp_dir, temp_dir))

    except HTTPException as e:
        # HTTPException already logged before raising, just cleanup and re-raise
        logger.warning(f"[Export] Request failed with HTTPException: {e.status_code} - {e.detail}")
        # Mark export job as failed (T12: Progress Recovery)
        if export_id:
            fail_annotate_export_job(export_id, e.detail)
        cleanup_temp_dir(temp_dir)
        raise
    except Exception as e:
        logger.error(f"[Export] UNEXPECTED ERROR - Export failed: {type(e).__name__}: {e}", exc_info=True)
        # Mark export job as failed (T12: Progress Recovery)
        if export_id:
            fail_annotate_export_job(export_id, str(e))
        cleanup_temp_dir(temp_dir)
        raise HTTPException(status_code=500, detail=str(e))
