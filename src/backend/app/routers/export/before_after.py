"""
Before/After comparison video generation.

This module generates side-by-side comparison videos showing:
- "Before" segments from source raw clips
- "After" final exported video

Output format is 9x16 (1080x1920) with text overlays.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
import subprocess
import tempfile
import logging
import os

from ...database import get_db_connection, get_final_videos_path

router = APIRouter()
logger = logging.getLogger(__name__)

# Output dimensions (9:16 vertical)
OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920


def get_video_info(video_path: str) -> dict:
    """Get video dimensions and duration using ffprobe."""
    try:
        result = subprocess.run([
            'ffprobe', '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams',
            '-show_format',
            video_path
        ], capture_output=True, text=True)

        import json
        info = json.loads(result.stdout)

        # Find video stream
        video_stream = None
        for stream in info.get('streams', []):
            if stream.get('codec_type') == 'video':
                video_stream = stream
                break

        if not video_stream:
            return None

        return {
            'width': int(video_stream.get('width', 0)),
            'height': int(video_stream.get('height', 0)),
            'duration': float(info.get('format', {}).get('duration', 0)),
            'fps': eval(video_stream.get('r_frame_rate', '30/1'))
        }
    except Exception as e:
        logger.error(f"Failed to get video info: {e}")
        return None


def generate_before_clip(source_path: str, start_frame: int, end_frame: int,
                         output_path: str, fps: float = 30.0) -> bool:
    """
    Generate a "Before" clip from source video.

    Extracts the frame range, scales to fit 9x16 with letterboxing,
    and adds "Before" text overlay.
    """
    start_time = start_frame / fps
    duration = (end_frame - start_frame) / fps

    if duration <= 0:
        # If no valid duration, use first 3 seconds
        start_time = 0
        duration = 3.0

    # FFmpeg filter to:
    # 1. Scale to fit inside 1080x1920 while maintaining aspect ratio
    # 2. Pad to exactly 1080x1920 (letterbox/pillarbox)
    # 3. Normalize SAR to 1:1 for concat compatibility
    # 4. Add "Before" text at top center
    filter_complex = (
        f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,"
        f"setsar=1,"
        f"drawtext=text='Before':fontsize=72:fontcolor=white:"
        f"x=(w-text_w)/2:y=80:borderw=3:bordercolor=black"
    )

    cmd = [
        'ffmpeg', '-y',
        '-ss', str(start_time),
        '-i', source_path,
        '-t', str(duration),
        '-vf', filter_complex,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-an',  # No audio for before clips
        output_path
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"FFmpeg error: {result.stderr}")
            return False
        return True
    except Exception as e:
        logger.error(f"Failed to generate before clip: {e}")
        return False


def generate_after_clip(final_video_path: str, output_path: str) -> bool:
    """
    Generate an "After" clip from the final video.

    Adds "After" text overlay. Video should already be 9x16.
    """
    # FFmpeg filter to add "After" text at top center
    # Include setsar=1 to normalize SAR for concat compatibility
    filter_complex = (
        f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,"
        f"setsar=1,"
        f"drawtext=text='After':fontsize=72:fontcolor=white:"
        f"x=(w-text_w)/2:y=80:borderw=3:bordercolor=black"
    )

    cmd = [
        'ffmpeg', '-y',
        '-i', final_video_path,
        '-vf', filter_complex,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-an',  # No audio
        output_path
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"FFmpeg error: {result.stderr}")
            return False
        return True
    except Exception as e:
        logger.error(f"Failed to generate after clip: {e}")
        return False


def concatenate_clips(clip_paths: list, output_path: str) -> bool:
    """Concatenate multiple video clips using FFmpeg concat filter."""
    try:
        # Build filter_complex for concatenation
        # This ensures proper re-encoding and compatibility
        inputs = []
        filter_parts = []

        for i, path in enumerate(clip_paths):
            inputs.extend(['-i', path])
            filter_parts.append(f'[{i}:v]')

        # Concat all video streams
        filter_complex = f"{''.join(filter_parts)}concat=n={len(clip_paths)}:v=1:a=0[outv]"

        cmd = [
            'ffmpeg', '-y',
            *inputs,
            '-filter_complex', filter_complex,
            '-map', '[outv]',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            output_path
        ]

        logger.info(f"[Before/After] Concatenating {len(clip_paths)} clips")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"FFmpeg concat error: {result.stderr}")
            return False
        return True
    except Exception as e:
        logger.error(f"Failed to concatenate clips: {e}")
        return False


@router.get("/before-after/{final_video_id}/status")
async def get_before_after_status(final_video_id: int):
    """
    Check if before/after comparison is available for a final video.

    Returns:
    - available: Whether comparison can be generated
    - clip_count: Number of source clips tracked
    - final_video_exists: Whether final video file exists
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Check if final video exists
        cursor.execute("""
            SELECT filename FROM final_videos WHERE id = ?
        """, (final_video_id,))
        final_video = cursor.fetchone()

        if not final_video:
            return JSONResponse({
                'available': False,
                'clip_count': 0,
                'final_video_exists': False,
                'error': 'Final video not found'
            })

        final_path = get_final_videos_path() / final_video['filename']
        final_exists = final_path.exists()

        # Check for tracked source clips
        cursor.execute("""
            SELECT COUNT(*) as count FROM before_after_tracks
            WHERE final_video_id = ?
        """, (final_video_id,))
        clip_count = cursor.fetchone()['count']

        return JSONResponse({
            'available': clip_count > 0 and final_exists,
            'clip_count': clip_count,
            'final_video_exists': final_exists
        })


@router.post("/before-after/{final_video_id}")
async def generate_before_after(final_video_id: int):
    """
    Generate a before/after comparison video.

    Creates a video showing:
    1. Each source clip (trimmed portion) with "Before" overlay
    2. The final video with "After" overlay

    Returns the generated video file.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get final video info
        cursor.execute("""
            SELECT filename FROM final_videos WHERE id = ?
        """, (final_video_id,))
        final_video = cursor.fetchone()

        if not final_video:
            raise HTTPException(status_code=404, detail="Final video not found")

        final_path = get_final_videos_path() / final_video['filename']
        if not final_path.exists():
            raise HTTPException(status_code=404, detail="Final video file not found")

        # Get tracked source clips
        cursor.execute("""
            SELECT source_path, start_frame, end_frame, clip_index
            FROM before_after_tracks
            WHERE final_video_id = ?
            ORDER BY clip_index
        """, (final_video_id,))
        tracks = cursor.fetchall()

        if not tracks:
            raise HTTPException(
                status_code=400,
                detail="No source clips tracked for this video. Export was created before tracking was enabled."
            )

    # Generate clips in temp directory
    temp_dir = tempfile.mkdtemp(prefix='before_after_')
    clip_paths = []

    try:
        logger.info(f"[Before/After] Generating comparison for final_video {final_video_id}")

        # Generate "Before" clips for each source
        for i, track in enumerate(tracks):
            source_path = track['source_path']
            if not Path(source_path).exists():
                logger.warning(f"Source file not found: {source_path}")
                continue

            before_path = os.path.join(temp_dir, f"before_{i}.mp4")
            success = generate_before_clip(
                source_path=source_path,
                start_frame=track['start_frame'],
                end_frame=track['end_frame'],
                output_path=before_path
            )

            if success and os.path.exists(before_path):
                clip_paths.append(before_path)
                logger.info(f"[Before/After] Generated before clip {i}")

        if not clip_paths:
            raise HTTPException(
                status_code=500,
                detail="Failed to generate any before clips"
            )

        # Log before clips info
        for i, path in enumerate(clip_paths):
            size = os.path.getsize(path) if os.path.exists(path) else 0
            logger.info(f"[Before/After] Before clip {i}: {path} ({size} bytes)")

        # Generate "After" clip from final video
        after_path = os.path.join(temp_dir, "after.mp4")
        success = generate_after_clip(
            final_video_path=str(final_path),
            output_path=after_path
        )

        if not success or not os.path.exists(after_path):
            raise HTTPException(
                status_code=500,
                detail="Failed to generate after clip"
            )

        after_size = os.path.getsize(after_path) if os.path.exists(after_path) else 0
        logger.info(f"[Before/After] After clip: {after_path} ({after_size} bytes)")

        clip_paths.append(after_path)

        # Concatenate all clips
        output_path = os.path.join(temp_dir, "comparison.mp4")
        logger.info(f"[Before/After] Concatenating {len(clip_paths)} clips...")
        success = concatenate_clips(clip_paths, output_path)

        if not success or not os.path.exists(output_path):
            raise HTTPException(
                status_code=500,
                detail="Failed to concatenate clips"
            )

        output_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        logger.info(f"[Before/After] Final comparison: {output_path} ({output_size} bytes)")

        logger.info(f"[Before/After] Generated comparison video")

        # Return the file
        return FileResponse(
            path=output_path,
            media_type="video/mp4",
            filename=f"before_after_{final_video_id}.mp4",
            # Don't delete temp files immediately - FileResponse needs them
            # They'll be cleaned up by OS temp file cleanup
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Before/After] Error generating comparison: {e}")
        raise HTTPException(status_code=500, detail=str(e))
