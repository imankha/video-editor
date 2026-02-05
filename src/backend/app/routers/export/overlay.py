"""
Overlay mode export endpoints.

This module handles exports related to the Overlay editing mode:
- /overlay - Apply highlight overlays to video
- /final - Save final video to project
- /projects/{id}/final-video - Stream final video
- /projects/{id}/overlay-data - Save/get overlay editing state

These endpoints handle highlight regions, effect types, and final output.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask
from datetime import datetime
from pathlib import Path
from typing import Dict, Any
import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import os
import re
import tempfile
import uuid
import subprocess
import logging

# Thread pool for CPU-intensive frame processing (prevents blocking event loop)
_frame_processor_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="overlay_")

from ...websocket import export_progress, manager
from ...database import get_db_connection, get_final_videos_path, get_highlights_path, get_raw_clips_path, get_uploads_path
from ...services.ffmpeg_service import get_encoding_command_parts
from ...storage import generate_presigned_url, upload_to_r2, upload_bytes_to_r2, download_from_r2
from ...user_context import get_current_user_id
from ...highlight_transform import (
    transform_all_regions_to_raw,
    transform_all_regions_to_working,
)
from ...services.image_extractor import (
    extract_player_images_for_region,
    list_highlight_images,
)
from ...services.modal_client import modal_enabled, call_modal_overlay, call_modal_overlay_auto
from ...constants import ExportStatus

logger = logging.getLogger(__name__)

router = APIRouter()


def _process_frames_to_ffmpeg(
    input_path: str,
    output_path: str,
    highlight_regions: list,
    highlight_effect_type: str,
    progress_callback
) -> int:
    """
    Process video frames with highlight overlays, piping directly to FFmpeg.

    This avoids writing individual frame files to disk - frames are piped
    directly to FFmpeg's stdin for encoding, which is much faster.

    Returns the total number of frames processed.
    """
    import cv2
    from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise ValueError("Could not open video file")

    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    logger.info(f"[Overlay Export] Video: {width}x{height} @ {fps}fps, {frame_count} frames")
    logger.info(f"[Overlay Export] Piping frames directly to FFmpeg (no disk I/O)")

    # Get GPU encoding params
    encoding_params = get_encoding_command_parts(prefer_quality=True)

    # Start FFmpeg process with stdin pipe for raw frames
    # We'll pipe raw BGR frames and let FFmpeg encode them
    ffmpeg_cmd = [
        'ffmpeg', '-y',
        # Input: raw video frames from pipe
        '-f', 'rawvideo',
        '-pix_fmt', 'bgr24',
        '-s', f'{width}x{height}',
        '-r', str(fps),
        '-i', 'pipe:0',
        # Audio from original file
        '-i', input_path,
        '-map', '0:v',
        '-map', '1:a?',
    ]
    ffmpeg_cmd.extend(encoding_params)
    ffmpeg_cmd.extend([
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        output_path
    ])

    logger.info(f"[Overlay Export] FFmpeg command: {' '.join(ffmpeg_cmd[:10])}...")

    # Start FFmpeg process
    ffmpeg_proc = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Sort regions by start time for efficient lookup
    sorted_regions = sorted(highlight_regions, key=lambda r: r['start_time'])

    frame_idx = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current_time = frame_idx / fps

            # Find active region for this frame
            active_region = None
            for region in sorted_regions:
                if region['start_time'] <= current_time <= region['end_time']:
                    active_region = region
                    break

            # Render highlight if in a region
            if active_region:
                highlight = KeyframeInterpolator.interpolate_highlight(active_region['keyframes'], current_time)
                if highlight is not None:
                    # Check if keyframe coordinates need to be scaled from detection space to working video space
                    # Detection may have run on source video (e.g., 2560x1440) but rendering is on working video (e.g., 1080x1920)
                    detection_width = active_region.get('videoWidth')
                    detection_height = active_region.get('videoHeight')

                    if detection_width and detection_height and (detection_width != width or detection_height != height):
                        # Scale coordinates from detection space to working video space
                        scale_x = width / detection_width
                        scale_y = height / detection_height
                        highlight = {
                            **highlight,
                            'x': highlight['x'] * scale_x,
                            'y': highlight['y'] * scale_y,
                            'radiusX': highlight['radiusX'] * scale_x,
                            'radiusY': highlight['radiusY'] * scale_y,
                        }

                    frame = KeyframeInterpolator.render_highlight_on_frame(
                        frame,
                        highlight,
                        (width, height),
                        crop=None,
                        effect_type=highlight_effect_type
                    )

            # Write frame directly to FFmpeg's stdin (no disk I/O!)
            ffmpeg_proc.stdin.write(frame.tobytes())
            frame_idx += 1

            # Report progress every 30 frames
            if frame_idx % 30 == 0:
                progress = 10 + int((frame_idx / frame_count) * 80)
                progress_callback(progress, f"Processing frames... {frame_idx}/{frame_count}")

    finally:
        cap.release()
        # Close stdin to signal EOF to FFmpeg
        if ffmpeg_proc.stdin:
            ffmpeg_proc.stdin.close()

    # Wait for FFmpeg to finish
    stdout, stderr = ffmpeg_proc.communicate()

    if ffmpeg_proc.returncode != 0:
        logger.error(f"[Overlay Export] FFmpeg error: {stderr.decode()}")
        raise RuntimeError(f"FFmpeg encoding failed: {stderr.decode()[:500]}")

    logger.info(f"[Overlay Export] Processed {frame_idx} frames via pipe")
    return frame_idx


@router.post("/overlay")
async def export_overlay_only(
    video: UploadFile = File(...),
    export_id: str = Form(...),
    project_id: int = Form(None),  # Optional: for export_jobs tracking
    highlight_regions_json: str = Form(None),
    highlight_keyframes_json: str = Form(None),  # Legacy format (deprecated)
    highlight_effect_type: str = Form("original"),
):
    """
    Export video with highlight overlays ONLY - no cropping, no AI upscaling.

    This is a fast export for Overlay mode where the video has already been
    cropped/trimmed during Framing export.

    Audio from input video is always preserved.

    Highlight format (new region-based):
    [
        {
            "id": "region-123",
            "start_time": 0,
            "end_time": 3,
            "keyframes": [
                {"time": 0, "x": 100, "y": 200, "radiusX": 50, "radiusY": 80, "opacity": 0.15, "color": "#FFFF00"},
                ...
            ]
        },
        ...
    ]
    """
    import cv2
    from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator

    # Fetch project name for progress messages
    project_name = None
    if project_id:
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT name FROM projects WHERE id = ?", (project_id,))
                row = cursor.fetchone()
                if row:
                    project_name = row['name']
        except Exception as e:
            logger.warning(f"[Overlay Export] Failed to fetch project name: {e}")

    # Create export_jobs record for tracking (if project_id provided)
    if project_id:
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO export_jobs (id, project_id, type, status, input_data)
                    VALUES (?, ?, 'overlay', 'processing', '{}')
                """, (export_id, project_id))
                conn.commit()
            logger.info(f"[Overlay Export] Created export_jobs record: {export_id} for project '{project_name}'")
        except Exception as e:
            logger.warning(f"[Overlay Export] Failed to create export_jobs record: {e}")

    # Initialize progress
    export_progress[export_id] = {
        "progress": 5,
        "message": "Starting overlay export...",
        "status": "processing",
        "projectId": project_id,
        "projectName": project_name,
        "type": "overlay"
    }

    logger.info(f"[Overlay Export] Effect type: {highlight_effect_type}")

    # Parse highlight regions (new format) or keyframes (legacy format)
    highlight_regions = []

    if highlight_regions_json:
        # New region-based format
        try:
            regions_data = json.loads(highlight_regions_json)
            for region in regions_data:
                highlight_regions.append({
                    'id': region.get('id', ''),
                    'start_time': region['start_time'],
                    'end_time': region['end_time'],
                    'keyframes': [
                        {
                            'time': kf['time'],
                            'x': kf['x'],
                            'y': kf['y'],
                            'radiusX': kf['radiusX'],
                            'radiusY': kf['radiusY'],
                            'opacity': kf['opacity'],
                            'color': kf['color']
                        }
                        for kf in region.get('keyframes', [])
                    ]
                })
            logger.info(f"[Overlay Export] Received {len(highlight_regions)} highlight regions:")
            for region in highlight_regions:
                logger.info(f"  Region {region['id']}: {region['start_time']:.2f}s - {region['end_time']:.2f}s, {len(region['keyframes'])} keyframes")
        except (json.JSONDecodeError, KeyError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight regions JSON: {str(e)}")
    elif highlight_keyframes_json:
        # Legacy flat keyframe format - convert to single region
        try:
            highlight_data = json.loads(highlight_keyframes_json)
            keyframes = [
                {
                    'time': kf['time'],
                    'x': kf['x'],
                    'y': kf['y'],
                    'radiusX': kf['radiusX'],
                    'radiusY': kf['radiusY'],
                    'opacity': kf['opacity'],
                    'color': kf['color']
                }
                for kf in highlight_data
            ]
            if keyframes:
                highlight_regions.append({
                    'id': 'legacy',
                    'start_time': keyframes[0]['time'],
                    'end_time': keyframes[-1]['time'],
                    'keyframes': keyframes
                })
            logger.info(f"[Overlay Export] Legacy format: {len(keyframes)} keyframes converted to 1 region")
        except (json.JSONDecodeError, KeyError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight keyframes JSON: {str(e)}")

    # Create temp directory (no frames_dir needed - we pipe directly to FFmpeg)
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"overlay_{uuid.uuid4().hex}.mp4")

    try:
        # Save uploaded file
        with open(input_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        # Update progress
        progress_data = {"progress": 10, "message": "Processing video...", "status": "processing", "projectId": project_id, "projectName": project_name, "type": "overlay"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        # Fast path: no highlights - just copy the video
        if not highlight_regions:
            logger.info("[Overlay Export] No highlights - copying video directly")
            import shutil
            shutil.copy(input_path, output_path)

            progress_data = {"progress": 100, "message": "Export complete!", "status": ExportStatus.COMPLETE, "projectId": project_id, "projectName": project_name, "type": "overlay"}
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            return FileResponse(
                output_path,
                media_type='video/mp4',
                filename=f"overlayed_{video.filename}",
                background=None
            )

        # Progress updates from thread
        progress_queue = asyncio.Queue()

        def on_progress(progress: int, message: str):
            # Can't await from thread, so just update the dict
            export_progress[export_id] = {
                "progress": progress,
                "message": message,
                "status": "processing",
                "projectId": project_id,
                "projectName": project_name,
                "type": "overlay"
            }
            # Queue progress for async sending
            try:
                progress_queue.put_nowait((progress, message))
            except asyncio.QueueFull:
                pass  # Skip if queue is full

        # Run frame processing in thread pool to avoid blocking event loop
        # Frames are piped directly to FFmpeg - no disk I/O for individual frames!
        loop = asyncio.get_event_loop()
        logger.info(f"[Overlay Export] Processing frames with direct FFmpeg pipe...")

        # Start a task to send progress updates
        async def send_progress_updates():
            while True:
                try:
                    progress, message = await asyncio.wait_for(progress_queue.get(), timeout=0.5)
                    await manager.send_progress(export_id, {
                        "progress": progress,
                        "message": message,
                        "status": "processing",
                        "projectId": project_id,
                        "projectName": project_name,
                        "type": "overlay"
                    })
                except asyncio.TimeoutError:
                    continue
                except asyncio.CancelledError:
                    break

        progress_task = asyncio.create_task(send_progress_updates())

        try:
            frame_idx = await loop.run_in_executor(
                _frame_processor_pool,
                _process_frames_to_ffmpeg,
                input_path,
                output_path,
                highlight_regions,
                highlight_effect_type,
                on_progress
            )
        finally:
            progress_task.cancel()
            try:
                await progress_task
            except asyncio.CancelledError:
                pass

        logger.info(f"[Overlay Export] Completed processing {frame_idx} frames")

        # Update export_jobs record to complete
        if project_id:
            try:
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE export_jobs SET status = 'complete', completed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (export_id,))
                    conn.commit()
            except Exception as e:
                logger.warning(f"[Overlay Export] Failed to update export_jobs record: {e}")

        # Complete
        progress_data = {"progress": 100, "message": "Export complete!", "status": ExportStatus.COMPLETE, "projectId": project_id, "projectName": project_name, "type": "overlay"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        def cleanup_temp_dir():
            import shutil
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)

        return FileResponse(
            output_path,
            media_type='video/mp4',
            filename=f"overlayed_{video.filename}",
            background=BackgroundTask(cleanup_temp_dir)
        )

    except HTTPException as e:
        # Extract error message from HTTPException
        error_msg = str(e.detail) if hasattr(e, 'detail') else str(e)
        logger.error(f"[Overlay Export] HTTPException: {error_msg}")

        # Update export_jobs record to error
        if project_id:
            try:
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE export_jobs SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (error_msg[:500], export_id))
                    conn.commit()
            except Exception:
                pass

        # Send error progress via WebSocket
        error_data = {"progress": 0, "message": f"Export failed: {error_msg}", "status": "error", "projectId": project_id, "projectName": project_name, "type": "overlay"}
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        import shutil
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Overlay Export] Cleanup failed: {cleanup_error}")
        raise
    except Exception as e:
        logger.error(f"[Overlay Export] Failed: {str(e)}", exc_info=True)
        # Update export_jobs record to error
        if project_id:
            try:
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE export_jobs SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (str(e)[:500], export_id))
                    conn.commit()
            except Exception:
                pass
        error_data = {"progress": 0, "message": f"Export failed: {str(e)}", "status": "error", "projectId": project_id, "projectName": project_name, "type": "overlay"}
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)
        import shutil
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Overlay Export] Cleanup failed: {cleanup_error}")
        raise HTTPException(status_code=500, detail=f"Overlay export failed: {str(e)}")


@router.post("/final")
async def export_final(
    project_id: int = Form(...),
    video: UploadFile = File(...),
    overlay_data: str = Form("{}")
):
    """
    Export final video with overlays for a project.

    This endpoint:
    1. Receives the rendered video with overlays from the frontend
    2. Saves it to final_videos folder
    3. Creates final_videos DB entry with next version number
    4. Updates project.final_video_id to point to latest version

    Request:
    - project_id: The project ID
    - video: The rendered video file with overlays
    - overlay_data: JSON with overlay configurations (for metadata)

    Response:
    - success: boolean
    - final_video_id: The new final video ID
    - filename: The saved filename
    """
    logger.info(f"[Final Export] Starting for project {project_id}")

    try:
        overlay_config = json.loads(overlay_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid overlay_data JSON")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists and has a working video
        cursor.execute("""
            SELECT id, name, working_video_id, final_video_id
            FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if not project['working_video_id']:
            raise HTTPException(
                status_code=400,
                detail="Project must have a working video before final export"
            )

        # Generate unique filename using project name + UUID (no local storage)
        project_name = project['name'] or f"project_{project_id}"
        safe_name = re.sub(r'[^\w\s-]', '', project_name).strip()
        safe_name = re.sub(r'[\s]+', '_', safe_name)
        if not safe_name:
            safe_name = f"project_{project_id}"

        # Use UUID suffix to ensure uniqueness in R2
        filename = f"{safe_name}_final_{uuid.uuid4().hex[:8]}.mp4"
        user_id = get_current_user_id()

        # Upload directly from memory to R2 (no temp file)
        content = await video.read()
        if not upload_bytes_to_r2(user_id, f"final_videos/{filename}", content):
            raise HTTPException(status_code=500, detail="Failed to upload final video to R2")
        logger.info(f"[Final Export] Uploaded final video to R2: {filename} ({len(content)} bytes)")

        # Get next version number for final video
        cursor.execute("""
            SELECT COALESCE(MAX(version), 0) + 1 as next_version
            FROM final_videos
            WHERE project_id = ?
        """, (project_id,))
        next_version = cursor.fetchone()['next_version']
        logger.info(f"[Final Export] Creating final video version {next_version} for project {project_id}")

        # Determine source_type: check if this is an auto-created project for a 5-star clip
        cursor.execute("""
            SELECT id FROM raw_clips WHERE auto_project_id = ?
        """, (project_id,))
        is_auto_project = cursor.fetchone() is not None
        source_type = 'brilliant_clip' if is_auto_project else 'custom_project'

        # Create new final video entry with version number and source_type
        cursor.execute("""
            INSERT INTO final_videos (project_id, filename, version, source_type)
            VALUES (?, ?, ?, ?)
        """, (project_id, filename, next_version, source_type))
        final_video_id = cursor.lastrowid
        logger.info(f"[Final Export] Created final video id={final_video_id} with source_type={source_type}")

        # Update project with new final video ID
        cursor.execute("""
            UPDATE projects SET final_video_id = ? WHERE id = ?
        """, (final_video_id, project_id))

        # Track source clips for before/after comparison
        cursor.execute("""
            SELECT wc.id, wc.raw_clip_id, wc.uploaded_filename, wc.segments_data, wc.sort_order,
                   rc.filename as raw_filename
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.project_id = ?
            ORDER BY wc.sort_order
        """, (project_id,))
        working_clips = cursor.fetchall()

        for idx, wc in enumerate(working_clips):
            # Determine source path
            if wc['raw_clip_id'] and wc['raw_filename']:
                source_path = str(get_raw_clips_path() / wc['raw_filename'])
            elif wc['uploaded_filename']:
                source_path = str(get_uploads_path() / wc['uploaded_filename'])
            else:
                continue  # Skip if no source

            # Get frame range from segments_data
            start_frame = 0
            end_frame = 0
            framerate = 30.0

            if wc['segments_data']:
                try:
                    segments = json.loads(wc['segments_data'])
                    trim_range = segments.get('trimRange')
                    if trim_range:
                        start_frame = int(trim_range.get('start', 0) * framerate)
                        end_frame = int(trim_range.get('end', 0) * framerate)
                    elif segments.get('boundaries'):
                        # No trim, use full clip from boundaries
                        boundaries = segments['boundaries']
                        if len(boundaries) >= 2:
                            end_frame = int(boundaries[-1] * framerate)
                except json.JSONDecodeError:
                    pass

            # Insert tracking record
            cursor.execute("""
                INSERT INTO before_after_tracks
                (final_video_id, raw_clip_id, source_path, start_frame, end_frame, clip_index)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (final_video_id, wc['raw_clip_id'], source_path, start_frame, end_frame, idx))

        logger.info(f"[Final Export] Tracked {len(working_clips)} source clips for before/after")

        conn.commit()

        logger.info(f"[Final Export] Created final video {final_video_id} for project {project_id}")

        return JSONResponse({
            'success': True,
            'final_video_id': final_video_id,
            'filename': filename,
            'project_id': project_id
        })


@router.get("/projects/{project_id}/final-video")
async def get_final_video(project_id: int):
    """Stream the final video for a project."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get latest final video for this project
        cursor.execute("""
            SELECT filename
            FROM final_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))
        result = cursor.fetchone()

        if not result:
            raise HTTPException(status_code=404, detail="Final video not found")

        # Redirect to R2 presigned URL
        user_id = get_current_user_id()
        presigned_url = generate_presigned_url(
            user_id=user_id,
            relative_path=f"final_videos/{result['filename']}",
            expires_in=3600,
            content_type="video/mp4"
        )
        if presigned_url:
            return RedirectResponse(url=presigned_url, status_code=302)
        raise HTTPException(status_code=404, detail="Failed to generate R2 URL for final video")


@router.put("/projects/{project_id}/overlay-data")
async def save_overlay_data(
    project_id: int,
    highlights_data: str = Form("[]"),
    text_overlays: str = Form("[]"),
    effect_type: str = Form("original")
):
    """
    Save overlay editing state for a project.

    Called by frontend auto-save when user modifies highlights in Overlay mode.
    Saves to working_videos table for the project's current working video.

    Also transforms and saves highlight data to source raw_clips for cross-project
    reuse. The transformation converts from working video space to raw clip space,
    accounting for crop, trim, and speed changes.

    Request (form data):
    - highlights_data: JSON string of highlight regions
    - text_overlays: JSON string of text overlay configs
    - effect_type: 'original' | 'brightness_boost' | 'dark_overlay'

    Response:
    - success: boolean
    - saved_at: timestamp
    - raw_clips_updated: number of raw clips updated with defaults
    """
    logger.info(f"[Overlay Data] Saving for project {project_id}")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get project's current working video
        cursor.execute("""
            SELECT working_video_id FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if not project['working_video_id']:
            raise HTTPException(
                status_code=400,
                detail="Project has no working video - complete framing first"
            )

        # Update working video with overlay data
        cursor.execute("""
            UPDATE working_videos
            SET highlights_data = ?,
                text_overlays = ?,
                effect_type = ?
            WHERE id = ?
        """, (highlights_data, text_overlays, effect_type, project['working_video_id']))

        # Transform and save highlight data to source raw_clips
        raw_clips_updated = 0

        if highlights_data and highlights_data != "[]":
            try:
                regions = json.loads(highlights_data)

                if regions:
                    raw_clips_updated = await _save_highlights_to_raw_clips(
                        project_id=project_id,
                        regions=regions,
                        cursor=cursor
                    )
            except json.JSONDecodeError as e:
                logger.warning(f"[Overlay Data] Failed to parse highlights: {e}")

        conn.commit()

        logger.info(f"[Overlay Data] Saved for working_video {project['working_video_id']}, "
                   f"updated {raw_clips_updated} raw_clips")

        return JSONResponse({
            'success': True,
            'saved_at': datetime.now().isoformat(),
            'working_video_id': project['working_video_id'],
            'raw_clips_updated': raw_clips_updated
        })


async def _save_highlights_to_raw_clips(
    project_id: int,
    regions: list,
    cursor
) -> int:
    """
    Transform highlight regions to raw clip space and save to raw_clips.

    Returns the number of raw clips updated.
    """
    # Get working clips with framing data and raw clip info
    cursor.execute("""
        SELECT wc.id, wc.raw_clip_id, wc.crop_data, wc.segments_data,
               rc.filename as raw_filename
        FROM working_clips wc
        JOIN raw_clips rc ON wc.raw_clip_id = rc.id
        WHERE wc.project_id = ? AND wc.raw_clip_id IS NOT NULL
    """, (project_id,))

    working_clips = cursor.fetchall()

    if not working_clips:
        logger.info("[Overlay Data] No working clips with raw_clip_id found")
        return 0

    # Get working video dimensions
    cursor.execute("""
        SELECT wv.filename
        FROM working_videos wv
        JOIN projects p ON p.working_video_id = wv.id
        WHERE p.id = ?
    """, (project_id,))
    wv_result = cursor.fetchone()

    # Default dimensions if we can't determine from video
    working_video_dims = {'width': 1080, 'height': 1920}

    if wv_result:
        # Try to get actual dimensions from the working video file
        import cv2
        from ...database import get_working_videos_path
        wv_path = get_working_videos_path() / wv_result['filename']
        if wv_path.exists():
            cap = cv2.VideoCapture(str(wv_path))
            if cap.isOpened():
                working_video_dims = {
                    'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                    'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                }
                cap.release()

    logger.info(f"[Overlay Data] Working video dimensions: {working_video_dims}")

    clips_updated = 0

    for clip in working_clips:
        raw_clip_id = clip['raw_clip_id']
        raw_filename = clip['raw_filename']

        # Parse framing data
        crop_keyframes = []
        segments_data = {}

        if clip['crop_data']:
            try:
                crop_keyframes = json.loads(clip['crop_data'])
            except json.JSONDecodeError:
                pass

        if clip['segments_data']:
            try:
                segments_data = json.loads(clip['segments_data'])
            except json.JSONDecodeError:
                pass

        # Transform regions to raw clip space
        raw_regions = transform_all_regions_to_raw(
            regions=regions,
            crop_keyframes=crop_keyframes,
            segments_data=segments_data,
            working_video_dims=working_video_dims,
            framerate=30.0
        )

        if not raw_regions:
            logger.info(f"[Overlay Data] No regions transformed for raw_clip {raw_clip_id}")
            continue

        # Extract player images for each region
        raw_clip_path = get_raw_clips_path() / raw_filename

        for region in raw_regions:
            if raw_clip_path.exists():
                region['keyframes'] = extract_player_images_for_region(
                    video_path=str(raw_clip_path),
                    raw_clip_id=raw_clip_id,
                    keyframes=region['keyframes'],
                    framerate=30.0
                )

        # Save to raw_clips
        cursor.execute("""
            UPDATE raw_clips
            SET default_highlight_regions = ?
            WHERE id = ?
        """, (json.dumps(raw_regions), raw_clip_id))

        clips_updated += 1
        logger.info(f"[Overlay Data] Saved {len(raw_regions)} regions to raw_clip {raw_clip_id}")

    return clips_updated


async def _load_highlights_from_raw_clips(project_id: int, cursor) -> list:
    """
    Load highlight regions from raw_clips and transform to working video space.

    Returns transformed highlight regions ready for the current project's framing.

    DEDUPLICATION: If the same raw_clip is used multiple times in a project
    (e.g., user adds the same clip twice), we only load its default_highlight_regions
    once to prevent duplicate/overlapping regions.
    """
    # Get working clips with framing data and raw clip defaults
    # Note: Same raw_clip_id may appear multiple times if clip is used more than once
    cursor.execute("""
        SELECT wc.id, wc.raw_clip_id, wc.crop_data, wc.segments_data,
               rc.default_highlight_regions
        FROM working_clips wc
        JOIN raw_clips rc ON wc.raw_clip_id = rc.id
        WHERE wc.project_id = ?
          AND rc.default_highlight_regions IS NOT NULL
          AND rc.default_highlight_regions != '[]'
    """, (project_id,))

    working_clips = cursor.fetchall()

    if not working_clips:
        return []

    # Get working video dimensions
    cursor.execute("""
        SELECT wv.filename
        FROM working_videos wv
        JOIN projects p ON p.working_video_id = wv.id
        WHERE p.id = ?
    """, (project_id,))
    wv_result = cursor.fetchone()

    # Default dimensions if we can't determine from video
    working_video_dims = {'width': 1080, 'height': 1920}

    if wv_result:
        import cv2
        from ...database import get_working_videos_path
        wv_path = get_working_videos_path() / wv_result['filename']
        if wv_path.exists():
            cap = cv2.VideoCapture(str(wv_path))
            if cap.isOpened():
                working_video_dims = {
                    'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                    'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                }
                cap.release()

    all_transformed_regions = []
    processed_raw_clip_ids = set()  # Track processed raw_clips to prevent duplicates

    for clip in working_clips:
        raw_clip_id = clip['raw_clip_id']

        # Skip if we've already processed this raw_clip (prevents duplicates when
        # the same clip is used multiple times in a project)
        if raw_clip_id in processed_raw_clip_ids:
            logger.info(f"[Overlay Data] Skipping duplicate raw_clip {raw_clip_id}")
            continue
        processed_raw_clip_ids.add(raw_clip_id)

        # Parse raw clip default highlights
        raw_regions = []
        if clip['default_highlight_regions']:
            try:
                raw_regions = json.loads(clip['default_highlight_regions'])
            except json.JSONDecodeError:
                continue

        if not raw_regions:
            continue

        # Parse framing data
        crop_keyframes = []
        segments_data = {}

        if clip['crop_data']:
            try:
                crop_keyframes = json.loads(clip['crop_data'])
            except json.JSONDecodeError:
                pass

        if clip['segments_data']:
            try:
                segments_data = json.loads(clip['segments_data'])
            except json.JSONDecodeError:
                pass

        # Transform regions from raw clip space to working video space
        transformed_regions = transform_all_regions_to_working(
            raw_regions=raw_regions,
            crop_keyframes=crop_keyframes,
            segments_data=segments_data,
            working_video_dims=working_video_dims,
            framerate=30.0
        )

        all_transformed_regions.extend(transformed_regions)

    logger.info(f"[Overlay Data] Loaded {len(all_transformed_regions)} regions from raw_clips")
    return all_transformed_regions


@router.get("/projects/{project_id}/overlay-data")
async def get_overlay_data(project_id: int):
    """
    Get saved overlay editing state for a project.

    Called by frontend when entering Overlay mode to restore previous edits.
    If no project-specific overlay data exists, checks source raw_clips for
    default highlight data (from previous projects using the same clips).

    Response:
    - highlights_data: Parsed JSON array of highlight regions
    - text_overlays: Parsed JSON array of text overlay configs
    - effect_type: 'original' | 'brightness_boost' | 'dark_overlay'
    - has_data: boolean indicating if any data exists
    - from_raw_clip: boolean indicating if data came from raw_clip defaults
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get latest working video's overlay data for this project
        cursor.execute("""
            SELECT highlights_data, text_overlays, effect_type
            FROM working_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))
        result = cursor.fetchone()

        # Parse project-specific overlay data
        highlights = []
        text_overlays = []
        effect_type = 'original'
        from_raw_clip = False

        if result:
            if result['highlights_data']:
                try:
                    highlights = json.loads(result['highlights_data'])
                except json.JSONDecodeError:
                    pass

            if result['text_overlays']:
                try:
                    text_overlays = json.loads(result['text_overlays'])
                except json.JSONDecodeError:
                    pass

            effect_type = result['effect_type'] or 'original'

        # If no project-specific highlights, check raw_clips for defaults
        if not highlights:
            highlights = await _load_highlights_from_raw_clips(project_id, cursor)
            if highlights:
                from_raw_clip = True
                logger.info(f"[Overlay Data] Using default highlights from raw_clip for project {project_id}")

        return JSONResponse({
            'highlights_data': highlights,
            'text_overlays': text_overlays,
            'effect_type': effect_type,
            'has_data': len(highlights) > 0 or len(text_overlays) > 0,
            'from_raw_clip': from_raw_clip
        })


@router.get("/highlights/{filename}")
async def get_highlight_image(filename: str):
    """
    Serve a highlight player image by filename.

    Images are extracted from raw clips during highlight persistence
    and stored in the highlights directory for debugging/inspection.

    Response:
    - PNG image file of the player bounding box
    """
    # Validate filename to prevent directory traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Redirect to R2 presigned URL
    user_id = get_current_user_id()
    presigned_url = generate_presigned_url(
        user_id=user_id,
        relative_path=f"highlights/{filename}",
        expires_in=3600,
        content_type="image/png"
    )
    if presigned_url:
        return RedirectResponse(url=presigned_url, status_code=302)
    raise HTTPException(status_code=404, detail="Failed to generate R2 URL for highlight image")


@router.get("/highlights")
async def list_highlights(raw_clip_id: int = None):
    """
    List all highlight images, optionally filtered by raw_clip_id.

    Response:
    - images: List of image info dicts with filename, url, raw_clip_id, frame, keyframe_index
    """
    images = list_highlight_images(raw_clip_id)
    return JSONResponse({
        'images': images,
        'count': len(images)
    })


# =============================================================================
# Modal GPU Rendering Endpoints
# =============================================================================


class OverlayRenderRequest(BaseModel):
    """Request body for Modal-based overlay render."""
    project_id: int
    export_id: str
    effect_type: str = "dark_overlay"


@router.post("/render-overlay")
async def render_overlay(request: OverlayRenderRequest):
    """
    Render overlay export using Modal GPU (or local fallback).

    This endpoint reads highlight data from the database and renders
    the overlay on the project's working video.

    When Modal is enabled:
    - Video stays in R2 (no download to backend)
    - Modal downloads, processes, uploads result
    - Much faster for cloud deployments

    When Modal is disabled:
    - Falls back to local processing

    Steps:
    1. Validate project has working_video
    2. Get highlight regions from working_video overlay_data
    3. Call Modal (or local) to process
    4. Save final_video and update project
    """
    project_id = request.project_id
    export_id = request.export_id
    effect_type = request.effect_type

    user_id = get_current_user_id()

    logger.info(f"[Overlay Render] Starting for project {project_id}, user: {user_id}, Modal: {modal_enabled()}")

    # Initialize progress tracking
    export_progress[export_id] = {
        "progress": 5,
        "message": "Validating project...",
        "status": "processing"
    }

    # Get project info and working video
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT p.id, p.name, p.working_video_id,
                   wv.filename as working_filename,
                   wv.highlights_data, wv.effect_type, wv.duration
            FROM projects p
            JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found or has no working video")

        project_name = project['name']

        # If project name matches "Clip {id}" pattern, try to derive a better name from clip data
        # This handles legacy auto-projects created before we added derive_clip_name
        if project_name and re.match(r'^Clip \d+$', project_name):
            cursor.execute("""
                SELECT rc.name, rc.rating, rc.tags
                FROM raw_clips rc
                WHERE rc.auto_project_id = ?
                LIMIT 1
            """, (project_id,))
            raw_clip = cursor.fetchone()
            if raw_clip:
                tags = json.loads(raw_clip['tags']) if raw_clip['tags'] else []
                from app.queries import derive_clip_name
                derived_name = derive_clip_name(raw_clip['name'], raw_clip['rating'] or 0, tags)
                if derived_name:
                    project_name = derived_name

        working_filename = project['working_filename']

        # Get video duration from working_videos table for cost-optimized GPU selection
        # If duration is not available, defaults to None (triggers sequential 1 GPU processing)
        video_duration = project['duration'] if project['duration'] else None

        # Create export_jobs record
        try:
            cursor.execute("""
                INSERT INTO export_jobs (id, project_id, type, status, input_data)
                VALUES (?, ?, 'overlay', 'processing', '{}')
            """, (export_id, project_id))
            conn.commit()
        except Exception as e:
            logger.warning(f"[Overlay Render] Failed to create export_jobs record: {e}")

    # Parse highlight regions
    highlight_regions = []
    if project['highlights_data']:
        try:
            highlight_regions = json.loads(project['highlights_data'])
        except json.JSONDecodeError:
            pass

    # Use saved effect_type if not specified
    if not effect_type and project['effect_type']:
        effect_type = project['effect_type']
    effect_type = effect_type or "dark_overlay"

    # Always use sequential processing (parallel costs 3-4x more per E7 experiment)
    logger.info(f"[Overlay Render] Working video: {working_filename}, {len(highlight_regions)} regions, effect: {effect_type}")
    logger.info(f"[Overlay Render] Duration: {video_duration}s, Config: sequential (1 GPU)")

    # Update progress
    progress_data = {
        "progress": 5,
        "message": "Sending to cloud GPU..." if modal_enabled() else "Processing locally...",
        "status": "processing",
        "projectId": project_id,
        "projectName": project_name,
        "type": "overlay"
    }
    export_progress[export_id] = progress_data
    await manager.send_progress(export_id, progress_data)

    try:
        # Generate output filename
        output_filename = f"final_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
        parallel_used = False  # Will be set to True if parallel processing is used

        if modal_enabled():
            # Use Modal GPU processing
            logger.info(f"[Overlay Render] Using Modal GPU")

            # Create progress callback for real-time updates
            async def modal_progress_callback(progress: float, message: str, phase: str = "modal_processing"):
                progress_data = {
                    "progress": progress,
                    "message": message,
                    "status": "processing",
                    "phase": phase,  # Include phase for frontend tracking
                    "projectId": project_id,
                    "projectName": project_name,
                    "type": "overlay"
                }
                export_progress[export_id] = progress_data
                await manager.send_progress(export_id, progress_data)

            # Callback to store Modal call_id for job recovery
            def store_modal_call_id(modal_call_id: str):
                try:
                    with get_db_connection() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            UPDATE export_jobs
                            SET modal_call_id = ?, started_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        """, (modal_call_id, export_id))
                        conn.commit()
                    logger.info(f"[Overlay Render] Stored modal_call_id: {modal_call_id}")
                except Exception as e:
                    logger.warning(f"[Overlay Render] Failed to store modal_call_id: {e}")

            # Use auto-selection: parallel for longer videos, sequential for shorter
            result = await call_modal_overlay_auto(
                job_id=export_id,
                user_id=user_id,
                input_key=f"working_videos/{working_filename}",
                output_key=f"final_videos/{output_filename}",
                highlight_regions=highlight_regions,
                effect_type=effect_type,
                video_duration=video_duration,
                progress_callback=modal_progress_callback,
                call_id_callback=store_modal_call_id,
            )

            if result.get("status") != "success":
                error = result.get("error", "Unknown error")
                raise RuntimeError(f"Modal processing failed: {error}")

            # Update to 95% after Modal completes
            progress_data = {
                "progress": 95,
                "message": "Saving to library...",
                "status": "processing",
                "projectId": project_id,
                "projectName": project_name,
                "type": "overlay"
            }
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            parallel_used = result.get("parallel", False)
            logger.info(f"[Overlay Render] Modal processing complete (parallel={parallel_used})")

        else:
            # Local processing fallback
            logger.info(f"[Overlay Render] Using local processing (Modal disabled)")

            # Download working video from R2
            temp_dir = tempfile.mkdtemp()
            input_path = os.path.join(temp_dir, "input.mp4")
            output_path = os.path.join(temp_dir, "output.mp4")

            try:
                if not download_from_r2(user_id, f"working_videos/{working_filename}", Path(input_path)):
                    raise RuntimeError("Failed to download working video from R2")

                # Process locally
                if not highlight_regions:
                    # No highlights - just copy
                    import shutil
                    shutil.copy(input_path, output_path)
                else:
                    # Process with local frame-by-frame rendering
                    _process_frames_to_ffmpeg(
                        input_path,
                        output_path,
                        highlight_regions,
                        effect_type,
                        lambda p, m: None  # No progress callback for now
                    )

                # Upload result to R2
                if not upload_to_r2(user_id, f"final_videos/{output_filename}", Path(output_path)):
                    raise RuntimeError("Failed to upload final video to R2")

            finally:
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)

        # Save to database
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Get next version number
            cursor.execute("""
                SELECT COALESCE(MAX(version), 0) + 1 as next_version
                FROM final_videos WHERE project_id = ?
            """, (project_id,))
            next_version = cursor.fetchone()['next_version']

            # Determine source_type
            cursor.execute("SELECT id FROM raw_clips WHERE auto_project_id = ?", (project_id,))
            is_auto_project = cursor.fetchone() is not None
            source_type = 'brilliant_clip' if is_auto_project else 'custom_project'

            # Create final_videos record
            cursor.execute("""
                INSERT INTO final_videos (project_id, filename, version, source_type)
                VALUES (?, ?, ?, ?)
            """, (project_id, output_filename, next_version, source_type))
            final_video_id = cursor.lastrowid

            # Update project
            cursor.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (final_video_id, project_id))

            # Update export_jobs
            cursor.execute("""
                UPDATE export_jobs SET status = 'complete', output_video_id = ?, output_filename = ?, completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (final_video_id, output_filename, export_id))

            conn.commit()

        # Send complete progress
        complete_data = {
            "progress": 100,
            "message": "Export complete!",
            "status": ExportStatus.COMPLETE,
            "projectId": project_id,
            "projectName": project_name,
            "type": "overlay",
            "finalVideoId": final_video_id,
            "finalFilename": output_filename
        }
        export_progress[export_id] = complete_data
        await manager.send_progress(export_id, complete_data)

        logger.info(f"[Overlay Render] Complete: final_video_id={final_video_id}, parallel={parallel_used}")

        return JSONResponse({
            'success': True,
            'final_video_id': final_video_id,
            'filename': output_filename,
            'project_id': project_id,
            'export_id': export_id,
            'modal_used': modal_enabled(),
            'parallel_used': parallel_used,
            'video_duration': video_duration
        })

    except Exception as e:
        logger.error(f"[Overlay Render] Failed: {e}", exc_info=True)

        # Update export_jobs to error
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE export_jobs SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (str(e)[:500], export_id))
                conn.commit()
        except Exception:
            pass

        error_data = {
            "progress": 0,
            "message": f"Export failed: {e}",
            "status": "error",
            "projectId": project_id,
            "projectName": project_name,
            "type": "overlay"
        }
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        raise HTTPException(status_code=500, detail=str(e))
