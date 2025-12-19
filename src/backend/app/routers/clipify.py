"""
Clipify endpoints for the Video Editor API.

This router handles clip extraction from full game footage:
- /api/clipify/export - Export clips from source video and create annotated source
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from starlette.background import BackgroundTask
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
import json
import os
import tempfile
import uuid
import subprocess
import logging
import re
import io
import zipfile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/clipify", tags=["clipify"])


def sanitize_filename(name: str) -> str:
    """
    Sanitize clip name for use as filename.
    - Replace colons with dashes (for timestamps like 00:02:30 -> 00-02-30)
    - Replace spaces with underscores
    - Remove special characters
    - Limit length
    """
    # Replace colons with dashes
    sanitized = name.replace(':', '-')
    # Replace spaces with underscores
    sanitized = sanitized.replace(' ', '_')
    # Remove any characters that aren't alphanumeric, dash, underscore, or dot
    sanitized = re.sub(r'[^\w\-.]', '', sanitized)
    # Limit length
    if len(sanitized) > 50:
        sanitized = sanitized[:50]
    # Ensure it's not empty
    if not sanitized:
        sanitized = 'clip'
    return sanitized


def format_time_for_ffmpeg(seconds: float) -> str:
    """Convert seconds to HH:MM:SS.mmm format for FFmpeg."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"


def ensure_unique_filename(base_name: str, existing_names: set) -> str:
    """Ensure filename is unique by adding suffix if needed."""
    if base_name not in existing_names:
        return base_name

    counter = 1
    while f"{base_name}_{counter}" in existing_names:
        counter += 1
    return f"{base_name}_{counter}"


async def extract_clip(
    source_path: str,
    output_path: str,
    start_time: float,
    end_time: float,
    clip_name: str,
    clip_notes: str,
    original_filename: str
) -> Dict[str, Any]:
    """
    Extract a single clip from source video using FFmpeg.
    Embeds metadata (title, description, original video info).
    """
    duration = end_time - start_time

    # Build FFmpeg command
    cmd = [
        'ffmpeg', '-y',
        '-ss', format_time_for_ffmpeg(start_time),
        '-i', source_path,
        '-t', format_time_for_ffmpeg(duration),
        '-metadata', f'title={clip_name}',
        '-metadata', f'description={clip_notes}',
        '-metadata', f'original_video={original_filename}',
        '-metadata', f'clip_start={format_time_for_ffmpeg(start_time)}',
        '-metadata', f'clip_end={format_time_for_ffmpeg(end_time)}',
        '-c', 'copy',  # Stream copy for speed
        output_path
    ]

    logger.info(f"Extracting clip: {clip_name} ({start_time:.2f}s - {end_time:.2f}s)")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    _, stderr = process.communicate()

    if process.returncode != 0:
        logger.error(f"FFmpeg error extracting clip: {stderr.decode()}")
        raise HTTPException(status_code=500, detail=f"Failed to extract clip: {clip_name}")

    return {
        'filename': os.path.basename(output_path),
        'duration': duration,
        'path': output_path
    }


async def create_annotated_source(
    source_path: str,
    output_path: str,
    clips: List[Dict[str, Any]],
    original_filename: str
) -> str:
    """
    Create annotated source video with all clip notes embedded in metadata.
    """
    # Build clip metadata JSON
    clips_metadata = {
        'clipify_version': '1.0',
        'original_filename': original_filename,
        'exported_at': datetime.utcnow().isoformat(),
        'clips': [
            {
                'name': clip['name'],
                'start': format_time_for_ffmpeg(clip['start_time']),
                'end': format_time_for_ffmpeg(clip['end_time']),
                'notes': clip.get('notes', '')
            }
            for clip in clips
        ]
    }

    # Escape JSON for FFmpeg metadata
    metadata_json = json.dumps(clips_metadata, ensure_ascii=False)

    # Build FFmpeg command
    cmd = [
        'ffmpeg', '-y',
        '-i', source_path,
        '-metadata', f'description={metadata_json}',
        '-c', 'copy',
        output_path
    ]

    logger.info(f"Creating annotated source with {len(clips)} clip(s) metadata")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    _, stderr = process.communicate()

    if process.returncode != 0:
        logger.error(f"FFmpeg error creating annotated source: {stderr.decode()}")
        raise HTTPException(status_code=500, detail="Failed to create annotated source video")

    return output_path


def cleanup_temp_dir(temp_dir: str):
    """Clean up temporary directory after response is sent."""
    import shutil
    try:
        shutil.rmtree(temp_dir)
        logger.info(f"Cleaned up temp directory: {temp_dir}")
    except Exception as e:
        logger.warning(f"Failed to clean up temp directory: {e}")


@router.post("/export")
async def export_clips(
    video: UploadFile = File(...),
    clips_json: str = Form(...)
):
    """
    Export clips from source video.

    Request:
    - video: The source video file
    - clips_json: JSON string of clip definitions

    Response:
    - ZIP file containing:
      - All extracted clips (as .mp4 files)
      - Annotated source video (original_annotated.mp4)

    Clip definition format:
    [
      {
        "start_time": 150.5,
        "end_time": 165.5,
        "name": "Great dribble",
        "notes": "Amazing dribble past 3 defenders"
      }
    ]
    """
    # Parse clips JSON
    try:
        clips = json.loads(clips_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid clips JSON format")

    if not clips:
        raise HTTPException(status_code=400, detail="No clips defined")

    # Validate clips
    for i, clip in enumerate(clips):
        if 'start_time' not in clip or 'end_time' not in clip:
            raise HTTPException(status_code=400, detail=f"Clip {i} missing start_time or end_time")
        if clip['start_time'] >= clip['end_time']:
            raise HTTPException(status_code=400, detail=f"Clip {i} has invalid time range")

    # Create temp directory for processing
    temp_dir = tempfile.mkdtemp(prefix="clipify_")
    logger.info(f"Created temp directory: {temp_dir}")

    try:
        # Save uploaded video to temp directory
        original_filename = video.filename or "source_video.mp4"
        source_path = os.path.join(temp_dir, f"source_{uuid.uuid4().hex[:8]}.mp4")

        with open(source_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        logger.info(f"Saved source video: {source_path} ({len(content)} bytes)")

        # Track unique filenames
        used_names = set()
        exported_clips = []

        # Extract each clip
        for i, clip in enumerate(clips):
            clip_name = clip.get('name', f'clip_{i+1}')
            clip_notes = clip.get('notes', '')

            # Sanitize and ensure unique filename
            base_name = sanitize_filename(clip_name)
            unique_name = ensure_unique_filename(base_name, used_names)
            used_names.add(unique_name)

            output_filename = f"{unique_name}.mp4"
            output_path = os.path.join(temp_dir, output_filename)

            clip_info = await extract_clip(
                source_path=source_path,
                output_path=output_path,
                start_time=clip['start_time'],
                end_time=clip['end_time'],
                clip_name=clip_name,
                clip_notes=clip_notes,
                original_filename=original_filename
            )

            exported_clips.append(clip_info)

        # Create annotated source video
        annotated_base = os.path.splitext(original_filename)[0]
        annotated_filename = f"{sanitize_filename(annotated_base)}_annotated.mp4"
        annotated_path = os.path.join(temp_dir, annotated_filename)

        await create_annotated_source(
            source_path=source_path,
            output_path=annotated_path,
            clips=clips,
            original_filename=original_filename
        )

        # Create ZIP file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # Add all clips
            for clip_info in exported_clips:
                clip_path = clip_info['path']
                zip_file.write(clip_path, os.path.basename(clip_path))

            # Add annotated source
            zip_file.write(annotated_path, annotated_filename)

        zip_buffer.seek(0)

        logger.info(f"Created ZIP with {len(exported_clips)} clips + annotated source")

        # Return ZIP file as streaming response
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename=clipify_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
            },
            background=BackgroundTask(cleanup_temp_dir, temp_dir)
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        cleanup_temp_dir(temp_dir)
        raise
    except Exception as e:
        logger.error(f"Error during clip export: {e}")
        cleanup_temp_dir(temp_dir)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/export-individual")
async def export_clips_individual(
    video: UploadFile = File(...),
    clips_json: str = Form(...)
):
    """
    Export clips from source video as individual files (alternative endpoint).
    Returns JSON with base64-encoded files instead of ZIP.

    This endpoint is useful when the frontend needs to process clips individually
    (e.g., loading them directly into Framing mode).
    """
    import base64

    # Parse clips JSON
    try:
        clips = json.loads(clips_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid clips JSON format")

    if not clips:
        raise HTTPException(status_code=400, detail="No clips defined")

    # Create temp directory for processing
    temp_dir = tempfile.mkdtemp(prefix="clipify_")

    try:
        # Save uploaded video
        original_filename = video.filename or "source_video.mp4"
        source_path = os.path.join(temp_dir, f"source_{uuid.uuid4().hex[:8]}.mp4")

        with open(source_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        # Track unique filenames
        used_names = set()
        exported_clips = []

        # Extract each clip
        for i, clip in enumerate(clips):
            clip_name = clip.get('name', f'clip_{i+1}')
            clip_notes = clip.get('notes', '')

            base_name = sanitize_filename(clip_name)
            unique_name = ensure_unique_filename(base_name, used_names)
            used_names.add(unique_name)

            output_filename = f"{unique_name}.mp4"
            output_path = os.path.join(temp_dir, output_filename)

            await extract_clip(
                source_path=source_path,
                output_path=output_path,
                start_time=clip['start_time'],
                end_time=clip['end_time'],
                clip_name=clip_name,
                clip_notes=clip_notes,
                original_filename=original_filename
            )

            # Read clip file and encode as base64
            with open(output_path, 'rb') as f:
                clip_data = base64.b64encode(f.read()).decode('utf-8')

            exported_clips.append({
                'filename': output_filename,
                'name': clip_name,
                'notes': clip_notes,
                'start_time': clip['start_time'],
                'end_time': clip['end_time'],
                'duration': clip['end_time'] - clip['start_time'],
                'data': clip_data
            })

        # Create annotated source
        annotated_base = os.path.splitext(original_filename)[0]
        annotated_filename = f"{sanitize_filename(annotated_base)}_annotated.mp4"
        annotated_path = os.path.join(temp_dir, annotated_filename)

        await create_annotated_source(
            source_path=source_path,
            output_path=annotated_path,
            clips=clips,
            original_filename=original_filename
        )

        # Read annotated source
        with open(annotated_path, 'rb') as f:
            annotated_data = base64.b64encode(f.read()).decode('utf-8')

        return JSONResponse({
            'success': True,
            'clips': exported_clips,
            'annotated_source': {
                'filename': annotated_filename,
                'data': annotated_data
            }
        })

    finally:
        cleanup_temp_dir(temp_dir)
