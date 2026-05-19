"""
Before/After comparison video generation.

This module generates side-by-side comparison videos showing:
- "Before" segments from source raw clips
- "After" final exported video

Output format is 9x16 (1080x1920) with optional text overlays.
Supports merged (single file) or separate (zip with before.mp4 + after.mp4) output.
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
import subprocess
import tempfile
import logging
import os
import zipfile

from ...database import get_db_connection, get_final_videos_path
from ...services.ffmpeg_service import get_encoding_command_parts

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
                         output_path: str, fps: float = 30.0,
                         overlays: bool = True) -> bool:
    """
    Generate a "Before" clip from source video.

    Extracts the frame range, scales to fit 9x16 with letterboxing.
    Adds "Before" text overlay when overlays=True.
    """
    start_time = start_frame / fps
    duration = (end_frame - start_frame) / fps

    if duration <= 0:
        start_time = 0
        duration = 3.0

    filter_complex = (
        f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,"
        f"setsar=1,fps=30"
    )
    if overlays:
        filter_complex += (
            f",drawtext=text='Before':fontsize=72:fontcolor=white:"
            f"x=(w-text_w)/2:y=80:borderw=3:bordercolor=black"
        )

    # Use GPU encoding if available
    encoding_params = get_encoding_command_parts(prefer_quality=False)  # Speed over quality for previews

    cmd = [
        'ffmpeg', '-y',
        '-ss', str(start_time),
        '-i', source_path,
        '-t', str(duration),
        '-vf', filter_complex,
    ]
    cmd.extend(encoding_params)
    cmd.extend(['-an', output_path])  # No audio for before clips

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"FFmpeg error: {result.stderr}")
            return False
        return True
    except Exception as e:
        logger.error(f"Failed to generate before clip: {e}")
        return False


def generate_after_clip(final_video_path: str, output_path: str,
                        overlays: bool = True) -> bool:
    """
    Generate an "After" clip from the final video.

    Adds "After" text overlay when overlays=True. Video should already be 9x16.
    """
    filter_complex = (
        f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,"
        f"setsar=1,fps=30"
    )
    if overlays:
        filter_complex += (
            f",drawtext=text='After':fontsize=72:fontcolor=white:"
            f"x=(w-text_w)/2:y=80:borderw=3:bordercolor=black"
        )

    # Use GPU encoding if available
    encoding_params = get_encoding_command_parts(prefer_quality=False)  # Speed over quality for previews

    cmd = [
        'ffmpeg', '-y',
        '-i', final_video_path,
        '-vf', filter_complex,
    ]
    cmd.extend(encoding_params)
    cmd.extend(['-an', output_path])  # No audio

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
            # Normalize each input to 30fps for QSV compatibility
            filter_parts.append(f'[{i}:v]fps=30[v{i}];')

        # Concat all normalized video streams
        concat_inputs = ''.join([f'[v{i}]' for i in range(len(clip_paths))])
        filter_complex = f"{''.join(filter_parts)}{concat_inputs}concat=n={len(clip_paths)}:v=1:a=0[outv]"

        # Use GPU encoding if available
        encoding_params = get_encoding_command_parts(prefer_quality=False)

        cmd = [
            'ffmpeg', '-y',
            *inputs,
            '-filter_complex', filter_complex,
            '-map', '[outv]',
        ]
        cmd.extend(encoding_params)
        cmd.append(output_path)

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
async def generate_before_after(
    final_video_id: int,
    output: str = Query("merged", pattern="^(merged|separate)$"),
    overlays: bool = Query(True),
):
    """
    Generate before/after comparison video(s).

    Query params:
    - output: "merged" (single file, default) or "separate" (zip with before.mp4 + after.mp4)
    - overlays: true (default) adds "Before"/"After" text, false omits them

    merged: returns a single MP4 with before clips then after clip concatenated.
    separate: returns a zip containing before.mp4 (all before clips concatenated)
              and after.mp4 (the final video processed to match).
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT filename FROM final_videos WHERE id = ?
        """, (final_video_id,))
        final_video = cursor.fetchone()

        if not final_video:
            raise HTTPException(status_code=404, detail="Final video not found")

        final_path = get_final_videos_path() / final_video['filename']
        if not final_path.exists():
            raise HTTPException(status_code=404, detail="Final video file not found")

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

    temp_dir = tempfile.mkdtemp(prefix='before_after_')
    before_clip_paths = []

    try:
        logger.info(f"[Before/After] Generating comparison for final_video {final_video_id} (output={output}, overlays={overlays})")

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
                output_path=before_path,
                overlays=overlays,
            )

            if success and os.path.exists(before_path):
                before_clip_paths.append(before_path)
                logger.info(f"[Before/After] Generated before clip {i}")

        if not before_clip_paths:
            raise HTTPException(
                status_code=500,
                detail="Failed to generate any before clips"
            )

        after_path = os.path.join(temp_dir, "after_raw.mp4")
        success = generate_after_clip(
            final_video_path=str(final_path),
            output_path=after_path,
            overlays=overlays,
        )

        if not success or not os.path.exists(after_path):
            raise HTTPException(
                status_code=500,
                detail="Failed to generate after clip"
            )

        if output == "separate":
            # Concatenate all before clips into one before.mp4
            if len(before_clip_paths) == 1:
                before_final = before_clip_paths[0]
            else:
                before_final = os.path.join(temp_dir, "before.mp4")
                success = concatenate_clips(before_clip_paths, before_final)
                if not success or not os.path.exists(before_final):
                    raise HTTPException(status_code=500, detail="Failed to concatenate before clips")

            after_final = after_path

            zip_path = os.path.join(temp_dir, "before_after.zip")
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as zf:
                zf.write(before_final, "before.mp4")
                zf.write(after_final, "after.mp4")

            logger.info(f"[Before/After] Generated separate zip: {os.path.getsize(zip_path)} bytes")

            return FileResponse(
                path=zip_path,
                media_type="application/zip",
                filename=f"before_after_{final_video_id}.zip",
            )

        # merged output (default): concatenate all clips into one video
        all_clip_paths = before_clip_paths + [after_path]
        output_path = os.path.join(temp_dir, "comparison.mp4")
        logger.info(f"[Before/After] Concatenating {len(all_clip_paths)} clips...")
        success = concatenate_clips(all_clip_paths, output_path)

        if not success or not os.path.exists(output_path):
            raise HTTPException(
                status_code=500,
                detail="Failed to concatenate clips"
            )

        logger.info(f"[Before/After] Generated merged comparison: {os.path.getsize(output_path)} bytes")

        return FileResponse(
            path=output_path,
            media_type="video/mp4",
            filename=f"before_after_{final_video_id}.mp4",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Before/After] Error generating comparison: {e}")
        raise HTTPException(status_code=500, detail=str(e))
