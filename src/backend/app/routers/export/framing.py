"""
Framing mode export endpoints.

This module handles exports related to the Framing editing mode:
- /crop - Basic crop export
- /upscale - AI upscale export with de-zoom
- /framing - Save framing output to project
- /projects/{id}/working-video - Stream working video

These endpoints handle crop keyframes, segment speed changes, trimming,
and AI upscaling for the Framing mode workflow.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pathlib import Path
from typing import Dict, Any
import json
import os
import tempfile
import uuid
import asyncio
import logging
import ffmpeg

from ...models import CropKeyframe
from ...websocket import export_progress, manager
from ...interpolation import generate_crop_filter
from ...database import get_db_connection, get_working_videos_path
from ...queries import latest_working_clips_subquery
from ...storage import generate_presigned_url, upload_to_r2, upload_bytes_to_r2, download_from_r2
from ...services.ffmpeg_service import get_video_duration
from ...services.modal_client import modal_enabled, call_modal_framing_ai
from pydantic import BaseModel
from typing import Optional
from ...user_context import get_current_user_id, set_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter()

# AI upscaler will be imported on-demand to avoid import errors
AIVideoUpscaler = None
try:
    from app.ai_upscaler import AIVideoUpscaler as _AIVideoUpscaler
    AIVideoUpscaler = _AIVideoUpscaler
except (ImportError, OSError, AttributeError) as e:
    logger.warning(f"AI upscaler dependencies not available: {e}")
    logger.warning("AI upscaling features will be disabled")


@router.post("/crop")
async def export_crop(
    video: UploadFile = File(...),
    keyframes_json: str = Form(...)
):
    """
    Export video with crop applied.
    Accepts video file and crop keyframes, returns cropped video.
    """
    # Parse keyframes
    try:
        keyframes_data = json.loads(keyframes_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid keyframes JSON: {str(e)}")

    keyframes = [CropKeyframe(**kf) for kf in keyframes_data]

    if len(keyframes) == 0:
        raise HTTPException(status_code=400, detail="No crop keyframes provided")

    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"output_{uuid.uuid4().hex}.mp4")

    # Save uploaded file
    with open(input_path, 'wb') as f:
        content = await video.read()
        f.write(content)

    # Get video info
    probe = ffmpeg.probe(input_path)
    video_info = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    duration = float(probe['format']['duration'])
    fps = eval(video_info['r_frame_rate'])

    # Convert keyframes to dict format
    keyframes_dict = [
        {
            'time': kf.time,
            'x': kf.x,
            'y': kf.y,
            'width': kf.width,
            'height': kf.height
        }
        for kf in keyframes
    ]

    # Sort keyframes by time
    keyframes_dict.sort(key=lambda k: k['time'])

    # Generate crop filter with structured parameters
    crop_params = generate_crop_filter(keyframes_dict, duration, fps)

    # Process video with FFmpeg
    try:
        stream = ffmpeg.input(input_path)
        stream = ffmpeg.filter(stream, 'crop',
                             w=crop_params['width_expr'],
                             h=crop_params['height_expr'],
                             x=crop_params['x_expr'],
                             y=crop_params['y_expr'])
        stream = ffmpeg.output(stream, output_path,
                             vcodec='libx265',
                             crf=10,
                             preset='veryslow',
                             **{'x265-params': 'aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6'},
                             acodec='aac',
                             audio_bitrate='256k',
                             pix_fmt='yuv420p',
                             colorspace='bt709',
                             color_primaries='bt709',
                             color_trc='bt709',
                             color_range='tv')
        ffmpeg.run(stream, overwrite_output=True, capture_stdout=True, capture_stderr=True)
    except ffmpeg.Error as e:
        # Fallback to average crop
        logger.warning(f"Complex crop filter failed, falling back to average crop. Error: {e.stderr.decode()}")

        avg_crop = {
            'x': round(sum(kf['x'] for kf in keyframes_dict) / len(keyframes_dict), 3),
            'y': round(sum(kf['y'] for kf in keyframes_dict) / len(keyframes_dict), 3),
            'width': round(sum(kf['width'] for kf in keyframes_dict) / len(keyframes_dict), 3),
            'height': round(sum(kf['height'] for kf in keyframes_dict) / len(keyframes_dict), 3)
        }

        stream = ffmpeg.input(input_path)
        stream = ffmpeg.filter(stream, 'crop',
                             avg_crop['width'], avg_crop['height'],
                             avg_crop['x'], avg_crop['y'])
        stream = ffmpeg.output(stream, output_path,
                             vcodec='libx265',
                             crf=10,
                             preset='veryslow',
                             **{'x265-params': 'aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6'},
                             acodec='aac',
                             audio_bitrate='256k',
                             pix_fmt='yuv420p',
                             colorspace='bt709',
                             color_primaries='bt709',
                             color_trc='bt709',
                             color_range='tv')
        ffmpeg.run(stream, overwrite_output=True, capture_stdout=True, capture_stderr=True)

    return FileResponse(
        output_path,
        media_type='video/mp4',
        filename=f"cropped_{video.filename}",
        background=None
    )


@router.post("/upscale")
async def export_with_ai_upscale(
    video: UploadFile = File(...),
    keyframes_json: str = Form(...),
    target_fps: int = Form(30),
    export_id: str = Form(...),
    project_id: int = Form(None),  # Optional: for export_jobs tracking
    export_mode: str = Form("quality"),
    segment_data_json: str = Form(None),
    include_audio: str = Form("true"),
    enable_source_preupscale: str = Form("false"),
    enable_diffusion_sr: str = Form("false"),
):
    """
    Export video with AI upscaling and de-zoom (Framing mode).

    This endpoint handles crop, trim, speed, and AI upscaling.
    Highlight overlays are handled separately by /overlay endpoint.

    Steps:
    1. Extracts frames with crop applied (de-zoom - removes digital zoom)
    2. Detects aspect ratio and determines target resolution
    3. Upscales each frame using Real-ESRGAN AI model
    4. Reassembles into final video
    """
    # CRITICAL: Capture user ID at the start of the request
    # The AI upscaling runs for 10+ minutes in asyncio.to_thread(), and
    # context variables can be lost during long-running async operations.
    # We restore the user context before database operations to ensure
    # the correct user's database is accessed.
    captured_user_id = get_current_user_id()
    logger.info(f"[Framing Export] Starting for user: {captured_user_id}")

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
            logger.warning(f"[Framing Export] Failed to fetch project name: {e}")

    # Create export_jobs record for tracking (if project_id provided)
    if project_id:
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO export_jobs (id, project_id, type, status, input_data)
                    VALUES (?, ?, 'framing', 'processing', '{}')
                """, (export_id, project_id))
                conn.commit()
            logger.info(f"[Framing Export] Created export_jobs record: {export_id} for project '{project_name}'")
        except Exception as e:
            logger.warning(f"[Framing Export] Failed to create export_jobs record: {e}")

    # Initialize progress tracking
    export_progress[export_id] = {
        "progress": 10,
        "message": "Starting export...",
        "status": "processing"
    }

    # Parse parameters
    include_audio_bool = include_audio.lower() == "true"
    enable_source_preupscale_bool = enable_source_preupscale.lower() == "true"
    enable_diffusion_sr_bool = enable_diffusion_sr.lower() == "true"

    logger.info(f"Audio setting: {'Include audio' if include_audio_bool else 'Video only'}")

    # Parse keyframes
    try:
        keyframes_data = json.loads(keyframes_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid keyframes JSON: {str(e)}")

    keyframes = [CropKeyframe(**kf) for kf in keyframes_data]
    if len(keyframes) == 0:
        raise HTTPException(status_code=400, detail="No crop keyframes provided")

    # Parse segment data (speed/trim)
    segment_data = None
    if segment_data_json:
        try:
            segment_data = json.loads(segment_data_json)
            logger.info(f"Segment data received: {json.dumps(segment_data, indent=2)}")
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid segment data JSON: {str(e)}")

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"upscaled_{uuid.uuid4().hex}.mp4")

    try:
        # Save uploaded file
        with open(input_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        # Convert keyframes
        keyframes_dict = [
            {'time': kf.time, 'x': kf.x, 'y': kf.y, 'width': kf.width, 'height': kf.height}
            for kf in keyframes
        ]

        # Check AI upscaler
        if AIVideoUpscaler is None:
            raise HTTPException(
                status_code=503,
                detail={"error": "AI upscaling dependencies not installed"}
            )

        # Initialize upscaler
        upscaler = AIVideoUpscaler(
            device='cuda',
            export_mode=export_mode,
            enable_source_preupscale=enable_source_preupscale_bool,
            enable_diffusion_sr=enable_diffusion_sr_bool,
            sr_model_name='realesr_general_x4v3'
        )

        if upscaler.upsampler is None:
            raise HTTPException(
                status_code=503,
                detail={"error": "AI SR model failed to load"}
            )

        # Capture event loop
        loop = asyncio.get_running_loop()

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

        def progress_callback(current, total, message, phase='ai_upscale'):
            if phase not in progress_ranges:
                phase = 'ai_upscale'
            start_percent, end_percent = progress_ranges[phase]
            phase_progress = (current / total) if total > 0 else 0
            overall_percent = start_percent + (phase_progress * (end_percent - start_percent))

            progress_data = {
                "progress": overall_percent,
                "message": message,
                "status": "processing",
                "current": current,
                "total": total,
                "phase": phase,
                "projectId": project_id,
                "projectName": project_name,
                "type": "framing"
            }
            export_progress[export_id] = progress_data
            logger.info(f"Progress: {overall_percent:.1f}% - {message}")

            try:
                asyncio.run_coroutine_threadsafe(
                    manager.send_progress(export_id, progress_data),
                    loop
                )
            except Exception as e:
                logger.error(f"Failed to send WebSocket update: {e}")

        # Update progress
        init_data = {"progress": 10, "message": "Initializing AI upscaler...", "status": "processing", "projectId": project_id, "projectName": project_name, "type": "framing"}
        export_progress[export_id] = init_data
        await manager.send_progress(export_id, init_data)

        # Run upscaling (no highlight params - those are handled by /overlay endpoint)
        result = await asyncio.to_thread(
            upscaler.process_video_with_upscale,
            input_path=input_path,
            output_path=output_path,
            keyframes=keyframes_dict,
            target_fps=target_fps,
            export_mode=export_mode,
            progress_callback=progress_callback,
            segment_data=segment_data,
            include_audio=include_audio_bool,
        )

        logger.info(f"AI upscaling complete. Output: {output_path}")

        # CRITICAL: Restore user context after long-running task
        # The asyncio.to_thread() may have caused context variable drift
        set_current_user_id(captured_user_id)
        logger.info(f"[Framing Export] Restored user context: {captured_user_id}")

        # MVC: Backend saves the working video directly - no frontend involvement needed
        # This ensures the export is durable even if user navigates away
        working_video_id = None
        working_filename = None
        if project_id:
            try:
                with get_db_connection() as conn:
                    cursor = conn.cursor()

                    # Generate unique filename and upload directly to R2 (no local storage)
                    working_filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
                    user_id = captured_user_id  # Use captured user ID, not get_current_user_id()

                    # Get video duration for cost-optimized GPU selection in overlay mode
                    video_duration = get_video_duration(output_path)
                    logger.info(f"[Framing Export] Video duration: {video_duration:.2f}s")

                    # Upload directly from temp file to R2
                    if not upload_to_r2(user_id, f"working_videos/{working_filename}", Path(output_path)):
                        raise Exception("Failed to upload working video to R2")
                    logger.info(f"[Framing Export] Uploaded working video to R2: {working_filename}")

                    # Get next version number
                    cursor.execute("""
                        SELECT COALESCE(MAX(version), 0) + 1 as next_version
                        FROM working_videos WHERE project_id = ?
                    """, (project_id,))
                    next_version = cursor.fetchone()['next_version']

                    # Reset final_video_id (framing changed, need to re-export overlay)
                    cursor.execute("UPDATE projects SET final_video_id = NULL WHERE id = ?", (project_id,))

                    # Create working_videos record with duration
                    cursor.execute("""
                        INSERT INTO working_videos (project_id, filename, version, duration)
                        VALUES (?, ?, ?, ?)
                    """, (project_id, working_filename, next_version, video_duration if video_duration > 0 else None))
                    working_video_id = cursor.lastrowid

                    # Update project with new working_video_id
                    cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))

                    # Update export_jobs record to complete with output reference
                    cursor.execute("""
                        UPDATE export_jobs SET status = 'complete', output_video_id = ?, output_filename = ?, completed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (working_video_id, working_filename, export_id))

                    # Set exported_at for working clips
                    cursor.execute(f"""
                        UPDATE working_clips SET exported_at = datetime('now')
                        WHERE project_id = ? AND id IN ({latest_working_clips_subquery()})
                    """, (project_id, project_id))

                    conn.commit()
                    logger.info(f"[Framing Export] Created working video {working_video_id} for project {project_id}")

            except Exception as e:
                logger.error(f"[Framing Export] Failed to save working video: {e}", exc_info=True)
                # Don't fail the whole export - still return the video
                working_video_id = None

        # Complete - include working_video_id so frontend knows the video was saved
        complete_data = {
            "progress": 100,
            "message": "Export complete!",
            "status": "complete",
            "projectId": project_id,
            "projectName": project_name,
            "type": "framing",
            "workingVideoId": working_video_id,
            "workingFilename": working_filename
        }
        export_progress[export_id] = complete_data
        await manager.send_progress(export_id, complete_data)

        # Return JSON response instead of blob - frontend doesn't need the video data
        # The working video is already saved to DB, frontend just needs to know it's done
        return JSONResponse({
            'success': True,
            'working_video_id': working_video_id,
            'filename': working_filename,
            'project_id': project_id,
            'export_id': export_id
        })

    except Exception as e:
        logger.error(f"AI upscaling failed: {str(e)}", exc_info=True)
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
        error_data = {"progress": 0, "message": f"Export failed: {str(e)}", "status": "error", "projectId": project_id, "projectName": project_name, "type": "framing"}
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        import shutil
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[AI Upscale] Cleanup failed: {cleanup_error}")
        raise HTTPException(status_code=500, detail=f"AI upscaling failed: {str(e)}")


@router.post("/framing")
async def export_framing(
    project_id: int = Form(...),
    video: UploadFile = File(...),
    clips_data: str = Form("[]")
):
    """
    Export framed video for a project.

    This endpoint:
    1. Receives the rendered video from the frontend
    2. Saves it to working_videos folder
    3. Creates working_videos DB entry with next version number
    4. Updates project.working_video_id
    5. Resets project.final_video_id (framing changed, need to re-export overlay)
    6. Sets exported_at timestamp for all working clips

    Request:
    - project_id: The project ID
    - video: The rendered video file
    - clips_data: JSON with clip configurations (for metadata)

    Response:
    - success: boolean
    - working_video_id: The new working video ID
    - filename: The saved filename
    """
    logger.info(f"[Framing Export] Starting for project {project_id}")

    try:
        clips_config = json.loads(clips_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid clips_data JSON")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id, working_video_id FROM projects WHERE id = ?", (project_id,))
        project = cursor.fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Generate unique filename and upload directly to R2 (no local storage, no temp file)
        filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
        user_id = get_current_user_id()

        # Upload directly from memory to R2
        content = await video.read()
        if not upload_bytes_to_r2(user_id, f"working_videos/{filename}", content):
            raise HTTPException(status_code=500, detail="Failed to upload working video to R2")
        logger.info(f"[Framing Export] Uploaded working video to R2: {filename} ({len(content)} bytes)")

        # Get video duration for cost-optimized GPU selection in overlay mode
        # Write to temp file briefly to probe duration
        video_duration = 0.0
        try:
            with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            video_duration = get_video_duration(tmp_path)
            os.unlink(tmp_path)
            logger.info(f"[Framing Export] Video duration: {video_duration:.2f}s")
        except Exception as e:
            logger.warning(f"[Framing Export] Failed to get duration: {e}")

        # Get next version number for working video
        cursor.execute("""
            SELECT COALESCE(MAX(version), 0) + 1 as next_version
            FROM working_videos
            WHERE project_id = ?
        """, (project_id,))
        next_version = cursor.fetchone()['next_version']

        # Reset final_video_id since framing changed (user needs to re-export from overlay)
        cursor.execute("""
            UPDATE projects SET final_video_id = NULL WHERE id = ?
        """, (project_id,))
        logger.info(f"[Framing Export] Reset final_video_id due to framing change")

        # Create new working video entry with version number and duration
        cursor.execute("""
            INSERT INTO working_videos (project_id, filename, version, duration)
            VALUES (?, ?, ?, ?)
        """, (project_id, filename, next_version, video_duration if video_duration > 0 else None))
        working_video_id = cursor.lastrowid

        # Update project with new working video ID
        cursor.execute("""
            UPDATE projects SET working_video_id = ? WHERE id = ?
        """, (working_video_id, project_id))

        # Set exported_at timestamp for all working clips (latest versions only)
        cursor.execute(f"""
            UPDATE working_clips
            SET exported_at = datetime('now')
            WHERE project_id = ?
            AND id IN ({latest_working_clips_subquery()})
        """, (project_id, project_id))

        clips_updated = cursor.rowcount
        logger.info(f"[Framing Export] Set exported_at for {clips_updated} clips in project {project_id}")

        # Fallback: If no clips were updated, try simpler approach
        if clips_updated == 0:
            logger.warning(f"[Framing Export] No clips updated with version query, trying fallback for project {project_id}")
            cursor.execute("SELECT COUNT(*) as cnt FROM working_clips WHERE project_id = ?", (project_id,))
            total_clips = cursor.fetchone()['cnt']
            logger.info(f"[Framing Export] Project {project_id} has {total_clips} total working_clips")

            if total_clips > 0:
                cursor.execute("""
                    UPDATE working_clips
                    SET exported_at = datetime('now')
                    WHERE project_id = ?
                    AND exported_at IS NULL
                """, (project_id,))
                clips_updated = cursor.rowcount
                logger.info(f"[Framing Export] Fallback: Set exported_at for {clips_updated} clips")

        conn.commit()

        logger.info(f"[Framing Export] Created working video {working_video_id} for project {project_id}")

        return JSONResponse({
            'success': True,
            'working_video_id': working_video_id,
            'filename': filename,
            'project_id': project_id
        })


@router.get("/projects/{project_id}/working-video")
async def get_working_video(project_id: int):
    """Stream the working video for a project."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get latest working video for this project
        cursor.execute("""
            SELECT filename
            FROM working_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))
        result = cursor.fetchone()

        if not result:
            raise HTTPException(status_code=404, detail="Working video not found")

        # Redirect to R2 presigned URL
        user_id = get_current_user_id()
        presigned_url = generate_presigned_url(
            user_id=user_id,
            relative_path=f"working_videos/{result['filename']}",
            expires_in=3600,
            content_type="video/mp4"
        )
        if presigned_url:
            return RedirectResponse(url=presigned_url, status_code=302)
        raise HTTPException(status_code=404, detail="Failed to generate R2 URL for working video")


# =============================================================================
# Backend-Authoritative Export Endpoint
# =============================================================================


class RenderRequest(BaseModel):
    """Request body for backend-authoritative framing render."""
    project_id: int
    export_id: str
    export_mode: str = "quality"  # "quality" or "FAST"
    target_fps: int = 30
    include_audio: bool = True


@router.post("/render")
async def render_project(request: RenderRequest):
    """
    Backend-authoritative framing export.

    This endpoint reads all rendering data from the database (working_clips)
    and renders the video server-side. The frontend only provides the project ID.

    This ensures:
    - Backend is single source of truth
    - Exports are reproducible
    - No orphan working_videos (clips must exist first)

    Steps:
    1. Validate project exists and has working_clips
    2. Read crop_data, segments_data, timing_data from working_clips
    3. Fetch source video(s) from R2
    4. Render using stored parameters
    5. Save working_video and update project
    """
    project_id = request.project_id
    export_id = request.export_id

    # CRITICAL: Capture user ID at the start of the request (see /upscale endpoint for explanation)
    captured_user_id = get_current_user_id()

    logger.info(f"[Render] Starting backend-authoritative render for project {project_id}, user: {captured_user_id}")

    # Initialize progress tracking
    export_progress[export_id] = {
        "progress": 5,
        "message": "Validating project...",
        "status": "processing"
    }

    # Create export_jobs record for tracking and recovery
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO export_jobs (id, project_id, type, status, input_data)
                VALUES (?, ?, 'framing', 'processing', '{}')
            """, (export_id, project_id))
            conn.commit()
        logger.info(f"[Render] Created export_jobs record: {export_id}")
    except Exception as e:
        logger.warning(f"[Render] Failed to create export_jobs record: {e}")

    # Step 1: Validate project and get working_clips
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get project info
        cursor.execute("""
            SELECT id, name, aspect_ratio
            FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        project_name = project['name']

        # If project name matches "Clip {id}" pattern, try to derive a better name from clip data
        # This handles legacy auto-projects created before we added derive_clip_name
        import re
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

        # Create export_jobs record
        try:
            cursor.execute("""
                INSERT INTO export_jobs (id, project_id, type, status, input_data)
                VALUES (?, ?, 'framing', 'processing', '{}')
            """, (export_id, project_id))
            conn.commit()
        except Exception as e:
            logger.warning(f"[Render] Failed to create export_jobs record: {e}")

        # Get working_clips with their rendering data
        cursor.execute(f"""
            SELECT
                wc.id,
                wc.raw_clip_id,
                wc.uploaded_filename,
                wc.crop_data,
                wc.timing_data,
                wc.segments_data,
                wc.sort_order,
                rc.filename as raw_filename,
                rc.name as clip_name
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            WHERE wc.project_id = ?
            AND wc.id IN ({latest_working_clips_subquery()})
            ORDER BY wc.sort_order
        """, (project_id, project_id))
        working_clips = cursor.fetchall()

    if not working_clips:
        error_data = {
            "progress": 0,
            "message": "Project has no clips to export. Add clips first.",
            "status": "error",
            "error": "no_clips"
        }
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)
        raise HTTPException(
            status_code=400,
            detail={"error": "no_clips", "message": "Project has no clips to export. Add clips first."}
        )

    # For now, support single-clip projects only
    # Multi-clip will use the existing multi-clip endpoint
    if len(working_clips) > 1:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "multi_clip_not_supported",
                "message": "Multi-clip render not yet supported. Use the standard export for multi-clip projects."
            }
        )

    clip = working_clips[0]

    # Step 2: Validate clip has required data
    if not clip['crop_data']:
        error_msg = f"Clip '{clip['clip_name'] or 'Unknown'}' has no framing data. Open clip in Framing mode first."
        error_data = {
            "progress": 0,
            "message": error_msg,
            "status": "error",
            "error": "missing_crop_data",
            "clip_id": clip['id']
        }
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)
        raise HTTPException(
            status_code=400,
            detail={"error": "missing_crop_data", "message": error_msg, "clip_id": clip['id']}
        )

    # Determine source video filename
    source_filename = clip['raw_filename'] or clip['uploaded_filename']
    if not source_filename:
        error_msg = "Clip has no source video"
        error_data = {
            "progress": 0,
            "message": error_msg,
            "status": "error",
            "error": "no_source_video"
        }
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)
        raise HTTPException(
            status_code=400,
            detail={"error": "no_source_video", "message": error_msg}
        )

    # Step 3: Parse rendering data from database
    try:
        crop_keyframes = json.loads(clip['crop_data'])
        logger.info(f"[Render] Raw crop_data from DB: {clip['crop_data'][:500]}...")  # Log first 500 chars
        logger.info(f"[Render] Parsed crop_keyframes: {crop_keyframes}")
    except (json.JSONDecodeError, TypeError) as e:
        raise HTTPException(status_code=500, detail=f"Invalid crop_data in database: {e}")

    segment_data = None
    if clip['segments_data']:
        try:
            segment_data = json.loads(clip['segments_data'])
            logger.info(f"[Render] Parsed segment_data: {segment_data}")
        except (json.JSONDecodeError, TypeError):
            logger.warning(f"[Render] Invalid segments_data, ignoring")

    # Validate and convert keyframes to CropKeyframe objects (time-based for FFmpeg)
    logger.info(f"[Render] Converting {len(crop_keyframes)} keyframes to CropKeyframe objects")

    # Convert frame-based keyframes to time-based for FFmpeg
    # Internal storage uses frame numbers for precision, FFmpeg needs time in seconds
    FRAMERATE = 30  # TODO: get from video metadata
    if crop_keyframes and 'frame' in crop_keyframes[0] and 'time' not in crop_keyframes[0]:
        logger.info(f"[Render] Converting frame-based keyframes to time-based (framerate={FRAMERATE})")
        crop_keyframes = [
            {
                'time': kf['frame'] / FRAMERATE,
                'x': kf['x'],
                'y': kf['y'],
                'width': kf['width'],
                'height': kf['height'],
            }
            for kf in crop_keyframes
        ]
        logger.info(f"[Render] Converted keyframes: {crop_keyframes}")

    try:
        keyframes = [CropKeyframe(**kf) for kf in crop_keyframes]
    except Exception as e:
        logger.error(f"[Render] Failed to parse crop keyframes: {e}")
        logger.error(f"[Render] Keyframe data: {crop_keyframes}")
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_crop_format", "message": f"Invalid crop keyframe format: {e}"}
        )

    if len(keyframes) == 0:
        raise HTTPException(status_code=400, detail="No crop keyframes found in saved data")

    # Update progress
    progress_data = {"progress": 10, "message": "Downloading source video...", "status": "processing", "projectId": project_id, "projectName": project_name, "type": "framing"}
    export_progress[export_id] = progress_data
    await manager.send_progress(export_id, progress_data)

    # Step 4: Process video (Modal cloud GPU or local)
    user_id = get_current_user_id()

    # Determine R2 path based on source type
    if clip['raw_filename']:
        input_key = f"raw_clips/{clip['raw_filename']}"
    else:
        input_key = f"uploads/{clip['uploaded_filename']}"

    # Convert keyframes to dict format
    keyframes_dict = [
        {'time': kf.time, 'x': kf.x, 'y': kf.y, 'width': kf.width, 'height': kf.height}
        for kf in keyframes
    ]

    # Generate output filename
    working_filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
    output_key = f"working_videos/{working_filename}"

    temp_dir = tempfile.mkdtemp()
    output_path = os.path.join(temp_dir, working_filename)

    try:
        # Use Modal cloud GPU when enabled (production)
        if modal_enabled():
            logger.info(f"[Render] Using Modal cloud GPU for AI upscaling")

            # First, get video duration for progress estimation
            # Download source briefly to probe duration
            input_path_temp = os.path.join(temp_dir, f"probe_{uuid.uuid4().hex[:8]}.mp4")
            source_duration = 10.0  # Default estimate
            try:
                if download_from_r2(user_id, input_key, Path(input_path_temp)):
                    source_duration = get_video_duration(input_path_temp)
                    logger.info(f"[Render] Source video duration: {source_duration:.2f}s")
                    os.unlink(input_path_temp)  # Clean up probe file
            except Exception as e:
                logger.warning(f"[Render] Could not probe source duration: {e}")

            # Update progress
            init_data = {"progress": 15, "message": "Starting cloud AI upscaler...", "status": "processing", "projectId": project_id, "projectName": project_name, "type": "framing"}
            export_progress[export_id] = init_data
            await manager.send_progress(export_id, init_data)

            # Create progress callback for real-time updates
            async def modal_progress_callback(progress: float, message: str):
                progress_data = {
                    "progress": progress,
                    "message": message,
                    "status": "processing",
                    "projectId": project_id,
                    "projectName": project_name,
                    "type": "framing"
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
                    logger.info(f"[Render] Stored modal_call_id: {modal_call_id}")
                except Exception as e:
                    logger.warning(f"[Render] Failed to store modal_call_id: {e}")

            # Call Modal function with progress callback
            modal_result = await call_modal_framing_ai(
                job_id=export_id,
                user_id=user_id,
                input_key=input_key,
                output_key=output_key,
                keyframes=keyframes_dict,
                output_width=810,  # 9:16 portrait
                output_height=1440,
                fps=request.target_fps,
                segment_data=segment_data,
                video_duration=source_duration,
                progress_callback=modal_progress_callback,
                call_id_callback=store_modal_call_id,
            )

            if modal_result.get("status") != "success":
                raise HTTPException(
                    status_code=500,
                    detail={"error": "modal_failed", "message": modal_result.get("error", "Modal processing failed")}
                )

            logger.info(f"[Render] Modal AI upscaling complete: {modal_result}")

            # Update progress
            dl_data = {"progress": 92, "message": "Downloading result...", "status": "processing", "projectId": project_id, "projectName": project_name, "type": "framing"}
            export_progress[export_id] = dl_data
            await manager.send_progress(export_id, dl_data)

            # Download output to get duration for DB
            if not download_from_r2(user_id, output_key, Path(output_path)):
                logger.warning("[Render] Could not download output to measure duration")
                video_duration = 0.0
            else:
                video_duration = get_video_duration(output_path)
                logger.info(f"[Render] Video duration: {video_duration:.2f}s")

        else:
            # Use local GPU (development)
            logger.info(f"[Render] Using local GPU for AI upscaling")

            input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex[:8]}.mp4")

            if not download_from_r2(user_id, input_key, Path(input_path)):
                raise HTTPException(
                    status_code=500,
                    detail={"error": "video_not_found", "message": f"Failed to download source video from storage"}
                )

            logger.info(f"[Render] Downloaded source video to {input_path}")

            # Step 5: Run the local upscaler
            if AIVideoUpscaler is None:
                raise HTTPException(
                    status_code=503,
                    detail={"error": "ai_not_available", "message": "AI upscaling dependencies not installed"}
                )

            upscaler = AIVideoUpscaler(
                device='cuda',
                export_mode=request.export_mode,
                enable_source_preupscale=False,
                enable_diffusion_sr=False,
                sr_model_name='realesr_general_x4v3'
            )

            if upscaler.upsampler is None:
                raise HTTPException(
                    status_code=503,
                    detail={"error": "ai_not_available", "message": "AI SR model failed to load"}
                )

            # Capture event loop for progress callbacks
            loop = asyncio.get_running_loop()

            # Progress ranges
            if request.export_mode == "FAST":
                progress_ranges = {
                    'ai_upscale': (15, 95),
                    'ffmpeg_encode': (95, 100)
                }
            else:
                progress_ranges = {
                    'ai_upscale': (15, 30),
                    'ffmpeg_pass1': (30, 85),
                    'ffmpeg_encode': (85, 100)
                }

            def progress_callback(current, total, message, phase='ai_upscale'):
                if phase not in progress_ranges:
                    phase = 'ai_upscale'
                start_percent, end_percent = progress_ranges[phase]
                phase_progress = (current / total) if total > 0 else 0
                overall_percent = start_percent + (phase_progress * (end_percent - start_percent))

                progress_data = {
                    "progress": overall_percent,
                    "message": message,
                    "status": "processing",
                    "current": current,
                    "total": total,
                    "phase": phase,
                    "projectId": project_id,
                    "projectName": project_name,
                    "type": "framing"
                }
                export_progress[export_id] = progress_data
                logger.info(f"[Render] Progress: {overall_percent:.1f}% - {message}")

                try:
                    asyncio.run_coroutine_threadsafe(
                        manager.send_progress(export_id, progress_data),
                        loop
                    )
                except Exception as e:
                    logger.error(f"[Render] Failed to send WebSocket update: {e}")

            # Update progress
            init_data = {"progress": 15, "message": "Processing video with AI upscaler...", "status": "processing", "projectId": project_id, "projectName": project_name, "type": "framing"}
            export_progress[export_id] = init_data
            await manager.send_progress(export_id, init_data)

            # Run upscaling
            result = await asyncio.to_thread(
                upscaler.process_video_with_upscale,
                input_path=input_path,
                output_path=output_path,
                keyframes=keyframes_dict,
                target_fps=request.target_fps,
                export_mode=request.export_mode,
                progress_callback=progress_callback,
                segment_data=segment_data,
                include_audio=request.include_audio,
            )

            logger.info(f"[Render] Local AI upscaling complete. Output: {output_path}")

            # Get video duration for cost-optimized GPU selection in overlay mode
            video_duration = get_video_duration(output_path)
            logger.info(f"[Render] Video duration: {video_duration:.2f}s")

            # Upload to R2
            if not upload_to_r2(user_id, output_key, Path(output_path)):
                raise Exception("Failed to upload working video to R2")
            logger.info(f"[Render] Uploaded working video to R2: {working_filename}")

        # CRITICAL: Restore user context after long-running task
        set_current_user_id(captured_user_id)
        logger.info(f"[Render] Restored user context: {captured_user_id}")

        # Step 6: Save to database
        working_video_id = None

        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Get next version number
            cursor.execute("""
                SELECT COALESCE(MAX(version), 0) + 1 as next_version
                FROM working_videos WHERE project_id = ?
            """, (project_id,))
            next_version = cursor.fetchone()['next_version']

            # Reset final_video_id (framing changed, need to re-export overlay)
            cursor.execute("UPDATE projects SET final_video_id = NULL WHERE id = ?", (project_id,))

            # Create working_videos record with duration
            cursor.execute("""
                INSERT INTO working_videos (project_id, filename, version, duration)
                VALUES (?, ?, ?, ?)
            """, (project_id, working_filename, next_version, video_duration if video_duration > 0 else None))
            working_video_id = cursor.lastrowid

            # Update project with new working_video_id
            cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))

            # Update export_jobs record to complete
            cursor.execute("""
                UPDATE export_jobs SET status = 'complete', output_video_id = ?, output_filename = ?, completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (working_video_id, working_filename, export_id))

            # Set exported_at for working clips
            cursor.execute(f"""
                UPDATE working_clips SET exported_at = datetime('now')
                WHERE project_id = ? AND id IN ({latest_working_clips_subquery()})
            """, (project_id, project_id))

            conn.commit()
            logger.info(f"[Render] Created working video {working_video_id} for project {project_id}")

        # Send complete progress
        complete_data = {
            "progress": 100,
            "message": "Export complete!",
            "status": "complete",
            "projectId": project_id,
            "projectName": project_name,
            "type": "framing",
            "workingVideoId": working_video_id,
            "workingFilename": working_filename
        }
        export_progress[export_id] = complete_data
        await manager.send_progress(export_id, complete_data)

        return JSONResponse({
            'success': True,
            'working_video_id': working_video_id,
            'filename': working_filename,
            'project_id': project_id,
            'export_id': export_id
        })

    except HTTPException as e:
        # Extract error message from HTTPException
        error_msg = str(e.detail) if hasattr(e, 'detail') else str(e)
        logger.error(f"[Render] HTTPException: {error_msg}")

        # Update export_jobs record to error
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
        error_data = {
            "progress": 0,
            "message": f"Export failed: {error_msg}",
            "status": "error",
            "projectId": project_id,
            "projectName": project_name,
            "type": "framing"
        }
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        raise  # Re-raise the HTTPException

    except Exception as e:
        logger.error(f"[Render] Failed: {str(e)}", exc_info=True)

        # Update export_jobs record to error
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
            "message": f"Export failed: {str(e)}",
            "status": "error",
            "projectId": project_id,
            "projectName": project_name,
            "type": "framing"
        }
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        raise HTTPException(status_code=500, detail=f"Render failed: {str(e)}")

    finally:
        # Cleanup temp files
        import shutil
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Render] Cleanup failed: {cleanup_error}")
