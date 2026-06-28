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
from ...highlight_transform import get_output_duration, canonicalize_segments_data
from .multi_clip import ClipExportData, BytesFile, _export_clips
from ...constants import DEFAULT_HIGHLIGHT_EFFECT, normalize_effect_type
from pydantic import BaseModel
import time as time_module
from ...user_context import get_current_user_id
from ...profile_context import get_current_profile_id
from ...utils.encoding import decode_data

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

        # T4010: do NOT null final_video_id on a framing re-export. The published
        # reel stays valid until a new final actually exists; staleness is detected
        # downstream via working_video_created_at > final_video_created_at, so the
        # user is still routed to re-export overlay without losing the reference.

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
            # T4010: do NOT null working_video_id / final_video_id here. The old
            # pointers stay valid for the whole in-flight render; the success path
            # repoints working_video_id and a failure restores both (see
            # _run_render_background). The 'processing' export_jobs row below is the
            # in-progress signal -- the UI keys on it, not on a nulled pointer.
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

    # T3700 P0: a clip with no crop_data is NOT an error — the user just didn't
    # customize the frame. A centered default crop is applied at render time
    # (see _run_render_background) so a zero-effort export always succeeds.
    if not clip['game_id'] and not clip['raw_filename']:
        raise HTTPException(
            status_code=400,
            detail={"error": "no_source_video", "message": "Clip has no source video (no game_id and no raw_filename)"}
        )
    if clip['crop_data']:
        try:
            decode_data(clip['crop_data'])
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Invalid crop_data in database: {e}")

    # Credit reservation
    from ...services.user_db import reserve_credits, confirm_reservation, release_reservation

    source_duration = clip['raw_duration'] or 0
    segments_raw = None
    if clip['segments_data']:
        try:
            # Gesture-saved rows store boundaries as user splits only; rebuild
            # the full [0, ...splits, duration] list so segmentSpeeds indices
            # line up (Bug 20p)
            segments_raw = canonicalize_segments_data(
                decode_data(clip['segments_data']), source_duration
            )
        except Exception:
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

    # T760: Run the pipeline in background so the per-user write lock is
    # released immediately. Holding it for the full render blocked every
    # other write request from this user for minutes. Completion and errors
    # are reported via WebSocket (same pattern as /render-overlay).
    asyncio.create_task(_run_render_background(
        export_id=export_id,
        project_id=project_id,
        project_name=project_name,
        aspect_ratio=project['aspect_ratio'] or '9:16',
        clip=dict(clip),
        segments_raw=segments_raw,
        include_audio=request.include_audio,
        target_fps=request.target_fps,
        export_mode=request.export_mode,
        user_id=captured_user_id,
        profile_id=captured_profile_id,
        credits_deducted=credits_deducted,
        video_seconds=video_seconds,
        is_test_mode=is_test_mode,
    ))
    return JSONResponse(
        status_code=202,
        content={"status": "accepted", "export_id": export_id}
    )


async def _run_render_background(
    export_id: str,
    project_id: int,
    project_name: str,
    aspect_ratio: str,
    clip: dict,
    segments_raw: list | None,
    include_audio: bool,
    target_fps: int,
    export_mode: str,
    user_id: str,
    profile_id: str,
    credits_deducted: int,
    video_seconds: float,
    is_test_mode: bool,
):
    """Pre-extract clip source + convert frame→time keyframes, then delegate
    to _export_clips. Runs via asyncio.create_task after /render returns 202;
    all progress and errors are reported via WebSocket."""
    from ...services.export_helpers import fail_export_job, sync_export_db_to_r2

    # T4010: snapshot the pre-job pointers so a failed render restores the project
    # to exactly its prior state (the success path repoints working_video_id itself).
    prior_working_video_id = None
    prior_final_video_id = None
    try:
        with get_db_connection() as conn:
            row = conn.cursor().execute(
                "SELECT working_video_id, final_video_id FROM projects WHERE id = ?",
                (project_id,)).fetchone()
        if row:
            prior_working_video_id = row['working_video_id']
            prior_final_video_id = row['final_video_id']
    except Exception as e:
        logger.warning(f"[Render] Could not snapshot prior pointers for project {project_id}: {e}")

    temp_dir = tempfile.mkdtemp()
    pipeline_entered = False
    try:
        crop_keyframes = decode_data(clip['crop_data']) if clip['crop_data'] else []

        # ffprobe for actual fps (framing uses real fps, not default 30)
        framerate = 30.0
        source_info = {}
        try:
            if clip['game_id']:
                source_url = generate_presigned_url_global(f"games/{clip['game_blake3_hash']}.mp4")
            else:
                source_url = generate_presigned_url(user_id, f"raw_clips/{clip['raw_filename']}")
            if source_url:
                _t0 = time_module.monotonic()
                source_info = await asyncio.to_thread(get_video_info, source_url)
                logger.info(f"[Render] get_video_info took {time_module.monotonic() - _t0:.2f}s, fps={source_info.get('fps')}")
                framerate = source_info.get('fps', 30.0)
        except Exception as e:
            logger.warning(f"[Render] Failed to probe fps, using default 30: {e}")

        # T3700 P0: no crop set -> apply the named centered default so a zero-effort
        # export still produces a valid framing job (matches the editor's visible default).
        if not crop_keyframes:
            vw, vh = source_info.get('width'), source_info.get('height')
            if vw and vh:
                from ...services.default_crop import default_crop_keyframes
                total_frames = max(1, round((clip['raw_duration'] or 0) * framerate))
                crop_keyframes = default_crop_keyframes(vw, vh, aspect_ratio, total_frames)
                logger.info(f"[Render] clip {clip['id']}: no crop set, applied centered default ({aspect_ratio}, {vw}x{vh})")
            else:
                logger.warning(f"[Render] clip {clip['id']}: no crop and no source dimensions — cannot apply default crop")

        if crop_keyframes and 'frame' in crop_keyframes[0] and 'time' not in crop_keyframes[0]:
            crop_keyframes = [
                {'time': kf['frame'] / framerate, 'x': kf['x'], 'y': kf['y'], 'width': kf['width'], 'height': kf['height']}
                for kf in crop_keyframes
            ]

        # Extract clip source video
        if clip['game_id']:
            if not clip['game_blake3_hash']:
                raise RuntimeError(
                    f"Clip references game_id={clip['game_id']} but game_videos has no row for (game_id, video_sequence={clip.get('video_sequence')})",
                )
            source_key = f"games/{clip['game_blake3_hash']}.mp4"
            source_url = generate_presigned_url_global(source_key)
            clip_path = Path(temp_dir) / "clip_0.mp4"
            # T4050: trace the source-resolution decision branch. The
            # reframe-never-materializes bug bites HERE when the game's source
            # mp4 has been reclaimed/expired -- the ffmpeg extract below fails
            # (moov parse / head fetch) and the whole re-export aborts with no
            # new working video. Log the exact key so a future failing run is
            # traceable from the logs alone.
            logger.info(
                f"[ReExport] source=game project={project_id} clip={clip['id']} "
                f"raw_clip={clip['raw_clip_id']} game={clip['game_id']} "
                f"seq={clip.get('video_sequence')} key={source_key} "
                f"url_resolved={bool(source_url)} range={clip['raw_start_time']}s-{clip['raw_end_time']}s"
            )

            def _extract_clip():
                (
                    ffmpeg
                    .input(source_url, ss=clip['raw_start_time'], to=clip['raw_end_time'])
                    .output(str(clip_path), c='copy')
                    .overwrite_output()
                    .run(quiet=True)
                )
            _t0 = time_module.monotonic()
            try:
                await asyncio.to_thread(_extract_clip)
            except Exception as extract_err:
                # T4050: make the "source object missing/unreadable" branch loud
                # and unambiguous. This is the prod signature for clip 56
                # (moov parse failed / head fetch failed) -> no working video
                # produced -> draft card with no preview, nothing to republish.
                logger.error(
                    f"[ReExport] SOURCE EXTRACT FAILED project={project_id} "
                    f"clip={clip['id']} key={source_key} -- re-frame cannot render "
                    f"(reclaimed/expired game source object?). No new working "
                    f"video will be produced. err={type(extract_err).__name__}: {extract_err}"
                )
                raise
            logger.info(f"[Render] ffmpeg extract took {time_module.monotonic() - _t0:.2f}s")

            with open(clip_path, 'rb') as f:
                video_file = BytesFile(f.read())
        else:
            r2_key = f"raw_clips/{clip['raw_filename']}"
            clip_path = Path(temp_dir) / "clip_0.mp4"
            logger.info(
                f"[ReExport] source=raw_clip project={project_id} clip={clip['id']} "
                f"raw_clip={clip['raw_clip_id']} key={r2_key}"
            )
            _t0 = time_module.monotonic()
            if not await asyncio.to_thread(download_from_r2, user_id, r2_key, clip_path):
                logger.error(
                    f"[ReExport] SOURCE DOWNLOAD FAILED project={project_id} "
                    f"clip={clip['id']} key={r2_key} -- re-frame cannot render "
                    f"(missing raw clip object?). No new working video will be produced."
                )
                raise RuntimeError("Failed to download source clip from R2")
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

        logger.info(f"[Render] Delegating to _export_clips: aspect={aspect_ratio}, test_mode={is_test_mode}")

        pipeline_entered = True
        await _export_clips(
            export_id=export_id,
            clips=[clip_export],
            aspect_ratio=aspect_ratio,
            transition={'type': 'cut', 'duration': 0},
            include_audio=include_audio,
            target_fps=target_fps,
            export_mode=export_mode,
            project_id=project_id,
            project_name=project_name,
            user_id=user_id,
            profile_id=profile_id,
            credits_deducted=credits_deducted,
            total_video_seconds=video_seconds,
            is_test_mode=is_test_mode,
        )

    except Exception as e:
        # _export_clips refunds credits itself once entered; only pre-pipeline
        # failures need a refund here.
        if not pipeline_entered and credits_deducted > 0:
            from ...services.user_db import refund_credits
            refund_credits(user_id, credits_deducted, export_id, video_seconds)
            logger.info(f"[Render] Refunded {credits_deducted} credits (pre-pipeline failure)")
        logger.error(f"[Render] Background render failed: {e}", exc_info=True)

        # T4010: a failed render must leave the project exactly as before the job.
        # Restore the pointers in case the pipeline advanced working_video_id or
        # nulled final_video_id before failing -- the published reel is never lost.
        try:
            with get_db_connection() as conn:
                conn.cursor().execute(
                    "UPDATE projects SET working_video_id = ?, final_video_id = ? WHERE id = ?",
                    (prior_working_video_id, prior_final_video_id, project_id))
                conn.commit()
        except Exception as restore_err:
            logger.error(f"[Render] Failed to restore prior pointers for project {project_id}: {restore_err}")

        fail_export_job(export_id, str(e))

        # _export_clips' generic error path already sent a WS error; cover the
        # paths that didn't (pre-pipeline failures, HTTPException from pipeline).
        if export_progress.get(export_id, {}).get('status') != 'error':
            from app.websocket import make_progress_data
            error_data = make_progress_data(
                current=0, total=100, phase='error',
                message=f"Export failed: {e}",
                export_type='framing', project_id=project_id, project_name=project_name,
            )
            export_progress[export_id] = error_data
            await manager.send_progress(export_id, error_data)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        # Background tasks run outside the request middleware, so DB writes
        # (working_videos, export_jobs, refunds) must be synced explicitly.
        await asyncio.to_thread(sync_export_db_to_r2, user_id, profile_id)
