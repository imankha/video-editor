"""
Export endpoints for the Video Editor API.

This router handles all video export operations:
- /api/export/crop - Basic crop export
- /api/export/upscale - AI upscale export
- /api/export/upscale-comparison - Comparison export with multiple models
- /api/export/overlay - Overlay-only export
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from datetime import datetime
from pathlib import Path
from typing import List
import json
import os
import tempfile
import uuid
import asyncio
import subprocess
import logging
import ffmpeg

from ..models import CropKeyframe, HighlightKeyframe
from ..websocket import export_progress, manager
from ..interpolation import generate_crop_filter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/export", tags=["export"])

# AI upscaler will be imported on-demand to avoid import errors
AIVideoUpscaler = None
try:
    from app.ai_upscaler import AIVideoUpscaler as _AIVideoUpscaler
    AIVideoUpscaler = _AIVideoUpscaler
except ImportError:
    logger.warning("AI upscaler dependencies not installed")


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
                "phase": phase
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
        init_data = {"progress": 10, "message": "Initializing AI upscaler...", "status": "processing"}
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

        # Complete
        complete_data = {"progress": 100, "message": "Export complete!", "status": "complete"}
        export_progress[export_id] = complete_data
        await manager.send_progress(export_id, complete_data)

        return FileResponse(
            output_path,
            media_type='video/mp4',
            filename=f"upscaled_{video.filename}",
            background=None
        )

    except Exception as e:
        logger.error(f"AI upscaling failed: {str(e)}", exc_info=True)
        error_data = {"progress": 0, "message": f"Export failed: {str(e)}", "status": "error"}
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        if os.path.exists(temp_dir):
            import shutil
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=f"AI upscaling failed: {str(e)}")


@router.post("/overlay")
async def export_overlay_only(
    video: UploadFile = File(...),
    export_id: str = Form(...),
    highlight_keyframes_json: str = Form(None),
    highlight_effect_type: str = Form("original"),
):
    """
    Export video with highlight overlays ONLY - no cropping, no AI upscaling.

    This is a fast export for Overlay mode where the video has already been
    cropped/trimmed during Framing export.

    Audio from input video is always preserved (audio settings are handled in framing export).
    """
    import cv2
    from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator

    # Initialize progress
    export_progress[export_id] = {
        "progress": 5,
        "message": "Starting overlay export...",
        "status": "processing"
    }

    logger.info(f"[Overlay Export] Effect type: {highlight_effect_type}")

    # Parse highlight keyframes
    highlight_keyframes = []
    if highlight_keyframes_json:
        try:
            highlight_data = json.loads(highlight_keyframes_json)
            highlight_keyframes = [
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
            logger.info(f"[Overlay Export] Received {len(highlight_keyframes)} highlight keyframes:")
            for i, kf in enumerate(highlight_keyframes):
                logger.info(f"  Keyframe {i}: time={kf['time']:.3f}s, pos=({kf['x']:.1f}, {kf['y']:.1f}), radius=({kf['radiusX']:.1f}, {kf['radiusY']:.1f})")
        except (json.JSONDecodeError, KeyError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight keyframes JSON: {str(e)}")

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"overlay_{uuid.uuid4().hex}.mp4")
    frames_dir = os.path.join(temp_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    try:
        # Save uploaded file
        with open(input_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        # Update progress
        progress_data = {"progress": 10, "message": "Processing video...", "status": "processing"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        # Open video
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Could not open video file")

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        logger.info(f"[Overlay Export] Video: {width}x{height} @ {fps}fps, {frame_count} frames")

        # Fast path: no highlights
        if not highlight_keyframes:
            cap.release()
            logger.info("[Overlay Export] No highlights - copying video directly")
            import shutil
            shutil.copy(input_path, output_path)

            progress_data = {"progress": 100, "message": "Export complete!", "status": "complete"}
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            return FileResponse(
                output_path,
                media_type='video/mp4',
                filename=f"overlay_{video.filename}",
                background=None
            )

        # Process frames with highlights
        original_size = (width, height)
        frame_idx = 0

        # Log video duration vs keyframe times for debugging
        video_duration = frame_count / fps
        if highlight_keyframes:
            first_kf_time = highlight_keyframes[0]['time']
            last_kf_time = highlight_keyframes[-1]['time']
            logger.info(f"[Overlay Export] Video duration: {video_duration:.3f}s, Keyframe range: {first_kf_time:.3f}s - {last_kf_time:.3f}s")

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current_time = frame_idx / fps
            highlight = KeyframeInterpolator.interpolate_highlight(highlight_keyframes, current_time)

            # Log first 5 frames and every 30th frame for debugging
            if frame_idx < 5 or frame_idx % 30 == 0:
                if highlight:
                    logger.info(f"[Overlay Export] Frame {frame_idx} (t={current_time:.3f}s): highlight at ({highlight['x']:.1f}, {highlight['y']:.1f})")
                else:
                    logger.info(f"[Overlay Export] Frame {frame_idx} (t={current_time:.3f}s): NO highlight (interpolate returned None)")

            if highlight is not None:
                frame = KeyframeInterpolator.render_highlight_on_frame(
                    frame,
                    highlight,
                    original_size,
                    crop=None,
                    effect_type=highlight_effect_type
                )

            frame_path = os.path.join(frames_dir, f"frame_{frame_idx:06d}.png")
            cv2.imwrite(frame_path, frame)
            frame_idx += 1

            if frame_idx % 30 == 0:
                progress = 10 + int((frame_idx / frame_count) * 70)
                progress_data = {
                    "progress": progress,
                    "message": f"Processing frame {frame_idx}/{frame_count}...",
                    "status": "processing"
                }
                export_progress[export_id] = progress_data
                await manager.send_progress(export_id, progress_data)

        cap.release()
        logger.info(f"[Overlay Export] Processed {frame_idx} frames")

        # Encode with FFmpeg
        progress_data = {"progress": 80, "message": "Encoding video...", "status": "processing"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        # Always preserve audio from input video (audio settings handled in framing export)
        ffmpeg_cmd = [
            'ffmpeg', '-y',
            '-framerate', str(fps),
            '-i', os.path.join(frames_dir, 'frame_%06d.png'),
            '-i', input_path,
            '-map', '0:v',
            '-map', '1:a?',  # Map audio from input if present
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '18',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'copy',  # Copy audio codec (no re-encoding)
            output_path
        ]

        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"[Overlay Export] FFmpeg error: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"FFmpeg encoding failed: {result.stderr}")

        # Complete
        progress_data = {"progress": 100, "message": "Export complete!", "status": "complete"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        def cleanup_temp_dir():
            import shutil
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)

        return FileResponse(
            output_path,
            media_type='video/mp4',
            filename=f"overlay_{video.filename}",
            background=BackgroundTask(cleanup_temp_dir)
        )

    except HTTPException:
        import shutil
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        raise
    except Exception as e:
        logger.error(f"[Overlay Export] Failed: {str(e)}", exc_info=True)
        error_data = {"progress": 0, "message": f"Export failed: {str(e)}", "status": "error"}
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)
        import shutil
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=f"Overlay export failed: {str(e)}")


# Note: The upscale-comparison endpoint is intentionally omitted from this refactor
# as it's a specialized debugging endpoint that adds significant complexity.
# It can be added later if needed by copying from the original main.py.
