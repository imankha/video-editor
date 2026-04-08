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

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
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
from ...storage import generate_presigned_url, generate_presigned_url_global, upload_to_r2, upload_bytes_to_r2, download_from_r2, download_from_r2_with_progress
from ...services.ffmpeg_service import get_video_duration, get_video_info
from ...services.modal_client import modal_enabled, call_modal_clips_ai, call_modal_detect_players_batch
from ...highlight_transform import get_output_duration
from .multi_clip import (
    run_player_detection_for_highlights,
    generate_default_highlight_regions,
)
from ...constants import ExportStatus, DEFAULT_HIGHLIGHT_EFFECT, normalize_effect_type
from pydantic import BaseModel
from typing import Optional
import time as time_module
from ...user_context import get_current_user_id, set_current_user_id
from ...profile_context import get_current_profile_id, set_current_profile_id

logger = logging.getLogger(__name__)


def convert_segment_data_to_encoder_format(segment_data: dict) -> dict:
    """
    Convert frontend segment format to encoder format.

    Frontend format (from database):
        {"boundaries": [...], "segmentSpeeds": {"2": 0.5}, "trimRange": {"start": ..., "end": ...}}

    Encoder format (expected by video_encoder.py):
        {"segments": [{start, end, speed}, ...], "trim_start": ..., "trim_end": ...}

    This conversion ensures slowdowns and trims are applied correctly in the final output.
    """
    if not segment_data:
        return None

    result = {}

    # Convert trimRange to trim_start/trim_end
    trim_range = segment_data.get('trimRange')
    if trim_range:
        result['trim_start'] = trim_range.get('start', 0)
        result['trim_end'] = trim_range.get('end')

    # Convert boundaries + segmentSpeeds to segments array
    boundaries = segment_data.get('boundaries', [])
    speeds = segment_data.get('segmentSpeeds', {})

    if len(boundaries) >= 2:
        segments = []
        for i in range(len(boundaries) - 1):
            segments.append({
                'start': boundaries[i],
                'end': boundaries[i + 1],
                'speed': speeds.get(str(i), 1.0)
            })
        if segments:
            result['segments'] = segments
            logger.info(f"[convert_segment_data] Converted {len(segments)} segments: {segments}")

    return result if result else None


def log_progress_event(job_id: str, phase: str, elapsed: float = None, extra: dict = None):
    """Log structured progress event for timing analysis."""
    parts = [f"[Progress Event] job={job_id} phase={phase}"]
    if elapsed is not None:
        parts.append(f"elapsed={elapsed:.2f}s")
    if extra:
        for key, val in extra.items():
            parts.append(f"{key}={val}")
    logger.info(" ".join(parts))

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

        # Get existing overlay data from current working video to carry forward
        cursor.execute("""
            SELECT wv.highlights_data, wv.effect_type
            FROM projects p
            LEFT JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.id = ?
        """, (project_id,))
        existing = cursor.fetchone()
        existing_highlights = existing['highlights_data'] if existing else None
        existing_effect_type = normalize_effect_type(existing['effect_type']) if existing else DEFAULT_HIGHLIGHT_EFFECT.value

        # Reset final_video_id since framing changed (user needs to re-export from overlay)
        cursor.execute("""
            UPDATE projects SET final_video_id = NULL WHERE id = ?
        """, (project_id,))
        logger.info(f"[Framing Export] Reset final_video_id due to framing change")

        # Create new working video entry with version number and duration (carry forward overlay data)
        cursor.execute("""
            INSERT INTO working_videos (project_id, filename, version, duration, highlights_data, effect_type)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (project_id, filename, next_version, video_duration if video_duration > 0 else None, existing_highlights, existing_effect_type))
        working_video_id = cursor.lastrowid

        # Update project with new working video ID
        cursor.execute("""
            UPDATE projects SET working_video_id = ? WHERE id = ?
        """, (working_video_id, project_id))

        # Set exported_at and snapshot current boundaries_version for all working clips (latest versions only)
        cursor.execute(f"""
            UPDATE working_clips
            SET exported_at = datetime('now'),
                raw_clip_version = (SELECT COALESCE(rc.boundaries_version, 1) FROM raw_clips rc WHERE rc.id = working_clips.raw_clip_id)
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
                    SET exported_at = datetime('now'),
                        raw_clip_version = (SELECT COALESCE(rc.boundaries_version, 1) FROM raw_clips rc WHERE rc.id = working_clips.raw_clip_id)
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


async def _run_local_framing_export(
    export_id: str,
    project_id: int,
    project_name: str,
    captured_user_id: str,
    captured_profile_id: str,
    user_id: str,
    clip: dict,
    target_fps: int,
    include_audio: bool,
    export_mode: str,
    working_filename: str,
    credits_deducted: int,
    video_seconds: float,
):
    """
    T760: Run framing export in background when Modal is disabled.

    This is the same processing logic as the Modal/test path in render_project(),
    but runs as an asyncio.create_task so the HTTP response returns immediately.
    All progress is reported via WebSocket. Errors refund credits and update export_jobs.

    Crop parsing, ffprobe (framerate), and keyframe conversion are done here
    (moved out of the synchronous request path for faster 202 response).
    """
    temp_dir = tempfile.mkdtemp()
    output_key = f"working_videos/{working_filename}"
    output_path = os.path.join(temp_dir, working_filename)

    try:
        from app.services.export_helpers import send_progress, create_progress_callback
        from app.services.modal_client import call_modal_framing_ai

        logger.info(f"[Render Background] Starting local export for project {project_id}")

        # Restore user context for the background task
        set_current_user_id(captured_user_id)
        set_current_profile_id(captured_profile_id)

        # --- Crop parsing (moved from synchronous path) ---
        crop_keyframes = json.loads(clip['crop_data'])
        segment_data_raw = None
        segment_data = None
        if clip['segments_data']:
            try:
                segment_data_raw = json.loads(clip['segments_data'])
                segment_data = convert_segment_data_to_encoder_format(segment_data_raw)
            except (json.JSONDecodeError, TypeError):
                logger.warning(f"[Render Background] Invalid segments_data, ignoring")

        # --- ffprobe for framerate (the big bottleneck, ~4s on R2 URLs) ---
        framerate = 30.0
        try:
            if clip['game_id']:
                source_url = generate_presigned_url_global(f"games/{clip['game_blake3_hash']}.mp4")
            else:
                source_url = generate_presigned_url(user_id, f"raw_clips/{clip['raw_filename']}")
            if source_url:
                source_info = get_video_info(source_url)
                framerate = source_info.get('fps', 30.0)
        except Exception as e:
            logger.warning(f"[Render Background] Failed to probe framerate, using 30: {e}")
        logger.info(f"[Render Background] ffprobe done, fps={framerate}")

        # --- Keyframe frame→time conversion ---
        if crop_keyframes and 'frame' in crop_keyframes[0] and 'time' not in crop_keyframes[0]:
            crop_keyframes = [
                {'time': kf['frame'] / framerate, 'x': kf['x'], 'y': kf['y'], 'width': kf['width'], 'height': kf['height']}
                for kf in crop_keyframes
            ]

        keyframes_dict = [
            {'time': kf.get('time', 0), 'x': kf['x'], 'y': kf['y'], 'width': kf['width'], 'height': kf['height']}
            for kf in crop_keyframes
        ]

        # --- Input/output keys ---
        if clip['game_id']:
            input_key = f"games/{clip['game_blake3_hash']}.mp4"
        else:
            input_key = f"raw_clips/{clip['raw_filename']}"

        logger.info(f"[Render Background] crop/keyframe parsing done, dispatching render")

        # Calculate effective output duration for progress estimation
        source_duration = clip.get('raw_duration') or 0
        effective_duration = 10.0
        if segment_data_raw:
            effective_duration = get_output_duration(segment_data_raw, source_duration)
            logger.info(f"[Render Background] Calculated output duration: {effective_duration:.2f}s")

        await send_progress(
            export_id, 10, 100, 'init', 'Starting export...',
            'framing', project_id=project_id, project_name=project_name
        )

        progress_callback = create_progress_callback(
            export_id, 'framing',
            project_id=project_id, project_name=project_name
        )

        result = await call_modal_framing_ai(
            job_id=export_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            keyframes=keyframes_dict,
            output_width=810,
            output_height=1440,
            fps=target_fps,
            segment_data=segment_data,
            video_duration=effective_duration,
            progress_callback=progress_callback,
            include_audio=include_audio,
            export_mode=export_mode,
            test_mode=False,
            source_start_time=clip['raw_start_time'] if clip['game_id'] else 0.0,
            source_end_time=clip['raw_end_time'] if clip['game_id'] else clip['raw_duration'],
        )

        if result.get("status") != "success":
            raise RuntimeError(result.get("error", "AI processing failed"))

        logger.info(f"[Render Background] Export complete: {result}")

        await send_progress(
            export_id, 92, 100, 'finalizing', 'Finalizing...',
            'framing', project_id=project_id, project_name=project_name
        )

        if not download_from_r2(user_id, output_key, Path(output_path)):
            logger.warning("[Render Background] Could not download output to measure duration")
            video_duration = 0.0
        else:
            video_duration = get_video_duration(output_path)
            logger.info(f"[Render Background] Video duration: {video_duration:.2f}s")

        # Restore user context again after long-running processing
        set_current_user_id(captured_user_id)
        set_current_profile_id(captured_profile_id)

        # Run player detection for overlay keyframes
        source_clips = [{
            'clip_index': 0,
            'start_time': 0.0,
            'end_time': video_duration,
            'duration': video_duration,
            'name': clip['clip_name'] or 'Clip 1',
        }]

        async def detection_progress_callback(progress: float, message: str, phase: str = "detecting_players"):
            progress_data = {
                "progress": progress,
                "message": message,
                "status": "processing",
                "phase": phase,
                "projectId": project_id,
                "projectName": project_name,
                "type": "framing"
            }
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

        logger.info(f"[Render Background] Starting player detection: user_id={user_id}, output_key={output_key}")
        highlight_regions = await run_player_detection_for_highlights(
            user_id=user_id,
            output_key=output_key,
            source_clips=source_clips,
            progress_callback=detection_progress_callback,
        )

        highlights_json = json.dumps(highlight_regions)

        # Save to database
        working_video_id = None
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT COALESCE(MAX(version), 0) + 1 as next_version
                FROM working_videos WHERE project_id = ?
            """, (project_id,))
            next_version = cursor.fetchone()['next_version']

            cursor.execute("UPDATE projects SET final_video_id = NULL WHERE id = ?", (project_id,))

            cursor.execute("""
                INSERT INTO working_videos (project_id, filename, version, duration, highlights_data)
                VALUES (?, ?, ?, ?, ?)
            """, (project_id, working_filename, next_version, video_duration if video_duration > 0 else None, highlights_json))
            working_video_id = cursor.lastrowid

            cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))

            cursor.execute("""
                UPDATE export_jobs SET status = 'complete', output_video_id = ?, output_filename = ?,
                    completed_at = CURRENT_TIMESTAMP, gpu_seconds = ?, modal_function = ?
                WHERE id = ?
            """, (working_video_id, working_filename, result.get("gpu_seconds"), result.get("modal_function"), export_id))

            cursor.execute(f"""
                UPDATE working_clips
                SET exported_at = datetime('now'),
                    raw_clip_version = (SELECT COALESCE(rc.boundaries_version, 1) FROM raw_clips rc WHERE rc.id = working_clips.raw_clip_id)
                WHERE project_id = ? AND id IN ({latest_working_clips_subquery()})
            """, (project_id, project_id))

            conn.commit()
            logger.info(f"[Render Background] Created working video {working_video_id} for project {project_id}")

        # Send complete progress via WebSocket
        complete_data = {
            "progress": 100,
            "message": "Export complete!",
            "status": ExportStatus.COMPLETE,
            "projectId": project_id,
            "projectName": project_name,
            "type": "framing",
            "workingVideoId": working_video_id,
            "workingFilename": working_filename
        }
        export_progress[export_id] = complete_data
        await manager.send_progress(export_id, complete_data)

    except Exception as e:
        logger.error(f"[Render Background] Failed: {str(e)}", exc_info=True)

        # Refund credits on failure
        if credits_deducted > 0:
            from ...services.user_db import refund_credits
            refund_credits(captured_user_id, credits_deducted, export_id, video_seconds)
            logger.info(f"[Render Background] Refunded {credits_deducted} credits to {captured_user_id}")

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

        # Send error via WebSocket
        from app.websocket import make_progress_data
        error_data = make_progress_data(
            current=0, total=100, phase='error',
            message=f"Export failed: {str(e)}",
            export_type='framing',
            project_id=project_id, project_name=project_name,
        )
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

    finally:
        import shutil
        import time as time_mod
        time_mod.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Render Background] Cleanup failed: {cleanup_error}")


@router.post("/render")
async def render_project(request: RenderRequest, http_request: Request):
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

    # CRITICAL: Capture user + profile ID at the start of the request (see /upscale endpoint for explanation)
    captured_user_id = get_current_user_id()
    captured_profile_id = get_current_profile_id()

    logger.info(f"[Render] START render project={project_id}, user={captured_user_id}")

    # Initialize progress tracking
    export_progress[export_id] = {
        "progress": 5,
        "message": "Validating project...",
        "status": "processing"
    }

    # T890: Regress status + create export_jobs in single atomic transaction
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE projects SET working_video_id = NULL, final_video_id = NULL WHERE id = ?", (project_id,))
            cursor.execute("""
                INSERT INTO export_jobs (id, project_id, type, status, input_data)
                VALUES (?, ?, 'framing', 'processing', '{}')
            """, (export_id, project_id))
            conn.commit()
        logger.info(f"[Render] export_jobs INSERT committed")
        # Notify frontend that export job exists so quest progress can refresh
        await manager.send_progress(export_id, {
            "progress": 5,
            "message": "Starting export...",
            "status": "processing"
        })
    except Exception as e:
        logger.warning(f"[Render] export_jobs INSERT FAILED: {e}")

    # Step 1: Validate project and get working_clips
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, aspect_ratio
            FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        from app.services.export_helpers import derive_project_name
        project_name = derive_project_name(project_id, cursor) or project['name']

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
                rc.name as clip_name,
                rc.game_id,
                rc.start_time as raw_start_time,
                rc.end_time as raw_end_time,
                (rc.end_time - rc.start_time) as raw_duration,
                g.blake3_hash as game_blake3_hash
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            LEFT JOIN games g ON rc.game_id = g.id
            WHERE wc.project_id = ?
            AND wc.id IN ({latest_working_clips_subquery()})
            ORDER BY wc.sort_order
        """, (project_id, project_id))
        working_clips = cursor.fetchall()
    logger.info(f"[Render] project validated, {len(working_clips)} clip(s)")

    if not working_clips:
        from app.websocket import make_progress_data
        error_data = make_progress_data(
            current=0, total=100, phase='error',
            message="Project has no clips to export. Add clips first.",
            export_type='framing',
            project_id=project_id, project_name=project_name,
        )
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

    # T530: Credit check — deduct before GPU dispatch, refund on failure
    import math
    from ...services.user_db import reserve_credits, confirm_reservation, release_reservation

    source_duration = clip['raw_duration'] or 0
    segments_raw = None
    if clip['segments_data']:
        try:
            segments_raw = json.loads(clip['segments_data'])
        except (json.JSONDecodeError, TypeError):
            pass
    video_seconds = get_output_duration(segments_raw, source_duration) if source_duration else source_duration
    credits_required = math.ceil(video_seconds) if video_seconds > 0 else 0
    credits_deducted = 0

    # T890: Reserve credits (atomic in user.sqlite), confirm after export_jobs created
    if credits_required > 0:
        credit_result = reserve_credits(
            captured_user_id, credits_required, export_id, video_seconds
        )
        if not credit_result["success"]:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_credits",
                    "required": credits_required,
                    "available": credit_result["balance"],
                    "video_seconds": video_seconds,
                },
            )
        # Reservation created — export_jobs already created above in atomic transaction
        # Confirm the reservation (moves from reserved to deducted in credit_transactions)
        try:
            confirm_reservation(captured_user_id, export_id)
        except Exception:
            release_reservation(captured_user_id, export_id)
            raise
        credits_deducted = credits_required
    logger.info(f"[Render] credits reserved ({credits_deducted})")

    # Step 2: Validate clip has required data (fast checks — keep synchronous)
    if not clip['crop_data']:
        error_msg = f"Clip '{clip['clip_name'] or 'Unknown'}' has no framing data. Open clip in Framing mode first."
        raise HTTPException(
            status_code=400,
            detail={"error": "missing_crop_data", "message": error_msg, "clip_id": clip['id']}
        )

    if not clip['game_id'] and not clip['raw_filename']:
        raise HTTPException(
            status_code=400,
            detail={"error": "no_source_video", "message": "Clip has no source video (no game_id and no raw_filename)"}
        )

    # Quick JSON parse check (no ffprobe, no keyframe conversion — that moves to background)
    try:
        json.loads(clip['crop_data'])
    except (json.JSONDecodeError, TypeError) as e:
        raise HTTPException(status_code=500, detail=f"Invalid crop_data in database: {e}")

    logger.info(f"[Render] validation done, dispatching background task")

    # Check for E2E test mode
    is_test_mode = http_request.headers.get('X-Test-Mode', '').lower() == 'true'

    # Generate output filename
    working_filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"

    # T760: When Modal is disabled, run processing in background to avoid blocking the server
    # Crop parsing, ffprobe, and keyframe conversion all happen inside the background task.
    if not modal_enabled() and not is_test_mode:
        asyncio.create_task(
            _run_local_framing_export(
                export_id=export_id,
                project_id=project_id,
                project_name=project_name,
                captured_user_id=captured_user_id,
                captured_profile_id=captured_profile_id,
                user_id=get_current_user_id(),
                clip=dict(clip),
                target_fps=request.target_fps,
                include_audio=request.include_audio,
                export_mode=request.export_mode,
                working_filename=working_filename,
                credits_deducted=credits_deducted,
                video_seconds=video_seconds,
            )
        )
        logger.info(f"[Render] returning 202")
        return JSONResponse(
            status_code=202,
            content={"status": "accepted", "export_id": export_id}
        )

    # --- Modal or test-mode path: process synchronously (keeps existing behavior) ---

    # Parse crop/segment data
    crop_keyframes = json.loads(clip['crop_data'])
    segment_data_raw = None
    segment_data = None
    if clip['segments_data']:
        try:
            segment_data_raw = json.loads(clip['segments_data'])
            segment_data = convert_segment_data_to_encoder_format(segment_data_raw)
        except (json.JSONDecodeError, TypeError):
            logger.warning(f"[Render] Invalid segments_data, ignoring")

    # ffprobe for framerate
    framerate = 30.0
    try:
        user_id = get_current_user_id()
        if clip['game_id']:
            source_url = generate_presigned_url_global(f"games/{clip['game_blake3_hash']}.mp4")
        else:
            source_url = generate_presigned_url(user_id, f"raw_clips/{clip['raw_filename']}")
        if source_url:
            source_info = get_video_info(source_url)
            framerate = source_info.get('fps', 30.0)
    except Exception as e:
        logger.warning(f"[Render] Failed to probe source video framerate, using default 30: {e}")

    if crop_keyframes and 'frame' in crop_keyframes[0] and 'time' not in crop_keyframes[0]:
        crop_keyframes = [
            {'time': kf['frame'] / framerate, 'x': kf['x'], 'y': kf['y'], 'width': kf['width'], 'height': kf['height']}
            for kf in crop_keyframes
        ]

    try:
        keyframes = [CropKeyframe(**kf) for kf in crop_keyframes]
    except Exception as e:
        raise HTTPException(status_code=400, detail={"error": "invalid_crop_format", "message": f"Invalid crop keyframe format: {e}"})
    if len(keyframes) == 0:
        raise HTTPException(status_code=400, detail="No crop keyframes found in saved data")

    # Update progress
    progress_data = {"progress": 10, "message": "Downloading source video...", "status": "processing", "projectId": project_id, "projectName": project_name, "type": "framing"}
    export_progress[export_id] = progress_data
    await manager.send_progress(export_id, progress_data)

    user_id = get_current_user_id()
    if clip['game_id']:
        input_key = f"games/{clip['game_blake3_hash']}.mp4"
    else:
        input_key = f"raw_clips/{clip['raw_filename']}"

    keyframes_dict = [
        {'time': kf.time, 'x': kf.x, 'y': kf.y, 'width': kf.width, 'height': kf.height}
        for kf in keyframes
    ]

    output_key = f"working_videos/{working_filename}"
    temp_dir = tempfile.mkdtemp()
    output_path = os.path.join(temp_dir, working_filename)

    try:
        from app.services.export_helpers import send_progress, create_progress_callback
        from app.services.modal_client import call_modal_framing_ai

        logger.info(f"[Render] Starting export (Modal: {modal_enabled()}, test_mode: {is_test_mode})")

        # Calculate effective output duration for progress estimation
        # Note: get_output_duration expects raw frontend format (boundaries + segmentSpeeds)
        effective_duration = 10.0  # Default estimate
        if segment_data_raw:
            effective_duration = get_output_duration(segment_data_raw)
            logger.info(f"[Render] Calculated output duration (trim+speed): {effective_duration:.2f}s")

        # Send initial progress
        await send_progress(
            export_id, 10, 100, 'init', 'Starting export...',
            'framing', project_id=project_id, project_name=project_name
        )

        # Create progress callback for unified interface
        progress_callback = create_progress_callback(
            export_id, 'framing',
            project_id=project_id, project_name=project_name
        )

        # Call unified interface - routes to Modal, local, or mock automatically
        result = await call_modal_framing_ai(
            job_id=export_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            keyframes=keyframes_dict,
            output_width=810,  # 9:16 portrait
            output_height=1440,
            fps=request.target_fps,
            segment_data=segment_data,
            video_duration=effective_duration,
            progress_callback=progress_callback,
            include_audio=request.include_audio,
            export_mode=request.export_mode,
            test_mode=is_test_mode,
            source_start_time=clip['raw_start_time'] if clip['game_id'] else 0.0,
            source_end_time=clip['raw_end_time'] if clip['game_id'] else clip['raw_duration'],
        )

        if result.get("status") != "success":
            raise HTTPException(
                status_code=500,
                detail={"error": "processing_failed", "message": result.get("error", "AI processing failed")}
            )

        logger.info(f"[Render] Export complete: {result}")

        # Get video duration for DB (download output to measure)
        await send_progress(
            export_id, 92, 100, 'finalizing', 'Finalizing...',
            'framing', project_id=project_id, project_name=project_name
        )

        if not download_from_r2(user_id, output_key, Path(output_path)):
            logger.warning("[Render] Could not download output to measure duration")
            video_duration = 0.0
        else:
            video_duration = get_video_duration(output_path)
            logger.info(f"[Render] Video duration: {video_duration:.2f}s")

        # CRITICAL: Restore user + profile context after long-running task
        set_current_user_id(captured_user_id)
        set_current_profile_id(captured_profile_id)
        logger.info(f"[Render] Restored user context: {captured_user_id}, profile: {captured_profile_id}")

        # Step 6: Run player detection for overlay keyframes
        # Build single-clip source structure for detection
        source_clips = [{
            'clip_index': 0,
            'start_time': 0.0,
            'end_time': video_duration,
            'duration': video_duration,
            'name': clip['clip_name'] or 'Clip 1',
        }]

        if is_test_mode:
            # Skip player detection in test mode - use defaults
            logger.info(f"[Render] TEST MODE: Skipping player detection, using defaults")
            highlight_regions = generate_default_highlight_regions(source_clips)
        else:
            # Create progress callback for detection phase
            async def detection_progress_callback(progress: float, message: str, phase: str = "detecting_players"):
                progress_data = {
                    "progress": progress,
                    "message": message,
                    "status": "processing",
                    "phase": phase,
                    "projectId": project_id,
                    "projectName": project_name,
                    "type": "framing"
                }
                export_progress[export_id] = progress_data
                await manager.send_progress(export_id, progress_data)

            # Use unified detection function (Modal GPU when available, local YOLO fallback)
            # This routes to Modal on Fly.io where ultralytics isn't installed locally
            # Must use user_id (R2 prefix) so Modal can find the video in R2
            logger.info(f"[Render] Starting player detection: modal_enabled={modal_enabled()}, user_id={user_id}, output_key={output_key}")
            highlight_regions = await run_player_detection_for_highlights(
                user_id=user_id,
                output_key=output_key,
                source_clips=source_clips,
                progress_callback=detection_progress_callback,
            )
            total_detections = sum(
                len(d.get('boxes', []))
                for r in highlight_regions
                for d in r.get('detections', [])
            )
            logger.info(f"[Render] Player detection complete: {len(highlight_regions)} regions, {total_detections} total player detections")
            for i, region in enumerate(highlight_regions):
                det_count = len(region.get('detections', []))
                boxes_per_det = [len(d.get('boxes', [])) for d in region.get('detections', [])]
                logger.info(f"[Render] Region {i}: id={region.get('id')}, "
                           f"time={region.get('start_time')}-{region.get('end_time')}, "
                           f"detections={det_count}, boxes_per_det={boxes_per_det}, "
                           f"videoWidth={region.get('videoWidth')}, videoHeight={region.get('videoHeight')}")

        highlights_json = json.dumps(highlight_regions)
        logger.info(f"[Render] highlights_json length: {len(highlights_json)} chars, sample: {highlights_json[:200]}")

        # Step 7: Save to database
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

            # Create working_videos record with duration and highlights
            cursor.execute("""
                INSERT INTO working_videos (project_id, filename, version, duration, highlights_data)
                VALUES (?, ?, ?, ?, ?)
            """, (project_id, working_filename, next_version, video_duration if video_duration > 0 else None, highlights_json))
            working_video_id = cursor.lastrowid

            # Update project with new working_video_id
            cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))

            # Update export_jobs record to complete (T550: store GPU cost)
            cursor.execute("""
                UPDATE export_jobs SET status = 'complete', output_video_id = ?, output_filename = ?,
                    completed_at = CURRENT_TIMESTAMP, gpu_seconds = ?, modal_function = ?
                WHERE id = ?
            """, (working_video_id, working_filename, result.get("gpu_seconds"), result.get("modal_function"), export_id))

            # Set exported_at and snapshot current boundaries_version for working clips
            cursor.execute(f"""
                UPDATE working_clips
                SET exported_at = datetime('now'),
                    raw_clip_version = (SELECT COALESCE(rc.boundaries_version, 1) FROM raw_clips rc WHERE rc.id = working_clips.raw_clip_id)
                WHERE project_id = ? AND id IN ({latest_working_clips_subquery()})
            """, (project_id, project_id))

            conn.commit()
            logger.info(f"[Render] Created working video {working_video_id} for project {project_id}")

        # Send complete progress
        complete_data = {
            "progress": 100,
            "message": "Export complete!",
            "status": ExportStatus.COMPLETE,
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

        # T530: Refund credits on failure
        if credits_deducted > 0:
            from ...services.user_db import refund_credits
            refund_credits(captured_user_id, credits_deducted, export_id, video_seconds)
            logger.info(f"[Render] Refunded {credits_deducted} credits to {captured_user_id}")

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
        from app.websocket import make_progress_data
        error_data = make_progress_data(
            current=0, total=100, phase='error',
            message=f"Export failed: {error_msg}",
            export_type='framing',
            project_id=project_id, project_name=project_name,
        )
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        raise  # Re-raise the HTTPException

    except Exception as e:
        logger.error(f"[Render] Failed: {str(e)}", exc_info=True)

        # T530: Refund credits on failure
        if credits_deducted > 0:
            from ...services.user_db import refund_credits
            refund_credits(captured_user_id, credits_deducted, export_id, video_seconds)
            logger.info(f"[Render] Refunded {credits_deducted} credits to {captured_user_id}")

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

        from app.websocket import make_progress_data
        error_data = make_progress_data(
            current=0, total=100, phase='error',
            message=f"Export failed: {str(e)}",
            export_type='framing',
            project_id=project_id, project_name=project_name,
        )
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
