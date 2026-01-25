"""
Export Worker - Background task processing for durable exports.

This module processes export jobs asynchronously, allowing exports to
continue even if the browser is closed. Progress updates are sent via
WebSocket (if connected) but the job completes regardless.

Key design:
- Job state stored in database (durable)
- Progress sent via WebSocket (ephemeral, fire-and-forget)
- Only 2 DB writes per job: started + completed/error
"""

import asyncio
import json
import logging
import os
import tempfile
import shutil
from pathlib import Path
from typing import Optional, Callable

from ..database import get_db_connection, get_working_videos_path
from ..websocket import manager, export_progress
from .ffmpeg_service import get_video_duration
from ..routers.exports import (
    get_export_job,
    update_job_started,
    update_job_complete,
    update_job_error
)
from .ffmpeg_service import get_encoding_command_parts
from .modal_client import modal_enabled, call_modal_framing, call_modal_overlay

logger = logging.getLogger(__name__)

# AI upscaler - imported on demand
AIVideoUpscaler = None


def get_upscaler():
    """Lazy-load the AI upscaler to avoid import issues at module load time."""
    global AIVideoUpscaler
    if AIVideoUpscaler is None:
        try:
            from ..ai_upscaler import AIVideoUpscaler as _AIVideoUpscaler
            AIVideoUpscaler = _AIVideoUpscaler
        except (ImportError, OSError, AttributeError) as e:
            logger.warning(f"AI upscaler dependencies not available: {e}")
            return None
    return AIVideoUpscaler


async def send_progress(export_id: str, progress: int, message: str, status: str = "processing"):
    """
    Send progress update via WebSocket (fire-and-forget).

    If no clients are connected, this silently does nothing.
    The export continues regardless.
    """
    progress_data = {
        "progress": progress,
        "message": message,
        "status": status
    }
    # Update in-memory progress (for any immediate queries)
    export_progress[export_id] = progress_data

    # Send via WebSocket (fire-and-forget)
    try:
        await manager.send_progress(export_id, progress_data)
    except Exception as e:
        # Silently ignore - export continues
        logger.debug(f"[ExportWorker] WebSocket send failed (continuing): {e}")


def create_progress_callback(export_id: str, loop: asyncio.AbstractEventLoop, progress_ranges: dict):
    """
    Create a progress callback function for the AI upscaler.

    The callback sends progress via WebSocket but doesn't block or fail
    if no clients are connected.
    """
    last_logged_percent = [0]  # Use list to allow mutation in closure

    def progress_callback(current: int, total: int, message: str, phase: str = 'ai_upscale'):
        if phase not in progress_ranges:
            phase = 'ai_upscale'

        start_percent, end_percent = progress_ranges[phase]
        phase_progress = (current / total) if total > 0 else 0
        overall_percent = start_percent + (phase_progress * (end_percent - start_percent))
        percent_int = int(overall_percent)

        # Log progress every 10% to help debug E2E tests
        if percent_int >= last_logged_percent[0] + 10:
            logger.info(f"[ExportWorker] Progress callback: {percent_int}% - {message} (phase={phase})")
            last_logged_percent[0] = percent_int

        # Fire-and-forget WebSocket update
        try:
            asyncio.run_coroutine_threadsafe(
                send_progress(export_id, percent_int, message),
                loop
            )
        except Exception as e:
            logger.warning(f"[ExportWorker] Failed to send progress: {e}")

    return progress_callback


async def process_export_job(job_id: str):
    """
    Process an export job in the background.

    This is the main entry point called by FastAPI's BackgroundTasks.
    It handles the full lifecycle:
    1. Mark job as started (DB write #1)
    2. Process the export
    3. Mark job as complete or error (DB write #2)
    """
    logger.info(f"[ExportWorker] Starting job: {job_id}")

    # Get job from database
    job = get_export_job(job_id)
    if not job:
        logger.error(f"[ExportWorker] Job not found: {job_id}")
        return

    # Check if already processed
    if job['status'] != 'pending':
        logger.warning(f"[ExportWorker] Job {job_id} already has status: {job['status']}")
        return

    # Mark as started (DB write #1)
    update_job_started(job_id)
    await send_progress(job_id, 5, "Export started...")

    try:
        # Parse config
        config = json.loads(job['input_data'])
        job_type = job['type']
        project_id = job['project_id']

        # Route to appropriate handler
        if job_type == 'framing':
            output_video_id, output_filename = await process_framing_export(job_id, project_id, config)
        elif job_type == 'overlay':
            output_video_id, output_filename = await process_overlay_export(job_id, project_id, config)
        elif job_type == 'multi_clip':
            output_video_id, output_filename = await process_multi_clip_export(job_id, project_id, config)
        else:
            raise ValueError(f"Unknown export type: {job_type}")

        # Mark as complete (DB write #2)
        update_job_complete(job_id, output_video_id, output_filename)
        await send_progress(job_id, 100, "Export complete!", "complete")

        logger.info(f"[ExportWorker] Job {job_id} completed successfully")

    except Exception as e:
        logger.error(f"[ExportWorker] Job {job_id} failed: {e}", exc_info=True)
        update_job_error(job_id, str(e))
        await send_progress(job_id, 0, f"Export failed: {e}", "error")


async def process_framing_export(job_id: str, project_id: int, config: dict) -> tuple:
    """
    Process a framing mode export.

    Returns (output_video_id, output_filename)
    """
    loop = asyncio.get_running_loop()

    # Extract config
    video_path = config.get('video_path')
    keyframes = config.get('keyframes', [])
    target_fps = config.get('target_fps', 30)
    export_mode = config.get('export_mode', 'quality')
    segment_data = config.get('segment_data')
    include_audio = config.get('include_audio', True)

    if not video_path or not os.path.exists(video_path):
        raise ValueError(f"Video file not found: {video_path}")

    if not keyframes:
        raise ValueError("No keyframes provided")

    # Get AI upscaler
    UpscalerClass = get_upscaler()
    if UpscalerClass is None:
        raise RuntimeError("AI upscaler not available")

    # Create temp output path
    working_videos_dir = get_working_videos_path()
    working_videos_dir.mkdir(parents=True, exist_ok=True)

    # Get next version number
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COALESCE(MAX(version), 0) + 1 as next_version
            FROM working_videos WHERE project_id = ?
        """, (project_id,))
        next_version = cursor.fetchone()['next_version']

    output_filename = f"project_{project_id}_v{next_version}.mp4"
    output_path = str(working_videos_dir / output_filename)

    # Progress ranges
    if export_mode == "FAST":
        progress_ranges = {
            'ai_upscale': (10, 95),
            'ffmpeg_encode': (95, 100)
        }
    else:
        progress_ranges = {
            'ai_upscale': (10, 28),
            'ffmpeg_pass1': (28, 81),
            'ffmpeg_encode': (81, 100)
        }

    progress_callback = create_progress_callback(job_id, loop, progress_ranges)

    await send_progress(job_id, 10, "Initializing AI upscaler...")

    # Initialize upscaler
    upscaler = UpscalerClass(
        device='cuda',
        export_mode=export_mode,
        sr_model_name='realesr_general_x4v3'
    )

    if upscaler.upsampler is None:
        raise RuntimeError("AI SR model failed to load")

    # Run upscaling in thread pool (CPU-bound work)
    result = await asyncio.to_thread(
        upscaler.process_video_with_upscale,
        input_path=video_path,
        output_path=output_path,
        keyframes=keyframes,
        target_fps=target_fps,
        export_mode=export_mode,
        progress_callback=progress_callback,
        segment_data=segment_data,
        include_audio=include_audio,
    )

    # Get video duration for cost-optimized GPU selection in overlay mode
    video_duration = get_video_duration(output_path)
    logger.info(f"[ExportWorker] Working video duration: {video_duration:.2f}s")

    # Save to database
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO working_videos (project_id, filename, version, duration)
            VALUES (?, ?, ?, ?)
        """, (project_id, output_filename, next_version, video_duration))
        working_video_id = cursor.lastrowid

        # Update project to point to new working video
        cursor.execute("""
            UPDATE projects
            SET working_video_id = ?, final_video_id = NULL
            WHERE id = ?
        """, (working_video_id, project_id))

        conn.commit()

    logger.info(f"[ExportWorker] Framing export complete: {output_filename} (id: {working_video_id})")

    return working_video_id, output_filename


async def process_overlay_export(job_id: str, project_id: int, config: dict) -> tuple:
    """
    Process an overlay mode export.

    Returns (output_video_id, output_filename)
    """
    import cv2
    from ..database import get_final_videos_path

    loop = asyncio.get_running_loop()

    # Extract config
    video_path = config.get('video_path')
    highlight_regions = config.get('highlight_regions', [])
    highlight_effect_type = config.get('highlight_effect_type', 'original')

    if not video_path or not os.path.exists(video_path):
        raise ValueError(f"Video file not found: {video_path}")

    # Get output directory
    final_videos_dir = get_final_videos_path()
    final_videos_dir.mkdir(parents=True, exist_ok=True)

    # Get next version number
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT COALESCE(MAX(version), 0) + 1 as next_version
            FROM final_videos WHERE project_id = ?
        """, (project_id,))
        next_version = cursor.fetchone()['next_version']

    output_filename = f"final_{project_id}_v{next_version}.mp4"
    output_path = str(final_videos_dir / output_filename)

    await send_progress(job_id, 10, "Starting overlay rendering...")

    # Import overlay processing code
    try:
        from ..ai_upscaler.keyframe_interpolator import KeyframeInterpolator
    except ImportError as e:
        raise RuntimeError(f"Failed to import overlay dependencies: {e}")

    # Open video
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Failed to open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Create output video writer
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path + '.temp.mp4', fourcc, fps, (width, height))

    try:
        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            time = frame_idx / fps

            # Apply highlight overlay if regions exist
            if highlight_regions:
                # Convert regions to keyframes format for interpolation
                highlight = KeyframeInterpolator.interpolate_highlight_from_regions(
                    highlight_regions, time
                ) if hasattr(KeyframeInterpolator, 'interpolate_highlight_from_regions') else None

                if highlight:
                    frame = KeyframeInterpolator.render_highlight_on_frame(
                        frame, highlight, (width, height), None, highlight_effect_type
                    )

            out.write(frame)
            frame_idx += 1

            # Progress update (every 30 frames)
            if frame_idx % 30 == 0:
                progress = 10 + int((frame_idx / frame_count) * 60)
                await send_progress(job_id, progress, f"Rendering frame {frame_idx}/{frame_count}")

    finally:
        cap.release()
        out.release()

    await send_progress(job_id, 75, "Encoding with audio...")

    # Re-encode with ffmpeg to add audio and proper encoding (GPU accelerated if available)
    import subprocess

    # Get GPU-accelerated encoding parameters
    encoding_params = get_encoding_command_parts(prefer_quality=True)

    ffmpeg_cmd = [
        'ffmpeg', '-y',
        '-i', output_path + '.temp.mp4',
        '-i', video_path,
        '-map', '0:v',
        '-map', '1:a?',
    ]
    ffmpeg_cmd.extend(encoding_params)
    ffmpeg_cmd.extend([
        '-c:a', 'aac',
        '-b:a', '256k',
        '-movflags', '+faststart',
        output_path
    ])

    logger.info(f"[ExportWorker] FFmpeg overlay encode: {' '.join(ffmpeg_cmd[:12])}...")
    result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg encoding failed: {result.stderr}")

    # Clean up temp file
    try:
        os.remove(output_path + '.temp.mp4')
    except:
        pass

    await send_progress(job_id, 95, "Saving to database...")

    # Save to database
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Determine source_type: check if this is an auto-created project for a 5-star clip
        cursor.execute("""
            SELECT id FROM raw_clips WHERE auto_project_id = ?
        """, (project_id,))
        is_auto_project = cursor.fetchone() is not None
        source_type = 'brilliant_clip' if is_auto_project else 'custom_project'

        cursor.execute("""
            INSERT INTO final_videos (project_id, filename, version, source_type)
            VALUES (?, ?, ?, ?)
        """, (project_id, output_filename, next_version, source_type))
        final_video_id = cursor.lastrowid

        # Update project to point to new final video
        cursor.execute("""
            UPDATE projects SET final_video_id = ? WHERE id = ?
        """, (final_video_id, project_id))

        conn.commit()

    logger.info(f"[ExportWorker] Overlay export complete: {output_filename} (id: {final_video_id}, source_type: {source_type})")

    return final_video_id, output_filename


async def process_multi_clip_export(job_id: str, project_id: int, config: dict) -> tuple:
    """
    Process a multi-clip export.

    Returns (output_video_id, output_filename)
    """
    # TODO: Implement multi-clip export
    raise NotImplementedError("Multi-clip export not yet implemented in worker")


# =============================================================================
# Modal GPU Processing Functions
# =============================================================================


async def process_overlay_with_modal(
    job_id: str,
    project_id: int,
    user_id: str,
    input_r2_key: str,
    output_r2_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
) -> dict:
    """
    Process overlay export using Modal GPU.

    This function calls Modal's remote GPU infrastructure to process the video.
    The video must already be in R2 storage.

    Args:
        job_id: Export job ID for tracking
        project_id: Project ID
        user_id: User folder in R2 (e.g., "a")
        input_r2_key: R2 key for input video (relative to user folder)
        output_r2_key: R2 key for output video (relative to user folder)
        highlight_regions: Highlight regions with keyframes
        effect_type: Effect type for highlights

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    if not modal_enabled():
        raise RuntimeError("Modal is not enabled")

    logger.info(f"[ExportWorker] Using Modal GPU for overlay export: {job_id}")
    await send_progress(job_id, 10, "Sending to GPU cluster...")

    result = await call_modal_overlay(
        job_id=job_id,
        user_id=user_id,
        input_key=input_r2_key,
        output_key=output_r2_key,
        highlight_regions=highlight_regions,
        effect_type=effect_type,
    )

    if result.get("status") == "success":
        await send_progress(job_id, 95, "GPU processing complete")
    else:
        error = result.get("error", "Unknown error")
        logger.error(f"[ExportWorker] Modal overlay failed: {error}")
        raise RuntimeError(f"Modal processing failed: {error}")

    return result


async def process_framing_with_modal(
    job_id: str,
    project_id: int,
    user_id: str,
    input_r2_key: str,
    output_r2_key: str,
    keyframes: list,
    output_width: int = 1080,
    output_height: int = 1920,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """
    Process framing export using Modal GPU.

    Note: This uses FFmpeg-only processing on Modal. For AI upscaling,
    use the local processing with CUDA.

    Args:
        job_id: Export job ID for tracking
        project_id: Project ID
        user_id: User folder in R2
        input_r2_key: R2 key for source video
        output_r2_key: R2 key for output video
        keyframes: Crop keyframes
        output_width: Target width
        output_height: Target height
        fps: Target frame rate
        segment_data: Trim/speed data

    Returns:
        Result dict from Modal
    """
    if not modal_enabled():
        raise RuntimeError("Modal is not enabled")

    logger.info(f"[ExportWorker] Using Modal GPU for framing export: {job_id}")
    await send_progress(job_id, 10, "Sending to GPU cluster...")

    result = await call_modal_framing(
        job_id=job_id,
        user_id=user_id,
        input_key=input_r2_key,
        output_key=output_r2_key,
        keyframes=keyframes,
        output_width=output_width,
        output_height=output_height,
        fps=fps,
        segment_data=segment_data,
    )

    if result.get("status") == "success":
        await send_progress(job_id, 95, "GPU processing complete")
    else:
        error = result.get("error", "Unknown error")
        logger.error(f"[ExportWorker] Modal framing failed: {error}")
        raise RuntimeError(f"Modal processing failed: {error}")

    return result


def is_modal_available() -> bool:
    """Check if Modal is available and enabled."""
    return modal_enabled()


async def recover_orphaned_jobs():
    """
    Recover jobs that were processing when the server stopped.

    Called on server startup to clean up any orphaned jobs.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id FROM export_jobs WHERE status = 'processing'
        """)
        orphaned = cursor.fetchall()

    for row in orphaned:
        job_id = row['id']
        logger.warning(f"[ExportWorker] Found orphaned job: {job_id}, marking as error")
        update_job_error(job_id, "Server restarted during processing")
