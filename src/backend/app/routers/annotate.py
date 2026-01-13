"""
Annotate endpoints for the Video Editor API.

This router handles clip extraction from full game footage:
- /api/annotate/export - Export clips, save to DB, create projects
- /api/annotate/download/{filename} - Download generated files

v3: Removed full_annotated.mp4, added TSV export, streaming downloads
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from starlette.background import BackgroundTask
from pathlib import Path
from typing import List, Dict, Any, Optional, AsyncGenerator
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/annotate", tags=["annotate"])

# Track export progress for SSE streaming
# Key: export_id, Value: { 'total': int, 'current': int, 'phase': str, 'message': str, 'done': bool }
_export_progress: Dict[str, Dict[str, Any]] = {}


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
    """Extract a single clip from source video using FFmpeg."""
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

    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _, stderr = process.communicate()

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

    cmd = [
        'ffmpeg', '-y',
        '-ss', format_time_for_ffmpeg(start_time),
        '-i', source_path,
        '-t', format_time_for_ffmpeg(duration),
        '-vf', filter_complex,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-c:a', 'aac',
        output_path
    ]

    logger.info(f"Creating burned-in clip: {clip_name}")

    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _, stderr = process.communicate()

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
    """Concatenate multiple video clips into one."""
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

    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _, stderr = process.communicate()

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


@router.get("/download/{filename}")
async def download_file(filename: str):
    """
    Download a generated file from the downloads folder.
    Files are cleaned up after 1 hour by a background task (TODO).
    """
    logger.info(f"[Download] Request for file: {filename}")

    # Ensure directories exist
    ensure_directories()

    # Security: prevent path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        logger.error(f"[Download] VALIDATION ERROR - Path traversal attempt detected: {filename}")
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = get_downloads_path() / filename

    if not file_path.exists():
        logger.error(f"[Download] VALIDATION ERROR - File not found: {file_path}")
        raise HTTPException(status_code=404, detail="File not found")

    # Determine media type
    if filename.endswith('.mp4'):
        media_type = 'video/mp4'
    elif filename.endswith('.tsv'):
        media_type = 'text/tab-separated-values'
    else:
        media_type = 'application/octet-stream'

    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type=media_type
    )


@router.get("/progress/{export_id}")
async def get_export_progress(export_id: str):
    """
    SSE endpoint for real-time export progress updates.

    Connect to this endpoint after starting an export to receive progress updates.

    Event format:
    data: {"current": 3, "total": 10, "phase": "clips", "message": "Processing clip 3/10...", "done": false}

    Phases:
    - "starting": Export initialized
    - "clips": Processing individual clips (with burned-in text)
    - "concatenating": Merging clips into compilation video
    - "saving": Saving to database and creating projects
    - "done": Export complete
    """
    async def generate_progress() -> AsyncGenerator[str, None]:
        """Generator that yields SSE events."""
        while True:
            if export_id not in _export_progress:
                # Export not started yet, send waiting message
                yield f"data: {json.dumps({'phase': 'waiting', 'message': 'Waiting for export to start...'})}\n\n"
                await asyncio.sleep(0.5)
                continue

            progress = _export_progress[export_id]
            yield f"data: {json.dumps(progress)}\n\n"

            if progress.get('done', False):
                # Clean up and close connection
                del _export_progress[export_id]
                break

            await asyncio.sleep(0.3)

    return StreamingResponse(
        generate_progress(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


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

            source_path = str(get_games_path() / row['video_filename'])
            original_filename = row['name'] + ".mp4"

            if not os.path.exists(source_path):
                logger.error(f"[Export] VALIDATION ERROR - Game video file not found on disk: {source_path}")
                raise HTTPException(status_code=404, detail="Game video file not found")

            logger.info(f"[Export] Using game {game_id} video: {row['video_filename']}")

    elif video and video.filename:
        # Use uploaded video - need temp dir
        logger.info(f"[Export] Using uploaded video: {video.filename}")
        pass  # Will be handled below
    else:
        logger.error("[Export] VALIDATION ERROR - Neither video file nor game_id provided")
        raise HTTPException(status_code=400, detail="Either video file or game_id required")

    # Create temp directory for processing
    temp_dir = tempfile.mkdtemp(prefix="annotate_")
    logger.info(f"Created temp directory: {temp_dir}")

    try:
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

        # Helper function to update progress
        def update_progress(current: int, total: int, phase: str, message: str, done: bool = False):
            if export_id:
                _export_progress[export_id] = {
                    'current': current,
                    'total': total,
                    'phase': phase,
                    'message': message,
                    'done': done
                }

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
        update_progress(0, total_steps, 'starting', 'Initializing export...')
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
                update_progress(step, total_steps, 'extracting', f'Extracting clip {idx + 1}/{len(good_clips)}: {clip_name}')

                base_name = sanitize_filename(clip_name)
                unique_name = ensure_unique_filename(base_name, used_names)
                used_names.add(unique_name)

                filename = f"{unique_name}.mp4"
                output_path = str(get_raw_clips_path() / filename)

                # Extract clip to raw_clips folder
                success = await extract_clip_to_file(
                    source_path=source_path,
                    output_path=output_path,
                    start_time=clip['start_time'],
                    end_time=clip['end_time'],
                    clip_name=clip_name,
                    clip_notes=clip.get('notes', '')
                )

                if success:
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

                    logger.info(f"Saved raw clip {raw_clip_id}: {filename}")

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
        update_progress(step, total_steps, 'tsv', 'Generating annotations TSV...')
        tsv_filename = f"{video_base}_{download_id}_annotations.tsv"
        tsv_path = get_downloads_path() / tsv_filename
        tsv_content = generate_annotations_tsv(all_clips, original_filename)
        with open(tsv_path, 'w', encoding='utf-8') as f:
            f.write(tsv_content)
        logger.info(f"Generated annotations TSV: {tsv_filename}")
        download_urls['annotations'] = {
            'filename': tsv_filename,
            'url': f"/api/annotate/download/{tsv_filename}"
        }

        # 2. Generate clips_compilation.mp4 with burned-in overlays
        # Only generate compilation video for "Download Clips Review" mode (save_to_db=false)
        # When importing into projects, users don't need the compilation since clips are saved to DB
        if not should_save_to_db:
            for idx, clip in enumerate(all_clips):
                clip_name = clip.get('name', 'clip')
                step += 1
                update_progress(step, total_steps, 'clips', f'Creating clip {idx + 1}/{len(all_clips)}: {clip_name}')
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

            # Concatenate burned clips into compilation
            if burned_clip_paths:
                step += 1
                update_progress(step, total_steps, 'concatenating', f'Merging {len(burned_clip_paths)} clips into compilation...')
                compilation_filename = f"{video_base}_{download_id}_clips_review.mp4"
                compilation_path = str(get_downloads_path() / compilation_filename)

                if await concatenate_videos(burned_clip_paths, compilation_path):
                    compilation_size = os.path.getsize(compilation_path)
                    logger.info(f"Generated clips compilation: {compilation_filename} ({compilation_size / (1024*1024):.1f}MB)")
                    download_urls['clips_compilation'] = {
                        'filename': compilation_filename,
                        'url': f"/api/annotate/download/{compilation_filename}"
                    }

                    # Add to gallery (final_videos table)
                    # No project is created - annotated exports are standalone
                    with get_db_connection() as conn:
                        cursor = conn.cursor()

                        # Get game name for the video title
                        game_name = video_base
                        if game_id:
                            cursor.execute("SELECT name FROM games WHERE id = ?", (int(game_id),))
                            game_row = cursor.fetchone()
                            if game_row:
                                game_name = game_row['name']

                        # Copy compilation to final_videos folder
                        final_filename = f"{uuid.uuid4().hex[:12]}.mp4"
                        final_path = get_final_videos_path() / final_filename
                        shutil.copy2(compilation_path, final_path)

                        # Add to final_videos table with name (no project)
                        # Use project_id = 0 as marker for "no project"
                        annotated_name = f"{game_name} (Annotated)"
                        cursor.execute("""
                            INSERT INTO final_videos (project_id, filename, version, source_type, game_id, name)
                            VALUES (0, ?, 1, 'annotated_game', ?, ?)
                        """, (final_filename, int(game_id) if game_id else None, annotated_name))
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
        update_progress(total_steps, total_steps, 'done', message, done=True)

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
        cleanup_temp_dir(temp_dir)
        raise
    except Exception as e:
        logger.error(f"[Export] UNEXPECTED ERROR - Export failed: {type(e).__name__}: {e}", exc_info=True)
        cleanup_temp_dir(temp_dir)
        raise HTTPException(status_code=500, detail=str(e))
