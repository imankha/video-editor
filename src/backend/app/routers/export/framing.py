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
import json
import math
import os
import shutil
import tempfile
import uuid
import asyncio
import logging
import ffmpeg

from ...models import CropKeyframe
from ...websocket import export_progress, manager
from ...interpolation import generate_crop_filter
from ...database import get_db_connection
from ...queries import latest_working_clips_subquery
from ...storage import generate_presigned_url, generate_presigned_url_global, upload_bytes_to_r2, download_from_r2
from ...services.ffmpeg_service import get_video_duration, get_video_info
from ...highlight_transform import get_output_duration
from .multi_clip import ClipExportData, BytesFile, _export_clips
from ...constants import DEFAULT_HIGHLIGHT_EFFECT, normalize_effect_type
from pydantic import BaseModel
import time as time_module
from ...user_context import get_current_user_id
from ...profile_context import get_current_profile_id

logger = logging.getLogger(__name__)

router = APIRouter()


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


@router.post("/render")
async def render_project(request: RenderRequest, http_request: Request):
    """Backend-authoritative framing export. Routes single clip through shared _export_clips pipeline."""
    project_id = request.project_id
    export_id = request.export_id
    captured_user_id = get_current_user_id()
    captured_profile_id = get_current_profile_id()

    logger.info(f"[Render] START project={project_id}, user={captured_user_id}")

    export_progress[export_id] = {"progress": 5, "message": "Validating project...", "status": "processing"}

    # Regress project status + create export_jobs atomically
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE projects SET working_video_id = NULL, final_video_id = NULL WHERE id = ?", (project_id,))
            cursor.execute("""
                INSERT INTO export_jobs (id, project_id, type, status, input_data)
                VALUES (?, ?, 'framing', 'processing', '{}')
            """, (export_id, project_id))
            conn.commit()
        await manager.send_progress(export_id, {"progress": 5, "message": "Starting export...", "status": "processing"})
    except Exception as e:
        logger.warning(f"[Render] export_jobs INSERT FAILED: {e}")

    # Query project + clips
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, aspect_ratio FROM projects WHERE id = ?", (project_id,))
        project = cursor.fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        from app.services.export_helpers import derive_project_name
        project_name = derive_project_name(project_id, cursor) or project['name']

        cursor.execute(f"""
            SELECT
                wc.id, wc.raw_clip_id, wc.uploaded_filename,
                wc.crop_data, wc.timing_data, wc.segments_data, wc.sort_order,
                rc.filename as raw_filename, rc.name as clip_name,
                rc.game_id, rc.video_sequence,
                rc.start_time as raw_start_time, rc.end_time as raw_end_time,
                (rc.end_time - rc.start_time) as raw_duration,
                COALESCE(gv.blake3_hash, g.blake3_hash) as game_blake3_hash
            FROM working_clips wc
            LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
            LEFT JOIN games g ON rc.game_id = g.id
            LEFT JOIN game_videos gv ON rc.game_id = gv.game_id AND rc.video_sequence = gv.sequence
            WHERE wc.project_id = ?
            AND wc.id IN ({latest_working_clips_subquery()})
            ORDER BY wc.sort_order
        """, (project_id, project_id))
        working_clips = cursor.fetchall()

    if not working_clips:
        from app.websocket import make_progress_data
        error_data = make_progress_data(
            current=0, total=100, phase='error',
            message="Project has no clips to export. Add clips first.",
            export_type='framing', project_id=project_id, project_name=project_name,
        )
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)
        raise HTTPException(
            status_code=400,
            detail={"error": "no_clips", "message": "Project has no clips to export. Add clips first."}
        )

    if len(working_clips) > 1:
        raise HTTPException(
            status_code=400,
            detail={"error": "multi_clip_not_supported", "message": "Multi-clip render not yet supported. Use the standard export for multi-clip projects."}
        )

    clip = working_clips[0]

    if not clip['crop_data']:
        raise HTTPException(
            status_code=400,
            detail={"error": "missing_crop_data", "message": f"Clip '{clip['clip_name'] or 'Unknown'}' has no framing data. Open clip in Framing mode first.", "clip_id": clip['id']}
        )
    if not clip['game_id'] and not clip['raw_filename']:
        raise HTTPException(
            status_code=400,
            detail={"error": "no_source_video", "message": "Clip has no source video (no game_id and no raw_filename)"}
        )
    try:
        json.loads(clip['crop_data'])
    except (json.JSONDecodeError, TypeError) as e:
        raise HTTPException(status_code=500, detail=f"Invalid crop_data in database: {e}")

    # Credit reservation
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

    if credits_required > 0:
        credit_result = reserve_credits(captured_user_id, credits_required, export_id, video_seconds)
        if not credit_result["success"]:
            raise HTTPException(
                status_code=402,
                detail={"error": "insufficient_credits", "required": credits_required, "available": credit_result["balance"], "video_seconds": video_seconds},
            )
        try:
            confirm_reservation(captured_user_id, export_id)
        except Exception:
            release_reservation(captured_user_id, export_id)
            raise
        credits_deducted = credits_required
    logger.info(f"[Render] credits reserved ({credits_deducted})")

    is_test_mode = http_request.headers.get('X-Test-Mode', '').lower() == 'true'

    # Pre-extract clip source + convert frame→time keyframes, then delegate to _export_clips
    temp_dir = tempfile.mkdtemp()
    pipeline_entered = False
    try:
        crop_keyframes = json.loads(clip['crop_data'])

        # ffprobe for actual fps (framing uses real fps, not default 30)
        framerate = 30.0
        try:
            if clip['game_id']:
                source_url = generate_presigned_url_global(f"games/{clip['game_blake3_hash']}.mp4")
            else:
                source_url = generate_presigned_url(captured_user_id, f"raw_clips/{clip['raw_filename']}")
            if source_url:
                _t0 = time_module.monotonic()
                source_info = await asyncio.to_thread(get_video_info, source_url)
                logger.info(f"[Render] get_video_info took {time_module.monotonic() - _t0:.2f}s, fps={source_info.get('fps')}")
                framerate = source_info.get('fps', 30.0)
        except Exception as e:
            logger.warning(f"[Render] Failed to probe fps, using default 30: {e}")

        if crop_keyframes and 'frame' in crop_keyframes[0] and 'time' not in crop_keyframes[0]:
            crop_keyframes = [
                {'time': kf['frame'] / framerate, 'x': kf['x'], 'y': kf['y'], 'width': kf['width'], 'height': kf['height']}
                for kf in crop_keyframes
            ]

        # Extract clip source video
        if clip['game_id']:
            if not clip['game_blake3_hash']:
                raise HTTPException(
                    status_code=500,
                    detail=f"Clip references game_id={clip['game_id']} but game_videos has no row for (game_id, video_sequence={clip.get('video_sequence')})",
                )
            source_url = generate_presigned_url_global(f"games/{clip['game_blake3_hash']}.mp4")
            clip_path = Path(temp_dir) / "clip_0.mp4"
            logger.info(f"[Render] Extracting game clip range: {clip['raw_start_time']}s - {clip['raw_end_time']}s")

            def _extract_clip():
                (
                    ffmpeg
                    .input(source_url, ss=clip['raw_start_time'], to=clip['raw_end_time'])
                    .output(str(clip_path), c='copy')
                    .overwrite_output()
                    .run(quiet=True)
                )
            _t0 = time_module.monotonic()
            await asyncio.to_thread(_extract_clip)
            logger.info(f"[Render] ffmpeg extract took {time_module.monotonic() - _t0:.2f}s")

            with open(clip_path, 'rb') as f:
                video_file = BytesFile(f.read())
        else:
            r2_key = f"raw_clips/{clip['raw_filename']}"
            clip_path = Path(temp_dir) / "clip_0.mp4"
            logger.info(f"[Render] Downloading raw clip: {r2_key}")
            _t0 = time_module.monotonic()
            if not await asyncio.to_thread(download_from_r2, captured_user_id, r2_key, clip_path):
                raise HTTPException(status_code=500, detail="Failed to download source clip from R2")
            logger.info(f"[Render] download_from_r2 took {time_module.monotonic() - _t0:.2f}s")

            with open(clip_path, 'rb') as f:
                video_file = BytesFile(f.read())

        clip_export = ClipExportData(
            clip_index=0,
            crop_keyframes=crop_keyframes,
            segments=segments_raw,
            duration=clip['raw_duration'] or 0,
            video_file=video_file,
            source_fps=framerate,
            raw_clip_id=clip['raw_clip_id'],
            game_id=clip['game_id'],
            clip_name=clip['clip_name'],
        )

        logger.info(f"[Render] Delegating to _export_clips: aspect={project['aspect_ratio'] or '9:16'}, test_mode={is_test_mode}")

        pipeline_entered = True
        return await _export_clips(
            export_id=export_id,
            clips=[clip_export],
            aspect_ratio=project['aspect_ratio'] or '9:16',
            transition={'type': 'cut', 'duration': 0},
            include_audio=request.include_audio,
            target_fps=request.target_fps,
            export_mode=request.export_mode,
            project_id=project_id,
            project_name=project_name,
            user_id=captured_user_id,
            profile_id=captured_profile_id,
            credits_deducted=credits_deducted,
            total_video_seconds=video_seconds,
            is_test_mode=is_test_mode,
        )

    except HTTPException:
        if not pipeline_entered and credits_deducted > 0:
            from ...services.user_db import refund_credits
            refund_credits(captured_user_id, credits_deducted, export_id, video_seconds)
            logger.info(f"[Render] Refunded {credits_deducted} credits (pre-pipeline failure)")
        raise
    except Exception as e:
        if not pipeline_entered and credits_deducted > 0:
            from ...services.user_db import refund_credits
            refund_credits(captured_user_id, credits_deducted, export_id, video_seconds)
            logger.info(f"[Render] Refunded {credits_deducted} credits (pre-pipeline failure)")
        logger.error(f"[Render] Failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Render failed: {str(e)}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
