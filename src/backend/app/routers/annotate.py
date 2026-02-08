"""
Annotate endpoints for the Video Editor API.

This router handles clip extraction from full game footage:
- /api/annotate/export - Export clips, save to DB, create projects
- /api/annotate/download/{filename} - Download generated files

v3: Removed full_annotated.mp4, added TSV export, streaming downloads
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
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


def get_annotate_staging_path() -> Path:
    """Get staging directory for annotate export temp files."""
    from app.database import get_user_data_path
    staging_dir = get_user_data_path() / "annotate_staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    return staging_dir


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

    # Run FFmpeg in thread to avoid blocking (asyncio.create_subprocess_exec doesn't work on Windows)
    import subprocess
    result = await asyncio.to_thread(
        subprocess.run,
        cmd,
        capture_output=True,
    )

    if result.returncode != 0:
        logger.error(f"FFmpeg error: {result.stderr.decode()}")
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

    # Run FFmpeg in thread to avoid blocking (asyncio.create_subprocess_exec doesn't work on Windows)
    import subprocess
    result = await asyncio.to_thread(
        subprocess.run,
        cmd,
        capture_output=True,
    )

    # Clean up concat file
    os.remove(concat_file)

    if result.returncode != 0:
        logger.error(f"FFmpeg concat error: {result.stderr.decode()}")
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
    background_tasks: BackgroundTasks,
    video: UploadFile = File(None),  # Optional if game_id provided
    clips_json: str = Form(...),
    save_to_db: str = Form("true"),  # "true" = import to projects, "false" = download only
    settings_json: str = Form("{}"),  # Project creation settings
    game_id: str = Form(None),  # Optional: use existing game's video instead of upload
    export_id: str = Form(None)  # Optional: ID for progress tracking via SSE
):
    """
    Export clips from source video (async/background processing).

    Returns immediately with export_id. Processing happens in background.
    Progress updates sent via WebSocket at /ws/export/{export_id}

    Video source (one required):
    - video: Upload video file directly
    - game_id: Use video from existing game (already on server/R2)
    """
    from app.services.export_worker import process_annotate_export

    # Log request
    logger.info(f"[AnnotateExport] Request - save_to_db={save_to_db}, game_id={game_id}, "
                f"video={video.filename if video else None}, export_id={export_id}")

    should_save_to_db = save_to_db.lower() == "true"

    # Parse settings with defaults
    try:
        settings = json.loads(settings_json) if settings_json else {}
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid settings JSON: {e}")

    # Parse and validate clips
    try:
        clips = json.loads(clips_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid clips JSON: {e}")

    if not clips:
        raise HTTPException(status_code=400, detail="No clips defined")

    for i, clip in enumerate(clips):
        if 'start_time' not in clip or 'end_time' not in clip:
            raise HTTPException(status_code=400, detail=f"Clip {i} missing times")
        if clip['start_time'] >= clip['end_time']:
            raise HTTPException(status_code=400, detail=f"Clip {i} invalid range")

    # Validate video source and get game info
    game_id_int = None
    game_name = None
    video_filename = None
    staged_video_path = None

    if game_id:
        try:
            game_id_int = int(game_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid game_id")

        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name, video_filename FROM games WHERE id = ?", (game_id_int,))
            row = cursor.fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="Game not found")
            if not row['video_filename']:
                raise HTTPException(status_code=400, detail="Game has no video uploaded")

            game_name = row['name']
            video_filename = row['video_filename']

            # Verify video exists locally if not using R2
            if not R2_ENABLED:
                local_path = get_games_path() / video_filename
                if not os.path.exists(local_path):
                    raise HTTPException(status_code=404, detail="Game video file not found")

    elif video and video.filename:
        # Stage uploaded video to disk (before request ends)
        game_name = video.filename
        staging_dir = get_annotate_staging_path()

        job_id = export_id or f"annotate_{uuid.uuid4().hex[:12]}"
        video_ext = Path(video.filename).suffix or '.mp4'
        staged_video_path = str(staging_dir / f"{job_id}{video_ext}")

        try:
            content = await video.read()
            with open(staged_video_path, 'wb') as f:
                f.write(content)
            logger.info(f"[AnnotateExport] Staged video: {staged_video_path} ({len(content)/(1024*1024):.1f}MB)")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to stage video: {e}")
    else:
        raise HTTPException(status_code=400, detail="Either video file or game_id required")

    # Generate export_id if not provided
    if not export_id:
        export_id = f"annotate_{uuid.uuid4().hex[:12]}"

    # Capture user_id before background task
    user_id = get_current_user_id()

    # Build config for background processing
    config = {
        'clips': clips,
        'save_to_db': should_save_to_db,
        'settings': {
            'min_rating_for_library': settings.get('minRatingForLibrary', 4),
            'create_game_project': settings.get('createGameProject', True),
            'game_project_aspect': settings.get('gameProjectAspectRatio', '16:9'),
            'create_clip_projects': settings.get('createClipProjects', True),
            'clip_project_min_rating': settings.get('clipProjectMinRating', 5),
            'clip_project_aspect': settings.get('clipProjectAspectRatio', '9:16'),
        },
        'game_id': game_id_int,
        'game_name': game_name,
        'video_filename': video_filename,  # R2 path for game video
        'staged_video_path': staged_video_path,  # Local path for uploaded video
        'user_id': user_id,
    }

    # Create export job in database (status: pending)
    input_data = json.dumps(config)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO export_jobs (id, project_id, type, status, input_data, game_id, game_name)
            VALUES (?, 0, 'annotate', 'pending', ?, ?, ?)
        """, (export_id, input_data, game_id_int, game_name))
        conn.commit()

    logger.info(f"[AnnotateExport] Created job {export_id} for {game_name or 'uploaded video'} ({len(clips)} clips)")

    # Start background processing
    background_tasks.add_task(process_annotate_export, export_id)

    # Return immediately
    return JSONResponse({
        "success": True,
        "status": "pending",
        "export_id": export_id,
        "message": f"Export started for {len(clips)} clips"
    })


# ============================================================================
# Processing Functions (called by export_worker.py)
# ============================================================================

async def run_annotate_export_processing(export_id: str, config: dict):
    """
    Main processing function for annotate exports.
    Called by export_worker.process_annotate_export().

    This runs in a background task after the endpoint returns.
    """
    from app.routers.exports import update_job_started, update_job_complete, update_job_error
    from app.websocket import manager, export_progress

    clips = config['clips']
    save_to_db = config['save_to_db']
    settings = config['settings']
    game_id = config.get('game_id')
    game_name = config.get('game_name')
    video_filename = config.get('video_filename')  # R2 path
    staged_video_path = config.get('staged_video_path')  # Local uploaded video
    user_id = config.get('user_id')

    # Mark job as started
    update_job_started(export_id)

    # Create temp directory for processing
    temp_dir = tempfile.mkdtemp(prefix="annotate_")
    logger.info(f"[AnnotateExport] {export_id}: Created temp directory: {temp_dir}")

    # Progress helper - uses shared make_progress_data for consistent status handling
    from app.websocket import make_progress_data

    async def update_progress(current: int, total: int, phase: str, message: str, done: bool = False):
        progress_data = make_progress_data(
            current=current,
            total=total,
            phase=phase,
            message=message,
            export_type='annotate',
            done=done,
            game_id=game_id,
            game_name=game_name,
        )
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)
        if current % 5 == 0 or done or phase == 'error':
            logger.info(f"[AnnotateExport] {export_id}: {current}/{total} ({phase}) - {message}")

    try:
        # Send initial progress
        await update_progress(0, 100, 'init', 'Starting export...')

        # Determine video source
        use_modal = modal_enabled() and game_id and video_filename and not save_to_db
        source_path = None

        if staged_video_path:
            # Uploaded video - already staged
            source_path = staged_video_path
            original_filename = os.path.basename(staged_video_path)
            logger.info(f"[AnnotateExport] {export_id}: Using staged video: {source_path}")
            await update_progress(5, 100, 'download', 'Using uploaded video...')

        elif game_id and video_filename:
            # Game video - download from R2 or use local
            if R2_ENABLED and not use_modal:
                source_path = os.path.join(temp_dir, f"game_{uuid.uuid4().hex[:8]}.mp4")
                r2_key = f"games/{video_filename}"
                logger.info(f"[AnnotateExport] {export_id}: Downloading from R2: {r2_key}")

                if not await download_from_r2_with_progress(
                    user_id, r2_key, Path(source_path),
                    export_id=export_id, export_type='annotate'
                ):
                    raise Exception("Failed to download game video from R2")

            elif not R2_ENABLED:
                source_path = str(get_games_path() / video_filename)
                logger.info(f"[AnnotateExport] {export_id}: Using local game video: {source_path}")
                await update_progress(15, 100, 'download', 'Using local video...')

            original_filename = game_name + ".mp4" if game_name else "game.mp4"

        # Calculate total steps based on mode
        if save_to_db:
            total_steps = len([c for c in clips if c.get('rating', 3) >= settings['min_rating_for_library']]) + 5
        else:
            total_steps = len(clips) + 5

        # Generate unique download ID
        download_id = uuid.uuid4().hex[:8]
        video_base = sanitize_filename(os.path.splitext(original_filename)[0])

        # Separate clips by rating
        min_rating = settings['min_rating_for_library']
        good_clips = [c for c in clips if c.get('rating', 3) >= min_rating]

        # Initialize result trackers
        download_urls = {}
        created_raw_clips = []
        created_projects = []
        all_clips = clips

        # Generate TSV file
        await update_progress(1, total_steps, 'tsv', 'Generating TSV file...')
        tsv_filename = f"{video_base}_{download_id}.tsv"
        tsv_path = os.path.join(temp_dir, tsv_filename)

        with open(tsv_path, 'w', encoding='utf-8') as f:
            f.write("Clip Name\tStart Time\tEnd Time\tDuration\tRating\tNotes\tTags\n")
            for clip in clips:
                name = clip.get('name', '')
                start = clip.get('start_time', 0)
                end = clip.get('end_time', 0)
                duration = end - start
                rating = clip.get('rating', 3)
                notes = clip.get('notes', '')
                tags = ','.join(clip.get('tags', []))
                f.write(f"{name}\t{format_time_for_tsv(start)}\t{format_time_for_tsv(end)}\t{format_time_for_tsv(duration)}\t{rating}\t{notes}\t{tags}\n")

        # Upload TSV to R2
        if R2_ENABLED:
            if upload_to_r2(user_id, f"downloads/{tsv_filename}", Path(tsv_path)):
                download_urls['tsv'] = {
                    'filename': tsv_filename,
                    'url': generate_presigned_url(user_id, f"downloads/{tsv_filename}")
                }
        else:
            downloads_dir = get_downloads_path()
            downloads_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy(tsv_path, downloads_dir / tsv_filename)
            download_urls['tsv'] = {'filename': tsv_filename, 'url': f"/api/annotate/download/{tsv_filename}"}

        # Process based on mode
        if save_to_db:
            # Extract individual clips to raw_clips
            logger.info(f"[AnnotateExport] {export_id}: Extracting {len(good_clips)} clips to raw_clips")
            step = 2

            for i, clip in enumerate(good_clips):
                await update_progress(step + i, total_steps, 'extract', f"Extracting clip {i+1}/{len(good_clips)}...")

                success = await extract_clip_to_file(
                    source_path=source_path,
                    output_path=os.path.join(temp_dir, f"clip_{i}.mp4"),
                    start_time=clip['start_time'],
                    end_time=clip['end_time'],
                    clip_name=clip.get('name', ''),
                    clip_notes=clip.get('notes', '')
                )

                if success:
                    # Save to raw_clips in database
                    clip_filename = f"clip_{uuid.uuid4().hex[:12]}.mp4"

                    if R2_ENABLED:
                        upload_to_r2(user_id, f"raw_clips/{clip_filename}", Path(os.path.join(temp_dir, f"clip_{i}.mp4")))

                    with get_db_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            INSERT INTO raw_clips (game_id, start_time, end_time, name, notes, rating, tags, filename)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            game_id,
                            clip['start_time'],
                            clip['end_time'],
                            clip.get('name', ''),
                            clip.get('notes', ''),
                            clip.get('rating', 3),
                            json.dumps(clip.get('tags', [])),
                            clip_filename
                        ))
                        raw_clip_id = cursor.lastrowid
                        conn.commit()
                        created_raw_clips.append({'id': raw_clip_id, 'filename': clip_filename})

            # Create compilation video for gallery
            compilation_clips = []
            for i, clip in enumerate(good_clips):
                clip_path = os.path.join(temp_dir, f"clip_{i}.mp4")
                if os.path.exists(clip_path):
                    compilation_clips.append(clip_path)

            if compilation_clips:
                compilation_filename = f"{video_base}_compilation_{download_id}.mp4"
                compilation_path = os.path.join(temp_dir, compilation_filename)

                await update_progress(total_steps - 2, total_steps, 'concat', 'Creating compilation...')
                if await concatenate_videos(compilation_clips, compilation_path):
                    # Upload to gallery
                    if R2_ENABLED:
                        final_filename = f"{uuid.uuid4().hex[:12]}.mp4"
                        if upload_to_r2(user_id, f"final_videos/{final_filename}", Path(compilation_path)):
                            with get_db_connection() as conn:
                                cursor = conn.cursor()
                                cursor.execute("""
                                    INSERT INTO final_videos (project_id, filename, version, source_type, game_id, name)
                                    VALUES (0, ?, 1, 'annotated_game', ?, ?)
                                """, (final_filename, game_id, f"{game_name} (Annotated)" if game_name else "Annotated Export"))
                                conn.commit()

                    download_urls['clips_compilation'] = {
                        'filename': compilation_filename,
                        'url': generate_presigned_url(user_id, f"downloads/{compilation_filename}") if R2_ENABLED else f"/api/annotate/download/{compilation_filename}"
                    }

            message = f"Saved {len(created_raw_clips)} clips to library"

        else:
            # Download-only mode - create burned-in compilation
            logger.info(f"[AnnotateExport] {export_id}: Creating burned-in compilation ({len(all_clips)} clips)")

            # Use unified interface - call_modal_annotate_compilation handles Modal or local fallback
            await update_progress(10, 100, 'processing', 'Starting video processing...')

            # Generate output filename
            output_filename = f"{video_base}_annotated_{download_id}.mp4"

            # Create progress callback for unified interface
            async def unified_progress_callback(progress: float, message: str, phase: str = "processing"):
                await update_progress(int(10 + progress * 0.75), 100, phase, message)

            result = await call_modal_annotate_compilation(
                job_id=export_id,
                user_id=user_id,
                input_key=f"games/{video_filename}",
                output_key=f"downloads/{output_filename}",
                clips=all_clips,
                progress_callback=unified_progress_callback,
            )

            if result.get('status') == 'success':
                download_urls['clips_compilation'] = {
                    'filename': output_filename,
                    'url': generate_presigned_url(user_id, f"downloads/{output_filename}") if R2_ENABLED else f"/api/annotate/download/{output_filename}"
                }
            else:
                raise Exception(result.get('error', 'Compilation failed'))

            message = f"Generated annotated video with {len(all_clips)} clips"

        # Mark progress as complete
        await update_progress(100, 100, 'done', message, done=True)

        # Mark job as complete
        output_filename = download_urls.get('clips_compilation', {}).get('filename')
        update_job_complete(export_id, None, output_filename)

        logger.info(f"[AnnotateExport] {export_id}: Completed successfully - {message}")

    except Exception as e:
        logger.error(f"[AnnotateExport] {export_id}: Failed - {e}", exc_info=True)
        update_job_error(export_id, str(e))
        await update_progress(0, 100, 'error', f"Export failed: {e}")

    finally:
        # Cleanup temp directory
        cleanup_temp_dir(temp_dir)
        # Also cleanup staged video if it was an upload
        if staged_video_path and os.path.exists(staged_video_path):
            try:
                os.remove(staged_video_path)
                logger.info(f"[AnnotateExport] {export_id}: Cleaned up staged video")
            except Exception as e:
                logger.warning(f"[AnnotateExport] {export_id}: Failed to cleanup staged video: {e}")
