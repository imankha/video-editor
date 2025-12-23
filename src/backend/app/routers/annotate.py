"""
Annotate endpoints for the Video Editor API.

This router handles clip extraction from full game footage:
- /api/annotate/export - Export clips, save to DB, create projects
- /api/annotate/download/{filename} - Download generated files

v3: Removed full_annotated.mp4, added TSV export, streaming downloads
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from starlette.background import BackgroundTask
from pathlib import Path
from typing import List, Dict, Any
import json
import os
import tempfile
import uuid
import subprocess
import logging
import re

from app.database import get_db_connection, RAW_CLIPS_PATH, DOWNLOADS_PATH, ensure_directories

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


async def create_clip_with_burned_text(
    source_path: str,
    output_path: str,
    start_time: float,
    end_time: float,
    clip_name: str,
    clip_notes: str,
    rating: int,
    tags: List[str]
) -> bool:
    """
    Extract clip with burned-in text overlay showing annotations.
    """
    duration = end_time - start_time

    # Build text overlay - use ASCII stars for FFmpeg compatibility
    rating_display = f"[{rating}/5]"
    tags_text = ', '.join(tags) if tags else ''

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

    # Build filter complex for text overlays
    # Show text in top-left with semi-transparent background
    filter_parts = []

    # Background box for text
    filter_parts.append(
        "drawbox=x=10:y=10:w=400:h=100:color=black@0.6:t=fill"
    )

    # Clip name (large)
    escaped_name = escape_drawtext(clip_name)
    filter_parts.append(
        f"drawtext=text='{escaped_name}':fontsize=24:fontcolor=white:x=20:y=20"
    )

    # Rating display
    escaped_rating = escape_drawtext(rating_display)
    filter_parts.append(
        f"drawtext=text='{escaped_rating}':fontsize=20:fontcolor=gold:x=20:y=50"
    )

    # Tags (if any)
    if tags_text:
        escaped_tags = escape_drawtext(tags_text)
        filter_parts.append(
            f"drawtext=text='{escaped_tags}':fontsize=16:fontcolor=white:x=20:y=75"
        )

    # Notes (if any) - shown at bottom
    # Note: drawbox uses ih/iw, drawtext uses h/w for video dimensions
    if clip_notes:
        filter_parts.append(
            "drawbox=x=10:y=ih-60:w=iw-20:h=50:color=black@0.6:t=fill"
        )
        escaped_notes = escape_drawtext(clip_notes[:100])
        filter_parts.append(
            f"drawtext=text='{escaped_notes}':fontsize=14:fontcolor=white:x=20:y=h-50"
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
    # Ensure directories exist
    ensure_directories()

    # Security: prevent path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = DOWNLOADS_PATH / filename

    if not file_path.exists():
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


@router.post("/export")
async def export_clips(
    video: UploadFile = File(...),
    clips_json: str = Form(...)
):
    """
    Export clips from source video.

    Clip JSON format:
    [
      {
        "start_time": 150.5,
        "end_time": 165.5,
        "name": "Brilliant Goal",
        "notes": "Amazing finish",
        "rating": 5,
        "tags": ["Goal", "1v1 Attack"]
      }
    ]

    Response:
    - downloads: URLs for downloadable files (TSV, compilation video)
    - created: info about created raw_clips and projects
    """
    # Parse clips JSON
    try:
        clips = json.loads(clips_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid clips JSON")

    if not clips:
        raise HTTPException(status_code=400, detail="No clips defined")

    # Validate clips
    for i, clip in enumerate(clips):
        if 'start_time' not in clip or 'end_time' not in clip:
            raise HTTPException(status_code=400, detail=f"Clip {i} missing times")
        if clip['start_time'] >= clip['end_time']:
            raise HTTPException(status_code=400, detail=f"Clip {i} invalid range")

    # Ensure directories exist
    ensure_directories()

    # Create temp directory for processing
    temp_dir = tempfile.mkdtemp(prefix="annotate_")
    logger.info(f"Created temp directory: {temp_dir}")

    try:
        # Save uploaded video
        original_filename = video.filename or "source_video.mp4"
        source_path = os.path.join(temp_dir, f"source_{uuid.uuid4().hex[:8]}.mp4")

        with open(source_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        source_size_mb = len(content) / (1024 * 1024)
        logger.info(f"Saved source video: {source_size_mb:.1f}MB")

        # Generate unique export ID for download filenames
        export_id = uuid.uuid4().hex[:8]
        video_base = sanitize_filename(os.path.splitext(original_filename)[0])

        # Separate clips by rating
        good_clips = [c for c in clips if c.get('rating', 3) >= 4]
        all_clips = clips

        used_names = set()
        created_raw_clips = []
        burned_clip_paths = []

        # Process good/brilliant clips (4+ stars) - save to DB and filesystem
        for clip in good_clips:
            clip_name = clip.get('name', 'clip')
            base_name = sanitize_filename(clip_name)
            unique_name = ensure_unique_filename(base_name, used_names)
            used_names.add(unique_name)

            filename = f"{unique_name}.mp4"
            output_path = str(RAW_CLIPS_PATH / filename)

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

        # Create projects from the saved clips
        created_projects = []

        if created_raw_clips:
            with get_db_connection() as conn:
                cursor = conn.cursor()

                # 1. Create "game" project with ALL good+brilliant clips
                game_project_name = f"{video_base}_game"

                cursor.execute("""
                    INSERT INTO projects (name, aspect_ratio)
                    VALUES (?, ?)
                """, (game_project_name, '16:9'))
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

                # 2. Create individual projects for BRILLIANT clips (5-star)
                brilliant_clips = [c for c in created_raw_clips if c['rating'] == 5]

                for raw_clip in brilliant_clips:
                    clip_project_name = f"{sanitize_filename(raw_clip['name'])}_clip"

                    cursor.execute("""
                        INSERT INTO projects (name, aspect_ratio)
                        VALUES (?, ?)
                    """, (clip_project_name, '9:16'))
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
        tsv_filename = f"{video_base}_{export_id}_annotations.tsv"
        tsv_path = DOWNLOADS_PATH / tsv_filename
        tsv_content = generate_annotations_tsv(all_clips, original_filename)
        with open(tsv_path, 'w', encoding='utf-8') as f:
            f.write(tsv_content)
        logger.info(f"Generated annotations TSV: {tsv_filename}")
        download_urls['annotations'] = {
            'filename': tsv_filename,
            'url': f"/api/annotate/download/{tsv_filename}"
        }

        # 2. Generate clips_compilation.mp4 with burned-in overlays
        for clip in all_clips:
            clip_name = clip.get('name', 'clip')
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
            compilation_filename = f"{video_base}_{export_id}_clips_review.mp4"
            compilation_path = str(DOWNLOADS_PATH / compilation_filename)

            if await concatenate_videos(burned_clip_paths, compilation_path):
                compilation_size = os.path.getsize(compilation_path)
                logger.info(f"Generated clips compilation: {compilation_filename} ({compilation_size / (1024*1024):.1f}MB)")
                download_urls['clips_compilation'] = {
                    'filename': compilation_filename,
                    'url': f"/api/annotate/download/{compilation_filename}"
                }

        logger.info(f"Export complete: {len(created_raw_clips)} clips saved, {len(created_projects)} projects created")

        # Build response
        response_data = {
            'success': True,
            'downloads': download_urls,
            'created': {
                'raw_clips': created_raw_clips,
                'projects': created_projects
            },
            'message': f"Saved {len(created_raw_clips)} clips and created {len(created_projects)} projects"
        }

        return JSONResponse(response_data, background=BackgroundTask(cleanup_temp_dir, temp_dir))

    except HTTPException:
        cleanup_temp_dir(temp_dir)
        raise
    except Exception as e:
        logger.error(f"Export error: {e}")
        cleanup_temp_dir(temp_dir)
        raise HTTPException(status_code=500, detail=str(e))
