"""
Multi-clip export endpoints.

This module handles exports involving multiple video clips:
- /multi-clip - Export multiple clips with transitions
- /chapters - Extract chapter markers from video
- /concat-for-overlay - Concatenate clips for overlay mode

Uses the transition strategy pattern for different transition types.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from pathlib import Path
from typing import List, Tuple, Dict, Any, Optional
import json
import os
import tempfile
import uuid
import asyncio
import logging
import ffmpeg
import shutil
import hashlib
import base64
import torch

from ...websocket import export_progress, manager
from ...services.clip_cache import get_clip_cache
from ...services.transitions import apply_transition
from ...services.clip_pipeline import process_clip_with_pipeline
from ...constants import VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT, AI_UPSCALE_FACTOR
from ...services.ffmpeg_service import get_video_duration
from ...database import get_db_connection
from ...storage import upload_to_r2, upload_bytes_to_r2, delete_from_r2, generate_presigned_url
from ...user_context import get_current_user_id, set_current_user_id
from ...services.modal_client import modal_enabled, call_modal_multi_clip

logger = logging.getLogger(__name__)

router = APIRouter()

# AI upscaler will be imported on-demand
AIVideoUpscaler = None
try:
    from app.ai_upscaler import AIVideoUpscaler as _AIVideoUpscaler
    AIVideoUpscaler = _AIVideoUpscaler
except (ImportError, OSError, AttributeError) as e:
    logger.warning(f"AI upscaler dependencies not available: {e}")


def calculate_multi_clip_resolution(
    clips_data: List[Dict[str, Any]],
    global_aspect_ratio: str
) -> Tuple[int, int]:
    """
    Calculate target resolution for all clips based on global aspect ratio.
    Uses the smallest crop dimensions across all clips to determine base size.
    """
    # Parse aspect ratio
    ratio_w, ratio_h = map(int, global_aspect_ratio.split(':'))

    # Find minimum crop size across all clips
    min_crop_width = float('inf')
    min_crop_height = float('inf')

    for clip in clips_data:
        for kf in clip.get('cropKeyframes', []):
            min_crop_width = min(min_crop_width, kf['width'])
            min_crop_height = min(min_crop_height, kf['height'])

    # Handle case where no keyframes exist
    if min_crop_width == float('inf') or min_crop_height == float('inf'):
        # Default to 1080x1920 for 9:16
        if ratio_w < ratio_h:
            return (1080, 1920)
        else:
            return (1920, 1080)

    # Calculate target resolution (upscaled, capped at max resolution)
    sr_w = int(min_crop_width * AI_UPSCALE_FACTOR)
    sr_h = int(min_crop_height * AI_UPSCALE_FACTOR)

    max_w, max_h = VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT
    scale_limit = min(max_w / sr_w, max_h / sr_h, 1.0)

    target_w = int(sr_w * scale_limit)
    target_h = int(sr_h * scale_limit)

    # Ensure even dimensions (required by most video codecs)
    target_w = target_w - (target_w % 2)
    target_h = target_h - (target_h % 2)

    return (target_w, target_h)


async def process_single_clip(
    clip_data: Dict[str, Any],
    video_file: UploadFile,
    temp_dir: str,
    target_fps: int,
    export_mode: str,
    include_audio: bool,
    progress_callback,
    loop: asyncio.AbstractEventLoop,
    upscaler=None
) -> str:
    """
    Process a single clip with its crop/trim/speed settings.
    Uses ClipProcessingPipeline to ensure correct ordering of operations.
    Uses caching to avoid re-processing unchanged clips.
    Returns path to processed clip.

    Args:
        upscaler: Optional AIVideoUpscaler instance to reuse across clips.
                  If None, a new one will be created (not recommended for multi-clip).
    """
    clip_index = clip_data['clipIndex']

    # Read video content
    video_content = await video_file.read()

    # Check AI upscaler availability
    if AIVideoUpscaler is None:
        raise HTTPException(
            status_code=503,
            detail={"error": "AI upscaling dependencies not installed"}
        )

    # Reuse provided upscaler or create a new one
    # Creating a new upscaler per clip can cause VRAM exhaustion!
    if upscaler is None:
        upscaler = AIVideoUpscaler(
            device='cuda',
            export_mode=export_mode,
            sr_model_name='realesr_general_x4v3'
        )

    if upscaler.upsampler is None:
        raise HTTPException(
            status_code=503,
            detail={"error": "AI SR model failed to load"}
        )

    # Get cache instance
    cache = get_clip_cache()

    # Use pipeline for guaranteed correct ordering of operations
    output_path = await process_clip_with_pipeline(
        clip_data=clip_data,
        video_content=video_content,
        temp_dir=temp_dir,
        target_fps=target_fps,
        export_mode=export_mode,
        include_audio=include_audio,
        cache=cache,
        upscaler=upscaler,
        progress_callback=progress_callback
    )

    return output_path


def create_chapter_metadata_file(
    clip_info: List[Dict[str, Any]],
    output_path: str
) -> str:
    """
    Create an ffmetadata file with chapter markers for each clip.

    Args:
        clip_info: List of dicts with 'name', 'start_time', 'end_time'
        output_path: Directory to write the metadata file

    Returns:
        Path to the created metadata file
    """
    metadata_path = os.path.join(os.path.dirname(output_path), 'chapters.txt')

    with open(metadata_path, 'w', encoding='utf-8') as f:
        f.write(";FFMETADATA1\n\n")

        for clip in clip_info:
            # Convert seconds to milliseconds for TIMEBASE=1/1000
            start_ms = int(clip['start_time'] * 1000)
            end_ms = int(clip['end_time'] * 1000)
            title = clip.get('name', f"Clip {clip.get('index', 0) + 1}")

            # Remove file extension from title for cleaner display
            if '.' in title:
                title = os.path.splitext(title)[0]

            f.write("[CHAPTER]\n")
            f.write("TIMEBASE=1/1000\n")
            f.write(f"START={start_ms}\n")
            f.write(f"END={end_ms}\n")
            f.write(f"title={title}\n\n")

    logger.info(f"[Chapters] Created metadata file with {len(clip_info)} chapters")
    return metadata_path


def add_chapters_to_video(
    input_path: str,
    metadata_path: str,
    output_path: str
) -> None:
    """Add chapter metadata to a video file."""
    import subprocess

    cmd = [
        'ffmpeg', '-y',
        '-i', input_path,
        '-i', metadata_path,
        '-map_metadata', '1',
        '-codec', 'copy',
        output_path
    ]

    logger.info(f"[Chapters] Adding chapters to video")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"[Chapters] Failed to add chapters: {result.stderr}")
    else:
        logger.info(f"[Chapters] Successfully added chapters")


def concatenate_clips_with_transition(
    clip_paths: List[str],
    output_path: str,
    transition: Dict[str, Any],
    include_audio: bool = True,
    clip_info: Optional[List[Dict[str, Any]]] = None
) -> None:
    """
    Concatenate processed clips with transitions and embed chapter markers.

    Uses the transition strategy pattern for different transition types.

    Args:
        clip_paths: List of paths to processed clip files
        output_path: Path for the final concatenated output
        transition: Transition settings {'type': str, 'duration': float}
        include_audio: Whether to include audio in output
        clip_info: Optional list of clip info for chapter markers
    """
    transition_type = transition.get('type', 'cut')
    transition_duration = transition.get('duration', 0.5)

    if len(clip_paths) == 1:
        # Single clip - just copy
        shutil.copy(clip_paths[0], output_path)
        return

    # Use transition strategy pattern
    success = apply_transition(
        transition_type=transition_type,
        clip_paths=clip_paths,
        output_path=output_path,
        duration=transition_duration,
        include_audio=include_audio
    )

    if not success:
        raise RuntimeError(f"Transition '{transition_type}' failed")

    # Add chapter markers if clip info is provided
    if clip_info and len(clip_info) > 1:
        try:
            # Get actual durations of processed clips
            durations = [get_video_duration(path) for path in clip_paths]

            # Calculate chapter timestamps accounting for transitions
            chapter_data = []
            current_time = 0.0

            for i, (info, dur) in enumerate(zip(clip_info, durations)):
                # For dissolve transitions, clips overlap
                if i > 0 and transition_type == 'dissolve':
                    current_time -= transition_duration

                chapter_data.append({
                    'name': info.get('fileName', info.get('name', f'Clip {i + 1}')),
                    'index': i,
                    'start_time': current_time,
                    'end_time': current_time + dur
                })
                current_time += dur

            # Adjust end times so chapters don't overlap
            for i in range(len(chapter_data) - 1):
                chapter_data[i]['end_time'] = chapter_data[i + 1]['start_time']

            # Create and apply chapter metadata
            metadata_path = create_chapter_metadata_file(chapter_data, output_path)

            # Create temp output with chapters
            temp_output = output_path + '.chapters.mp4'
            add_chapters_to_video(output_path, metadata_path, temp_output)

            # Replace original with chaptered version
            if os.path.exists(temp_output) and os.path.getsize(temp_output) > 0:
                os.replace(temp_output, output_path)
                logger.info(f"[Multi-Clip] Added {len(chapter_data)} chapters to output")
            else:
                logger.warning("[Multi-Clip] Chapter embedding produced no output")

            # Cleanup
            if os.path.exists(metadata_path):
                os.remove(metadata_path)
            if os.path.exists(temp_output):
                os.remove(temp_output)

        except Exception as e:
            logger.error(f"[Multi-Clip] Failed to add chapters: {e}")
            # Continue without chapters - video is still valid


@router.post("/multi-clip")
async def export_multi_clip(
    request: Request,
    export_id: str = Form(...),
    multi_clip_data_json: str = Form(...),
    include_audio: str = Form("true"),
    target_fps: int = Form(30),
    export_mode: str = Form("fast"),
    project_id: int = Form(None),  # Optional: for saving working video to DB
    project_name: str = Form(None),  # Optional: for metadata
):
    """
    Export multiple video clips with transitions.

    This endpoint handles multi-clip export where:
    1. Each clip has its own crop keyframes, segments, and trim settings
    2. A global aspect ratio applies to all clips
    3. Clips are concatenated with a specified transition (cut, fade, dissolve)

    Request format:
    - video_0, video_1, video_2, ... : Video files uploaded as multipart form
    - multi_clip_data_json: JSON containing clips configuration
    """
    # Initialize progress
    export_progress[export_id] = {
        "progress": 5,
        "message": "Starting multi-clip export...",
        "status": "processing",
        "projectId": project_id,
        "projectName": project_name,
    }

    logger.info(f"[Multi-Clip Export] Starting export {export_id}")

    # Create export_jobs record for tracking and recovery
    if project_id:
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO export_jobs (id, project_id, type, status, input_data)
                    VALUES (?, ?, 'framing', 'processing', '{}')
                """, (export_id, project_id))
                conn.commit()
            logger.info(f"[Multi-Clip Export] Created export_jobs record: {export_id} for project {project_id}")
        except Exception as e:
            logger.warning(f"[Multi-Clip Export] Failed to create export_jobs record: {e}")

    # Parse form data to get video files
    form = await request.form()

    # Extract video files (video_0, video_1, etc.)
    video_files: Dict[int, UploadFile] = {}
    for key, value in form.items():
        if key.startswith('video_'):
            try:
                index = int(key.split('_')[1])
                video_files[index] = value
                logger.info(f"[Multi-Clip Export] Found video file: {key}")
            except (ValueError, IndexError):
                continue

    # Parse multi-clip data
    try:
        multi_clip_data = json.loads(multi_clip_data_json)
        clips_data = multi_clip_data.get('clips', [])
        global_aspect_ratio = multi_clip_data.get('globalAspectRatio', '9:16')
        transition = multi_clip_data.get('transition', {'type': 'cut', 'duration': 0.5})

        logger.info(f"[Multi-Clip Export] {len(clips_data)} clips, aspect ratio: {global_aspect_ratio}, transition: {transition}")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid multi-clip data JSON: {str(e)}")

    include_audio_bool = include_audio.lower() == "true"

    # Validate video files match clip data
    if len(video_files) != len(clips_data):
        raise HTTPException(
            status_code=400,
            detail=f"Mismatch: {len(video_files)} video files but {len(clips_data)} clip configs"
        )

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    processed_paths: List[str] = []

    # Capture user context before async operations (context vars may drift in threads)
    captured_user_id = get_current_user_id()
    logger.info(f"[Multi-Clip Export] Captured user context: {captured_user_id}")

    try:
        # Calculate consistent target resolution for all clips
        target_resolution = calculate_multi_clip_resolution(clips_data, global_aspect_ratio)
        logger.info(f"[Multi-Clip Export] Target resolution: {target_resolution}")

        # Get event loop for progress callbacks
        loop = asyncio.get_running_loop()

        # ===== MODAL GPU PROCESSING =====
        if modal_enabled():
            logger.info(f"[Multi-Clip Export] Using Modal GPU for {len(clips_data)} clips")

            # Upload all source videos to R2 temp folder
            source_keys = []
            for clip_data in sorted(clips_data, key=lambda x: x.get('clipIndex', 0)):
                clip_index = clip_data.get('clipIndex')
                video_file = video_files.get(clip_index)

                if not video_file:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Missing video file for clip {clip_index}"
                    )

                # Read video content
                content = await video_file.read()
                await video_file.seek(0)  # Reset for potential local fallback

                # Upload to R2 temp folder
                source_key = f"temp/multi_clip_{export_id}/source_{clip_index}.mp4"
                upload_bytes_to_r2(captured_user_id, source_key, content)
                source_keys.append(source_key)
                logger.info(f"[Multi-Clip Export] Uploaded source clip {clip_index} to R2: {source_key}")

            # Create progress callback
            async def modal_progress_callback(progress: float, message: str):
                progress_data = {
                    "progress": progress,
                    "message": message,
                    "status": "processing",
                    "projectId": project_id,
                    "projectName": project_name,
                }
                export_progress[export_id] = progress_data
                await manager.send_progress(export_id, progress_data)

            # Output key for the final video
            output_filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
            output_key = f"working_videos/{output_filename}"

            # Callback to store Modal call_id for job recovery
            def store_modal_call_id(modal_call_id: str):
                """Store Modal call_id in export_jobs for recovery after backend crash."""
                if project_id:
                    try:
                        with get_db_connection() as conn:
                            cursor = conn.cursor()
                            cursor.execute("""
                                UPDATE export_jobs
                                SET modal_call_id = ?, started_at = CURRENT_TIMESTAMP
                                WHERE id = ?
                            """, (modal_call_id, export_id))
                            conn.commit()
                        logger.info(f"[Multi-Clip Export] Stored modal_call_id: {modal_call_id} for recovery")
                    except Exception as e:
                        logger.warning(f"[Multi-Clip Export] Failed to store modal_call_id: {e}")

            # Call Modal - single container processes all clips
            result = await call_modal_multi_clip(
                job_id=export_id,
                user_id=captured_user_id,
                source_keys=source_keys,
                output_key=output_key,
                clips_data=clips_data,
                transition=transition,
                target_width=target_resolution[0],
                target_height=target_resolution[1],
                fps=target_fps,
                include_audio=include_audio_bool,
                progress_callback=modal_progress_callback,
                call_id_callback=store_modal_call_id,
            )

            if result.get("status") != "success":
                error = result.get("error", "Unknown error")
                raise RuntimeError(f"Modal multi-clip processing failed: {error}")

            # Clean up temp source files from R2
            for source_key in source_keys:
                try:
                    await delete_from_r2(captured_user_id, source_key)
                except Exception as e:
                    logger.warning(f"[Multi-Clip Export] Failed to delete temp file {source_key}: {e}")

            # Get video duration from result (or estimate)
            video_duration = None  # Modal doesn't return this yet

            # Save to database if project_id provided
            working_video_id = None
            if project_id:
                try:
                    # Generate presigned URL for the final video
                    presigned_url = generate_presigned_url(captured_user_id, output_key)

                    with get_db_connection() as conn:
                        cursor = conn.cursor()
                        # Insert working video record
                        cursor.execute("""
                            INSERT INTO working_videos (project_id, filename, presigned_url, type, multi_clip)
                            VALUES (?, ?, ?, 'processed', 1)
                        """, (project_id, output_filename, presigned_url))
                        working_video_id = cursor.lastrowid

                        # Update project to point to the new working video
                        cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))

                        # Update export_jobs record to complete
                        cursor.execute("""
                            UPDATE export_jobs
                            SET status = 'complete', output_video_id = ?, output_filename = ?, completed_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        """, (working_video_id, output_filename, export_id))

                        conn.commit()
                        logger.info(f"[Multi-Clip Export] Saved to DB: working_video_id={working_video_id}, project updated, export_jobs completed")
                except Exception as e:
                    logger.error(f"[Multi-Clip Export] Failed to save to database: {e}")

            # Final progress update
            progress_data = {
                "progress": 100,
                "message": "Multi-clip export complete!",
                "status": "completed",
                "projectId": project_id,
                "projectName": project_name,
            }
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            logger.info(f"[Multi-Clip Export] Modal processing complete: {result.get('clips_processed')} clips")

            # Return response with presigned URL
            return JSONResponse({
                "status": "success",
                "export_id": export_id,
                "presigned_url": generate_presigned_url(captured_user_id, output_key),
                "filename": output_filename,
                "working_video_id": working_video_id,
                "clips_processed": result.get("clips_processed"),
                "modal_used": True,
                "video_duration": video_duration,
            })

        # ===== LOCAL GPU PROCESSING (fallback when Modal not enabled) =====

        # Create upscaler ONCE and reuse for all clips
        # This prevents VRAM exhaustion from loading the model multiple times
        if AIVideoUpscaler is None:
            raise HTTPException(
                status_code=503,
                detail={"error": "AI upscaling dependencies not installed"}
            )

        # Check CUDA availability before trying to initialize
        if not torch.cuda.is_available():
            raise HTTPException(
                status_code=503,
                detail={"error": "CUDA not available - GPU required for AI upscaling"}
            )

        # Clear any stale GPU memory before initializing model
        try:
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
            logger.info(f"[Multi-Clip Export] CUDA memory cleared. Available: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f}GB")
        except Exception as e:
            logger.warning(f"[Multi-Clip Export] Failed to clear CUDA cache: {e}")

        try:
            shared_upscaler = AIVideoUpscaler(
                device='cuda',
                export_mode=export_mode,
                sr_model_name='realesr_general_x4v3'
            )
        except torch.cuda.OutOfMemoryError as e:
            logger.error(f"[Multi-Clip Export] CUDA out of memory during model init: {e}")
            torch.cuda.empty_cache()
            raise HTTPException(
                status_code=503,
                detail={"error": f"GPU out of memory - try closing other GPU applications: {e}"}
            )
        except RuntimeError as e:
            if "CUDA" in str(e) or "cuda" in str(e):
                logger.error(f"[Multi-Clip Export] CUDA error during model init: {e}")
                torch.cuda.empty_cache()
                raise HTTPException(
                    status_code=503,
                    detail={"error": f"CUDA error - GPU may be busy or unavailable: {e}"}
                )
            raise

        if shared_upscaler.upsampler is None:
            raise HTTPException(
                status_code=503,
                detail={"error": "AI SR model failed to load"}
            )

        logger.info(f"[Multi-Clip Export] Initialized shared AI upscaler")

        # Process each clip
        total_clips = len(clips_data)
        sorted_clips = sorted(clips_data, key=lambda x: x.get('clipIndex', 0))

        for i, clip_data in enumerate(sorted_clips):
            clip_index = clip_data.get('clipIndex', i)
            video_file = video_files.get(clip_index)

            if not video_file:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing video file for clip {clip_index}"
                )

            # Update progress
            base_progress = 10 + int((i / total_clips) * 70)
            progress_data = {
                "progress": base_progress,
                "message": f"Processing clip {i + 1}/{total_clips}...",
                "status": "processing"
            }
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            # Progress callback for this clip
            def create_clip_progress_callback(clip_num, total):
                def callback(current, frame_total, message, phase='ai_upscale'):
                    clip_start = 10 + int((clip_num / total) * 70)
                    clip_end = 10 + int(((clip_num + 1) / total) * 70)
                    clip_progress = clip_start + int((current / max(frame_total, 1)) * (clip_end - clip_start))

                    progress_data = {
                        "progress": clip_progress,
                        "message": f"Clip {clip_num + 1}/{total}: {message}",
                        "status": "processing"
                    }
                    export_progress[export_id] = progress_data

                    try:
                        asyncio.run_coroutine_threadsafe(
                            manager.send_progress(export_id, progress_data),
                            loop
                        )
                    except Exception as e:
                        logger.error(f"Failed to send WebSocket update: {e}")

                return callback

            clip_progress_callback = create_clip_progress_callback(i, total_clips)

            # Process this clip with the shared upscaler
            output_path = await process_single_clip(
                clip_data=clip_data,
                video_file=video_file,
                temp_dir=temp_dir,
                target_fps=target_fps,
                export_mode=export_mode,
                include_audio=include_audio_bool,
                progress_callback=clip_progress_callback,
                loop=loop,
                upscaler=shared_upscaler
            )

            processed_paths.append(output_path)
            logger.info(f"[Multi-Clip Export] Clip {clip_index} processed: {output_path}")

            # Aggressive memory cleanup between clips
            # This prevents VRAM/RAM accumulation that can cause crashes
            import gc
            gc.collect()  # Force Python garbage collection first

            if torch.cuda.is_available():
                torch.cuda.synchronize()  # Ensure all GPU operations complete
                torch.cuda.empty_cache()  # Clear cached GPU memory
                logger.info(f"[Multi-Clip Export] Cleared GPU cache after clip {clip_index}")

            gc.collect()  # Final garbage collection after GPU cleanup

        # Concatenate clips with transition
        progress_data = {
            "progress": 85,
            "message": "Concatenating clips...",
            "status": "processing"
        }
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        final_output = os.path.join(temp_dir, f"final_{export_id}.mp4")
        concatenate_clips_with_transition(
            clip_paths=processed_paths,
            output_path=final_output,
            transition=transition,
            include_audio=include_audio_bool,
            clip_info=sorted_clips
        )

        logger.info(f"[Multi-Clip Export] Final output: {final_output}")

        # Get video duration for cost-optimized GPU selection in overlay mode
        video_duration = get_video_duration(final_output)
        logger.info(f"[Multi-Clip Export] Video duration: {video_duration:.2f}s")

        # Restore user context after async operations
        set_current_user_id(captured_user_id)
        logger.info(f"[Multi-Clip Export] Restored user context: {captured_user_id}")

        # Save working video to database if project_id provided
        working_video_id = None
        working_filename = None
        if project_id:
            try:
                # Generate unique filename
                working_filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"

                # Upload to R2 with periodic progress updates (can take 60+ seconds for large files)
                # Run upload in thread while sending heartbeat progress every 10 seconds
                upload_result = [None]  # Use list to store result from thread
                upload_error = [None]

                def do_upload():
                    try:
                        result = upload_to_r2(captured_user_id, f"working_videos/{working_filename}", Path(final_output))
                        upload_result[0] = result
                    except Exception as e:
                        upload_error[0] = e

                import threading
                upload_thread = threading.Thread(target=do_upload)
                upload_thread.start()

                # Send periodic progress while upload is running
                progress_value = 90
                while upload_thread.is_alive():
                    upload_progress = {
                        "progress": progress_value,
                        "message": "Uploading to cloud storage...",
                        "status": "processing"
                    }
                    export_progress[export_id] = upload_progress
                    await manager.send_progress(export_id, upload_progress)
                    # Wait up to 10 seconds, checking if thread is done
                    upload_thread.join(timeout=10)
                    # Slowly increment progress (90 -> 95 during upload)
                    if progress_value < 95:
                        progress_value += 1

                # Check for errors
                if upload_error[0]:
                    raise upload_error[0]
                if not upload_result[0]:
                    raise Exception("Failed to upload working video to R2")

                with get_db_connection() as conn:
                    cursor = conn.cursor()

                    # Get next version number
                    cursor.execute("""
                        SELECT COALESCE(MAX(version), 0) + 1 as next_version
                        FROM working_videos WHERE project_id = ?
                    """, (project_id,))
                    next_version = cursor.fetchone()['next_version']

                    # Reset final_video_id (working video changed, need re-export overlay)
                    cursor.execute("UPDATE projects SET final_video_id = NULL WHERE id = ?", (project_id,))

                    # Create working_videos record with duration
                    cursor.execute("""
                        INSERT INTO working_videos (project_id, filename, version, duration)
                        VALUES (?, ?, ?, ?)
                    """, (project_id, working_filename, next_version, video_duration if video_duration > 0 else None))
                    working_video_id = cursor.lastrowid

                    # Update project with new working_video_id
                    cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))

                    conn.commit()
                    logger.info(f"[Multi-Clip Export] Created working video {working_video_id} for project {project_id}")

            except Exception as e:
                logger.error(f"[Multi-Clip Export] Failed to save working video: {e}", exc_info=True)
                # Don't fail the whole export - still return success
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

        # Clean up
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

        # Return JSON response (MVC: frontend doesn't need the video data)
        return JSONResponse({
            'success': True,
            'working_video_id': working_video_id,
            'working_filename': working_filename,
            'project_id': project_id
        })

    except HTTPException:
        import time
        time.sleep(0.5)
        # Clean up GPU memory on error
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Multi-Clip Export] Cleanup failed: {cleanup_error}")
        raise
    except Exception as e:
        import traceback
        full_traceback = traceback.format_exc()
        logger.error(f"[Multi-Clip Export] Failed: {str(e)}")
        logger.error(f"[Multi-Clip Export] Full traceback:\n{full_traceback}")
        error_msg = f"Export failed: {str(e)}"
        # Send both 'message' and 'error' for frontend compatibility
        error_data = {"progress": 0, "message": error_msg, "error": error_msg, "status": "error"}
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        # Update export_jobs record to error status
        if project_id:
            try:
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE export_jobs
                        SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (str(e), export_id))
                    conn.commit()
                logger.info(f"[Multi-Clip Export] Updated export_jobs to error: {export_id}")
            except Exception as db_e:
                logger.warning(f"[Multi-Clip Export] Failed to update export_jobs error: {db_e}")
        import time
        time.sleep(0.5)
        # Clean up GPU memory on error
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Multi-Clip Export] Cleanup failed: {cleanup_error}")
        raise HTTPException(status_code=500, detail=f"Multi-clip export failed: {str(e)}")


@router.post("/chapters")
async def extract_chapters(
    video: UploadFile = File(...)
):
    """
    Extract chapter markers from a video file.

    Returns chapter data that can be used to auto-generate highlight regions
    in Overlay mode.
    """
    temp_dir = tempfile.mkdtemp()
    temp_file = os.path.join(temp_dir, "input.mp4")

    try:
        # Save uploaded file
        with open(temp_file, "wb") as f:
            content = await video.read()
            f.write(content)

        # Use ffprobe to extract chapter data
        probe = ffmpeg.probe(temp_file, show_chapters=None)

        chapters = []
        for chapter in probe.get('chapters', []):
            start_time = float(chapter.get('start_time', 0))
            end_time = float(chapter.get('end_time', 0))

            tags = chapter.get('tags', {})
            title = tags.get('title', f"Chapter {len(chapters) + 1}")

            chapters.append({
                "title": title,
                "start_time": start_time,
                "end_time": end_time
            })

        logger.info(f"[Chapters] Extracted {len(chapters)} chapters from video")

        return {"chapters": chapters}

    except Exception as e:
        logger.error(f"[Chapters] Failed to extract chapters: {e}")
        return {"chapters": []}

    finally:
        import time
        time.sleep(0.3)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


@router.post("/concat-for-overlay")
async def concat_for_overlay(
    request: Request,
):
    """
    Concatenate multiple video clips without any framing/cropping.

    This endpoint is used when the user wants to skip Framing mode and go
    directly to Overlay mode with pre-edited clips.
    """
    logger.info("[Concat for Overlay] Starting...")

    # Parse form data to get video files
    form = await request.form()

    # Extract video files (video_0, video_1, etc.)
    video_files: Dict[int, UploadFile] = {}
    for key, value in form.items():
        if key.startswith('video_'):
            try:
                index = int(key.split('_')[1])
                video_files[index] = value
                logger.info(f"[Concat for Overlay] Found video file: {key}")
            except (ValueError, IndexError):
                continue

    if not video_files:
        raise HTTPException(status_code=400, detail="No video files provided")

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    input_paths = []

    try:
        # Save all uploaded files to temp directory
        sorted_indices = sorted(video_files.keys())
        clip_info = []

        for idx in sorted_indices:
            video_file = video_files[idx]
            file_ext = Path(video_file.filename).suffix or ".mp4"
            input_path = os.path.join(temp_dir, f"input_{idx}{file_ext}")

            with open(input_path, 'wb') as f:
                content = await video_file.read()
                f.write(content)

            input_paths.append(input_path)

            # Get video duration for clip info
            duration = get_video_duration(input_path)
            clip_info.append({
                'fileName': video_file.filename,
                'index': idx,
                'duration': duration
            })

            logger.info(f"[Concat for Overlay] Saved clip {idx}: {video_file.filename} ({duration:.2f}s)")

        # Single clip - just return it directly with metadata
        if len(input_paths) == 1:
            clip_metadata = {
                'source_clips': [{
                    'index': 0,
                    'name': clip_info[0]['fileName'],
                    'fileName': clip_info[0]['fileName'],
                    'start_time': 0,
                    'end_time': clip_info[0]['duration'],
                    'duration': clip_info[0]['duration']
                }]
            }

            metadata_json = json.dumps(clip_metadata)
            metadata_b64 = base64.b64encode(metadata_json.encode()).decode()

            return FileResponse(
                input_paths[0],
                media_type='video/mp4',
                filename=clip_info[0]['fileName'],
                headers={'X-Clip-Metadata': metadata_b64},
                background=BackgroundTask(lambda: shutil.rmtree(temp_dir) if os.path.exists(temp_dir) else None)
            )

        # Multiple clips - concatenate with chapter markers
        final_output = os.path.join(temp_dir, f"concat_{uuid.uuid4().hex}.mp4")

        # Use cut transition (simple concatenation)
        concatenate_clips_with_transition(
            clip_paths=input_paths,
            output_path=final_output,
            transition={'type': 'cut', 'duration': 0},
            include_audio=True,
            clip_info=clip_info
        )

        # Calculate clip timestamps in concatenated video
        source_clips = []
        current_time = 0.0
        for i, info in enumerate(clip_info):
            source_clips.append({
                'index': i,
                'name': info['fileName'],
                'fileName': info['fileName'],
                'start_time': current_time,
                'end_time': current_time + info['duration'],
                'duration': info['duration']
            })
            current_time += info['duration']

        clip_metadata = {'source_clips': source_clips}

        logger.info(f"[Concat for Overlay] Created concatenated video with {len(source_clips)} clips")

        metadata_json = json.dumps(clip_metadata)
        metadata_b64 = base64.b64encode(metadata_json.encode()).decode()

        return FileResponse(
            final_output,
            media_type='video/mp4',
            filename=f"concat_{len(source_clips)}_clips.mp4",
            headers={'X-Clip-Metadata': metadata_b64},
            background=BackgroundTask(lambda: shutil.rmtree(temp_dir) if os.path.exists(temp_dir) else None)
        )

    except HTTPException:
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
        raise
    except Exception as e:
        logger.error(f"[Concat for Overlay] Failed: {str(e)}", exc_info=True)
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Concatenation failed: {str(e)}")
