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
from ...storage import R2_ENABLED, generate_presigned_url, upload_to_r2, upload_bytes_to_r2
from ...user_context import get_current_user_id

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
                    user_id = get_current_user_id()

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

                    # Create working_videos record
                    cursor.execute("""
                        INSERT INTO working_videos (project_id, filename, version)
                        VALUES (?, ?, ?)
                    """, (project_id, working_filename, next_version))
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

        # Create new working video entry with version number
        cursor.execute("""
            INSERT INTO working_videos (project_id, filename, version)
            VALUES (?, ?, ?)
        """, (project_id, filename, next_version))
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

        # When R2 is enabled, redirect to presigned URL
        if R2_ENABLED:
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

        # Local mode: serve from filesystem
        file_path = get_working_videos_path() / result['filename']
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        return FileResponse(
            path=str(file_path),
            media_type="video/mp4",
            filename=result['filename']
        )
