"""
Modal client for calling GPU functions from FastAPI backend.

This module provides a clean interface for calling Modal functions
from the backend export worker. It handles:
- Checking if Modal is enabled
- Calling Modal functions remotely
- Error handling and fallback

Environment Variables:
    MODAL_ENABLED: Set to "true" to enable Modal processing
    MODAL_TOKEN_ID: Modal API token ID (for production)
    MODAL_TOKEN_SECRET: Modal API token secret (for production)

Usage:
    from app.services.modal_client import modal_enabled, call_modal_overlay

    if modal_enabled():
        result = await call_modal_overlay(
            job_id="...",
            user_id="a",
            input_key="working_videos/input.mp4",
            output_key="working_videos/output.mp4",
            highlight_regions=[...],
            effect_type="dark_overlay"
        )
"""

import os
import asyncio
import logging
import time

logger = logging.getLogger(__name__)


def log_progress_event(job_id: str, phase: str, elapsed: float = None, extra: dict = None):
    """
    Log structured progress event for timing analysis.

    Format: [Progress Event] job=xxx phase=yyy elapsed=zzz extra_key=extra_val

    This enables collecting timing data to improve time estimates.
    """
    parts = [f"[Progress Event] job={job_id} phase={phase}"]
    if elapsed is not None:
        parts.append(f"elapsed={elapsed:.2f}s")
    if extra:
        for key, val in extra.items():
            parts.append(f"{key}={val}")
    logger.info(" ".join(parts))

# Modal is available if MODAL_ENABLED=true
_modal_enabled = os.environ.get("MODAL_ENABLED", "false").lower() == "true"

# Modal app name (must match the name in video_processing.py)
MODAL_APP_NAME = "reel-ballers-video-v2"

# Cached function references
_render_overlay_fn = None
_process_framing_ai_fn = None
_process_multi_clip_fn = None
_detect_players_fn = None
_detect_players_batch_fn = None
_extract_clip_fn = None
_create_annotated_compilation_fn = None


def modal_enabled() -> bool:
    """Check if Modal processing is enabled."""
    return _modal_enabled


def _get_render_overlay_fn():
    """Get a reference to the deployed render_overlay function."""
    global _render_overlay_fn

    if _render_overlay_fn is not None:
        return _render_overlay_fn

    try:
        import modal
        _render_overlay_fn = modal.Function.from_name(MODAL_APP_NAME, "render_overlay")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/render_overlay")
        return _render_overlay_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to render_overlay: {e}")
        raise RuntimeError(f"Modal render_overlay not available: {e}")


def _get_process_framing_ai_fn():
    """Get a reference to the deployed process_framing_ai function (Real-ESRGAN upscaling)."""
    global _process_framing_ai_fn

    if _process_framing_ai_fn is not None:
        return _process_framing_ai_fn

    try:
        import modal
        _process_framing_ai_fn = modal.Function.from_name(MODAL_APP_NAME, "process_framing_ai")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/process_framing_ai")
        return _process_framing_ai_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to process_framing_ai: {e}")
        raise RuntimeError(f"Modal process_framing_ai not available: {e}")


def _get_detect_players_fn():
    """Get a reference to the deployed detect_players_modal function."""
    global _detect_players_fn

    if _detect_players_fn is not None:
        return _detect_players_fn

    try:
        import modal
        _detect_players_fn = modal.Function.from_name(MODAL_APP_NAME, "detect_players_modal")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/detect_players_modal")
        return _detect_players_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to detect_players_modal: {e}")
        raise RuntimeError(f"Modal detect_players_modal not available: {e}")


def _get_detect_players_batch_fn():
    """Get a reference to the deployed detect_players_batch_modal function."""
    global _detect_players_batch_fn

    if _detect_players_batch_fn is not None:
        return _detect_players_batch_fn

    try:
        import modal
        _detect_players_batch_fn = modal.Function.from_name(MODAL_APP_NAME, "detect_players_batch_modal")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/detect_players_batch_modal")
        return _detect_players_batch_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to detect_players_batch_modal: {e}")
        raise RuntimeError(f"Modal detect_players_batch_modal not available: {e}")


def _get_extract_clip_fn():
    """Get a reference to the deployed extract_clip_modal function."""
    global _extract_clip_fn

    if _extract_clip_fn is not None:
        return _extract_clip_fn

    try:
        import modal
        _extract_clip_fn = modal.Function.from_name(MODAL_APP_NAME, "extract_clip_modal")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/extract_clip_modal")
        return _extract_clip_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to extract_clip_modal: {e}")
        raise RuntimeError(f"Modal extract_clip_modal not available: {e}")


def _get_create_annotated_compilation_fn():
    """Get a reference to the deployed create_annotated_compilation function."""
    global _create_annotated_compilation_fn

    if _create_annotated_compilation_fn is not None:
        return _create_annotated_compilation_fn

    try:
        import modal
        _create_annotated_compilation_fn = modal.Function.from_name(MODAL_APP_NAME, "create_annotated_compilation")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/create_annotated_compilation")
        return _create_annotated_compilation_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to create_annotated_compilation: {e}")
        raise RuntimeError(f"Modal create_annotated_compilation not available: {e}")


def _get_process_multi_clip_fn():
    """Get a reference to the deployed process_multi_clip_modal function."""
    global _process_multi_clip_fn

    if _process_multi_clip_fn is not None:
        return _process_multi_clip_fn

    try:
        import modal
        _process_multi_clip_fn = modal.Function.from_name(MODAL_APP_NAME, "process_multi_clip_modal")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/process_multi_clip_modal")
        return _process_multi_clip_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to process_multi_clip_modal: {e}")
        raise RuntimeError(f"Modal process_multi_clip_modal not available: {e}")


# Cached reference for unified function
_process_clips_ai_fn = None


def _get_process_clips_ai_fn():
    """Get a reference to the deployed process_clips_ai function (unified AI processing)."""
    global _process_clips_ai_fn

    if _process_clips_ai_fn is not None:
        return _process_clips_ai_fn

    try:
        import modal
        _process_clips_ai_fn = modal.Function.from_name(MODAL_APP_NAME, "process_clips_ai")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/process_clips_ai")
        return _process_clips_ai_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to process_clips_ai: {e}")
        raise RuntimeError(f"Modal process_clips_ai not available: {e}")




async def call_modal_framing_ai(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict = None,
    video_duration: float = None,
    progress_callback = None,
    call_id_callback = None,
    include_audio: bool = True,
    export_mode: str = "quality",
) -> dict:
    """
    Call Modal process_framing_ai function for AI-upscaled crop exports.

    Uses Real-ESRGAN on cloud GPU for frame-by-frame super resolution.
    Streams REAL progress updates from Modal via remote_gen().

    When MODAL_ENABLED=false, uses local Real-ESRGAN/FFmpeg with the same interface.
    This enables testing the full code path without Modal costs.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for source video
        output_key: R2 key for output video
        keyframes: Crop keyframes [{time, x, y, width, height}, ...]
        output_width: Target width (default 810 for 9:16)
        output_height: Target height (default 1440)
        fps: Target frame rate (default 30)
        segment_data: Optional trim/speed data
        video_duration: Video duration in seconds (for progress estimation)
        progress_callback: async callable(progress: float, message: str, phase: str) for updates
        call_id_callback: Optional callable(call_id: str) - NOT USED with remote_gen

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        # Use local fallback with same interface
        from app.services.local_processors import local_framing
        logger.info(f"[Modal] Using local fallback for framing job {job_id}")
        return await local_framing(
            job_id=job_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            keyframes=keyframes,
            output_width=output_width,
            output_height=output_height,
            fps=fps,
            video_duration=video_duration,
            segment_data=segment_data,
            progress_callback=progress_callback,
            include_audio=include_audio,
            export_mode=export_mode,
        )

    process_framing_ai = _get_process_framing_ai_fn()

    logger.info(f"[Modal] Calling process_framing_ai for job {job_id}")
    logger.info(f"[Modal] User: {user_id}, Input: {input_key} -> Output: {output_key}")
    logger.info(f"[Modal] Target: {output_width}x{output_height}")

    estimated_frames = int((video_duration or 10) * fps)
    logger.info(f"[Modal] Estimated {estimated_frames} frames")

    # Track timing for progress improvement
    job_start_time = time.time()
    log_progress_event(job_id, "modal_start", extra={"type": "framing_ai", "frames": estimated_frames})

    try:
        # Use remote_gen() to stream real progress from Modal
        # This iterates over yield statements in the Modal function
        loop = asyncio.get_running_loop()

        def get_generator():
            return process_framing_ai.remote_gen(
                job_id=job_id,
                user_id=user_id,
                input_key=input_key,
                output_key=output_key,
                keyframes=keyframes,
                output_width=output_width,
                output_height=output_height,
                fps=fps,
                segment_data=segment_data,
            )

        # Get the generator in executor (Modal API is sync)
        gen = await loop.run_in_executor(None, get_generator)

        log_progress_event(job_id, "modal_streaming_started")
        logger.info(f"[Modal] Streaming progress from Modal for job {job_id}")

        result = None
        last_progress = None

        # Iterate over yielded progress updates
        def next_item(generator):
            try:
                return next(generator)
            except StopIteration:
                return None

        while True:
            update = await loop.run_in_executor(None, next_item, gen)
            if update is None:
                break

            # Check if this is the final result (has "status" key)
            if "status" in update:
                result = update
                logger.info(f"[Modal] Received final result: {result.get('status')}")
                break

            # This is a progress update - forward to callback
            progress = update.get("progress", 0)
            message = update.get("message", "Processing...")
            phase = update.get("phase", "processing")

            # Only log significant progress changes
            if last_progress is None or abs(progress - last_progress) >= 5:
                logger.info(f"[Modal] Progress: {progress}% - {message}")
                last_progress = progress

            if progress_callback:
                try:
                    await progress_callback(progress, message, phase)
                except Exception as e:
                    logger.warning(f"[Modal] Progress callback failed: {e}")

        total_elapsed = time.time() - job_start_time
        frames_processed = result.get("frames_processed", estimated_frames) if result else estimated_frames

        log_progress_event(job_id, "modal_complete", elapsed=total_elapsed, extra={
            "status": result.get("status", "unknown") if result else "no_result",
            "frames": frames_processed,
            "fps_actual": round(frames_processed / total_elapsed, 1) if total_elapsed > 0 else 0
        })
        logger.info(f"[Modal] AI framing job {job_id} completed: {result}")
        return result or {"status": "error", "error": "No result received from Modal"}

    except Exception as e:
        total_elapsed = time.time() - job_start_time
        log_progress_event(job_id, "modal_error", elapsed=total_elapsed, extra={"error": str(e)[:50]})
        logger.error(f"[Modal] AI framing job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def call_modal_clips_ai(
    job_id: str,
    user_id: str,
    source_keys: list,
    output_key: str,
    clips_data: list,
    target_width: int = 810,
    target_height: int = 1440,
    fps: int = 30,
    include_audio: bool = True,
    transition: dict = None,
    progress_callback = None,
) -> dict:
    """
    Call unified Modal process_clips_ai function for AI-upscaled exports.

    Handles both single-clip and multi-clip exports with real-time progress streaming.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        source_keys: List of R2 keys for source videos
        output_key: R2 key for output video
        clips_data: List of clip configs, each with:
            - keyframes: [{time, x, y, width, height}, ...]
            - segment_data: {trim_start, trim_end, segments: [{start, end, speed}]}
        target_width: Output width (default 810 for 9:16)
        target_height: Output height (default 1440)
        fps: Target frame rate (default 30)
        include_audio: Include audio track (default True)
        transition: Optional {type: "cut"|"fade", duration: float} for multi-clip
        progress_callback: async callable(progress: float, message: str, phase: str) for updates

    Returns:
        {"status": "success", "output_key": "...", "clips_processed": N} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    process_clips_ai = _get_process_clips_ai_fn()

    total_clips = len(clips_data)
    logger.info(f"[Modal] Calling process_clips_ai for job {job_id} ({total_clips} clip(s))")
    logger.info(f"[Modal] User: {user_id}, Output: {output_key}")
    logger.info(f"[Modal] Target: {target_width}x{target_height} @ {fps}fps")

    job_start_time = time.time()
    log_progress_event(job_id, "modal_start", extra={"type": "clips_ai", "clips": total_clips})

    try:
        # Use remote_gen() to stream real progress from Modal
        loop = asyncio.get_running_loop()

        def get_generator():
            return process_clips_ai.remote_gen(
                job_id=job_id,
                user_id=user_id,
                source_keys=source_keys,
                output_key=output_key,
                clips_data=clips_data,
                target_width=target_width,
                target_height=target_height,
                fps=fps,
                include_audio=include_audio,
                transition=transition,
            )

        gen = await loop.run_in_executor(None, get_generator)

        log_progress_event(job_id, "modal_streaming_started")
        logger.info(f"[Modal] Streaming progress for job {job_id}")

        result = None
        last_progress = None

        def next_item(generator):
            try:
                return next(generator)
            except StopIteration:
                return None

        while True:
            update = await loop.run_in_executor(None, next_item, gen)
            if update is None:
                break

            if "status" in update:
                result = update
                logger.info(f"[Modal] Received final result: {result.get('status')}")
                break

            progress = update.get("progress", 0)
            message = update.get("message", "Processing...")
            phase = update.get("phase", "processing")

            if last_progress is None or abs(progress - last_progress) >= 5:
                logger.info(f"[Modal] Progress: {progress}% - {message}")
                last_progress = progress

            if progress_callback:
                try:
                    await progress_callback(progress, message, phase)
                except Exception as e:
                    logger.warning(f"[Modal] Progress callback failed: {e}")

        total_elapsed = time.time() - job_start_time
        clips_processed = result.get("clips_processed", total_clips) if result else total_clips

        log_progress_event(job_id, "modal_complete", elapsed=total_elapsed, extra={
            "status": result.get("status", "unknown") if result else "no_result",
            "clips": clips_processed
        })
        logger.info(f"[Modal] Clips AI job {job_id} completed: {result}")
        return result or {"status": "error", "error": "No result received from Modal"}

    except Exception as e:
        total_elapsed = time.time() - job_start_time
        log_progress_event(job_id, "modal_error", elapsed=total_elapsed, extra={"error": str(e)[:50]})
        logger.error(f"[Modal] Clips AI job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def call_modal_multi_clip(
    job_id: str,
    user_id: str,
    source_keys: list,
    output_key: str,
    clips_data: list,
    transition: dict,
    target_width: int,
    target_height: int,
    fps: int = 30,
    include_audio: bool = True,
    progress_callback = None,
    call_id_callback = None,
) -> dict:
    """
    Call Modal process_multi_clip_modal for multi-clip AI upscaling.

    Single container processes all clips sequentially with shared model.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        source_keys: List of R2 keys for source clips
        output_key: R2 key for final output
        clips_data: Per-clip config [{cropKeyframes, segmentsData, clipIndex}, ...]
        transition: {type: "cut"|"fade"|"dissolve", duration: float}
        target_width: Target output width
        target_height: Target output height
        fps: Target frame rate (default 30)
        include_audio: Include audio (default True)
        progress_callback: async callable(progress: float, message: str)
        call_id_callback: Optional callable(call_id: str) to receive Modal call ID for recovery

    Returns:
        {"status": "success", "output_key": "...", "clips_processed": N} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    process_multi_clip = _get_process_multi_clip_fn()

    logger.info(f"[Modal] Calling process_multi_clip_modal for job {job_id}")
    logger.info(f"[Modal] User: {user_id}, {len(source_keys)} clips -> Output: {output_key}")
    logger.info(f"[Modal] Target: {target_width}x{target_height} @ {fps}fps")

    # Estimate processing time: ~1.0s per frame total on T4 GPU for Real-ESRGAN
    # Assume ~10s per clip at 30fps = 300 frames per clip
    estimated_frames_per_clip = 300
    total_frames = len(clips_data) * estimated_frames_per_clip
    estimated_time = total_frames * 1.0  # seconds total
    logger.info(f"[Modal] Estimated ~{estimated_time:.0f}s for {len(clips_data)} clips")

    # Track timing for progress improvement
    job_start_time = time.time()
    log_progress_event(job_id, "modal_start", extra={"type": "multi_clip", "clips": len(clips_data), "frames": total_frames})

    modal_call_id = None  # Initialize for exception handler
    try:
        # Use spawn() to get call_id for recovery (instead of remote() which blocks)
        def spawn_modal_job():
            call = process_multi_clip.spawn(
                job_id=job_id,
                user_id=user_id,
                source_keys=source_keys,
                output_key=output_key,
                clips_data=clips_data,
                transition=transition,
                target_width=target_width,
                target_height=target_height,
                fps=fps,
                include_audio=include_audio,
            )
            return call

        # Start the Modal job in a background task
        loop = asyncio.get_running_loop()
        modal_call = await loop.run_in_executor(None, spawn_modal_job)

        # Get call_id for recovery
        modal_call_id = modal_call.object_id
        spawn_elapsed = time.time() - job_start_time
        log_progress_event(job_id, "modal_spawn", elapsed=spawn_elapsed, extra={"call_id": modal_call_id[:16]})
        logger.info(f"[Modal] Multi-clip job spawned with call_id: {modal_call_id}")

        # Notify caller of call_id so it can be stored for recovery
        if call_id_callback:
            try:
                call_id_callback(modal_call_id)
            except Exception as e:
                logger.warning(f"[Modal] call_id_callback failed: {e}")

        # Create a future to wait for the result
        async def wait_for_result():
            return await loop.run_in_executor(None, modal_call.get)

        result_future = asyncio.create_task(wait_for_result())

        # Simulate progress while waiting for Modal
        if progress_callback:
            start_time = asyncio.get_event_loop().time()
            progress_start = 10
            progress_end = 90

            # Progress phases: (threshold, phase_id, message)
            # Adjusted based on single-clip benchmarks, with concat phase added
            phases = [
                (0.00, "modal_download", "Downloading source clips..."),
                (0.08, "modal_init", "Loading AI model..."),
                (0.12, "modal_upscale", "Processing clips with AI upscaling..."),
                (0.55, "modal_encode", "Encoding clips..."),
                (0.65, "modal_concat", "Concatenating clips..."),
                (0.70, "modal_upload", "Uploading result..."),
            ]

            current_phase = "modal_download"

            while not result_future.done():
                elapsed = asyncio.get_event_loop().time() - start_time
                raw_progress = min(elapsed / estimated_time, 0.95)
                progress = progress_start + raw_progress * (progress_end - progress_start)

                phase_msg = "Processing..."
                for threshold, phase_id, msg in phases:
                    if raw_progress >= threshold:
                        current_phase = phase_id
                        phase_msg = msg

                try:
                    await progress_callback(progress, phase_msg, current_phase)
                except Exception as e:
                    logger.warning(f"[Modal] Progress callback failed: {e}")

                await asyncio.sleep(3)  # Update every 3 seconds

            # Log summary
            total_time = asyncio.get_event_loop().time() - start_time
            logger.info(f"[Modal Summary] job={job_id} total={total_time:.1f}s (simulated progress)")

        result = await result_future

        total_elapsed = time.time() - job_start_time
        log_progress_event(job_id, "modal_complete", elapsed=total_elapsed, extra={
            "status": result.get("status", "unknown"),
            "clips": len(clips_data),
            "frames": total_frames,
            "fps_actual": round(total_frames / total_elapsed, 1) if total_elapsed > 0 else 0
        })
        logger.info(f"[Modal] Multi-clip job {job_id} completed: {result}")
        return result

    except Exception as e:
        total_elapsed = time.time() - job_start_time
        log_progress_event(job_id, "modal_error", elapsed=total_elapsed, extra={"error": str(e)[:50]})

        error_str = str(e).lower()
        error_type = type(e).__name__

        # Check if this is a connection/network error (DNS, socket, Modal connection, etc.)
        is_connection_error = (
            'connectionerror' in error_type.lower() or
            'getaddrinfo' in error_str or
            'connection' in error_str or
            'network' in error_str or
            'timeout' in error_str or
            'socket' in error_str
        )

        if modal_call_id and is_connection_error:
            # Connection error while polling - job may still be running on Modal
            logger.warning(f"[Modal] Connection lost while polling job {job_id}: {e}")
            logger.info(f"[Modal] Job {job_id} may still be running, returning recoverable status (call_id: {modal_call_id})")
            return {"status": "connection_lost", "call_id": modal_call_id, "message": "Connection lost but job may still be running. Refresh to check status."}

        logger.error(f"[Modal] Multi-clip job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def call_modal_overlay(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
    video_duration: float = None,
    progress_callback = None,
    call_id_callback = None,
) -> dict:
    """
    Call Modal render_overlay function for highlight overlays.
    Streams REAL progress updates from Modal via remote_gen().

    When MODAL_ENABLED=false, uses local FFmpeg processing with the same interface.
    This enables testing the full code path without Modal costs.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for working video
        output_key: R2 key for output video
        highlight_regions: Highlight regions with keyframes
        effect_type: "dark_overlay" | "brightness_boost" | "original"
        video_duration: Video duration in seconds (for logging)
        progress_callback: async callable(progress: float, message: str, phase: str) for updates
        call_id_callback: Optional callable(call_id: str) - NOT USED with remote_gen

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        # Use local fallback with same interface
        from app.services.local_processors import local_overlay
        logger.info(f"[Modal] Using local fallback for overlay job {job_id}")
        return await local_overlay(
            job_id=job_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            highlight_regions=highlight_regions,
            effect_type=effect_type,
            video_duration=video_duration,
            progress_callback=progress_callback,
        )

    render_overlay = _get_render_overlay_fn()

    logger.info(f"[Modal] Calling render_overlay for job {job_id}")
    logger.info(f"[Modal] User: {user_id}, Input: {input_key} -> Output: {output_key}")
    logger.info(f"[Modal] Regions: {len(highlight_regions)}, Effect: {effect_type}")

    estimated_frames = int((video_duration or 10) * 30)  # Assume 30fps
    logger.info(f"[Modal] Estimated {estimated_frames} frames")

    # Track timing for progress improvement
    job_start_time = time.time()
    log_progress_event(job_id, "modal_start", extra={"type": "overlay", "frames": estimated_frames})

    try:
        # Use remote_gen() to stream real progress from Modal
        loop = asyncio.get_running_loop()

        def get_generator():
            return render_overlay.remote_gen(
                job_id=job_id,
                user_id=user_id,
                input_key=input_key,
                output_key=output_key,
                highlight_regions=highlight_regions,
                effect_type=effect_type,
            )

        # Get the generator in executor (Modal API is sync)
        gen = await loop.run_in_executor(None, get_generator)

        log_progress_event(job_id, "modal_streaming_started")
        logger.info(f"[Modal] Streaming progress from Modal for overlay job {job_id}")

        result = None
        last_progress = None

        # Iterate over yielded progress updates
        def next_item(generator):
            try:
                return next(generator)
            except StopIteration:
                return None

        while True:
            update = await loop.run_in_executor(None, next_item, gen)
            if update is None:
                break

            # Check if this is the final result (has "status" key)
            if "status" in update:
                result = update
                logger.info(f"[Modal] Received final result: {result.get('status')}")
                break

            # This is a progress update - forward to callback
            progress = update.get("progress", 0)
            message = update.get("message", "Processing...")
            phase = update.get("phase", "processing")

            # Only log significant progress changes
            if last_progress is None or abs(progress - last_progress) >= 5:
                logger.info(f"[Modal] Progress: {progress}% - {message}")
                last_progress = progress

            if progress_callback:
                try:
                    await progress_callback(progress, message, phase)
                except Exception as e:
                    logger.warning(f"[Modal] Progress callback failed: {e}")

        total_elapsed = time.time() - job_start_time

        log_progress_event(job_id, "modal_complete", elapsed=total_elapsed, extra={
            "status": result.get("status", "unknown") if result else "no_result",
            "frames": estimated_frames,
            "fps_actual": round(estimated_frames / total_elapsed, 1) if total_elapsed > 0 else 0
        })
        logger.info(f"[Modal] Overlay job {job_id} completed: {result}")
        return result or {"status": "error", "error": "No result received from Modal"}

    except Exception as e:
        total_elapsed = time.time() - job_start_time
        log_progress_event(job_id, "modal_error", elapsed=total_elapsed, extra={"error": str(e)[:50]})
        logger.error(f"[Modal] Overlay job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def call_modal_overlay_auto(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
    video_duration: float = None,
    progress_callback = None,
    call_id_callback = None,
) -> dict:
    """
    Call Modal overlay with sequential processing.

    Note: Parallel processing was tested (E7) but costs 3-4x MORE than sequential.
    This function now always uses sequential processing.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for working video
        output_key: R2 key for output video
        highlight_regions: Highlight regions with keyframes
        effect_type: "dark_overlay" | "brightness_boost" | "original"
        video_duration: Video duration in seconds (for progress estimation)
        progress_callback: async callable(progress: float, message: str) for updates
        call_id_callback: Optional callable(call_id: str) to receive Modal call ID for recovery

    Returns:
        {"status": "success", "output_key": "...", "config": "sequential"} or
        {"status": "error", "error": "..."}
    """
    # Always use sequential - parallel costs 3-4x more (E7 finding)
    result = await call_modal_overlay(
        job_id=job_id,
        user_id=user_id,
        input_key=input_key,
        output_key=output_key,
        highlight_regions=highlight_regions,
        effect_type=effect_type,
        video_duration=video_duration,
        progress_callback=progress_callback,
        call_id_callback=call_id_callback,
    )
    if result.get("status") == "success":
        result["config"] = "sequential"
        result["parallel"] = False
    return result


async def call_modal_detect_players(
    user_id: str,
    input_key: str,
    frame_number: int,
    confidence_threshold: float = 0.5,
) -> dict:
    """
    Call Modal detect_players_modal function for YOLO player detection.

    Args:
        user_id: User folder in R2
        input_key: R2 key for input video
        frame_number: Frame number to analyze
        confidence_threshold: Minimum confidence for detections

    Returns:
        {"status": "success", "detections": [...], "video_width": int, "video_height": int} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    detect_players = _get_detect_players_fn()

    logger.info(f"[Modal] Calling detect_players_modal for frame {frame_number}")
    logger.info(f"[Modal] User: {user_id}, Input: {input_key}")

    try:
        result = await asyncio.to_thread(
            detect_players.remote,
            user_id=user_id,
            input_key=input_key,
            frame_number=frame_number,
            confidence_threshold=confidence_threshold,
        )

        logger.info(f"[Modal] Player detection completed: {len(result.get('detections', []))} players")
        return result

    except Exception as e:
        logger.error(f"[Modal] Player detection failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def call_modal_detect_players_batch(
    user_id: str,
    input_key: str,
    timestamps: list[float],
    confidence_threshold: float = 0.5,
) -> dict:
    """
    Call Modal detect_players_batch_modal for batch YOLO player detection.

    More efficient than calling single-frame detection multiple times because
    the video is only downloaded once.

    Args:
        user_id: User folder in R2
        input_key: R2 key for input video
        timestamps: List of timestamps (seconds) to analyze
        confidence_threshold: Minimum confidence for detections

    Returns:
        {
            "status": "success",
            "detections": [
                {"timestamp": 0.0, "boxes": [...]},
                {"timestamp": 0.66, "boxes": [...]},
                ...
            ],
            "video_width": int,
            "video_height": int,
            "fps": float,
            "duration": float
        } or {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    detect_players_batch = _get_detect_players_batch_fn()

    logger.info(f"[Modal] Calling detect_players_batch_modal for {len(timestamps)} timestamps")
    logger.info(f"[Modal] User: {user_id}, Input: {input_key}")
    logger.info(f"[Modal] Timestamps: {timestamps}")

    try:
        result = await asyncio.to_thread(
            detect_players_batch.remote,
            user_id=user_id,
            input_key=input_key,
            timestamps=timestamps,
            confidence_threshold=confidence_threshold,
        )

        if result.get("status") == "success":
            total_detections = sum(len(d.get("boxes", [])) for d in result.get("detections", []))
            logger.info(f"[Modal] Batch detection completed: {total_detections} total players across {len(timestamps)} frames")
        else:
            logger.error(f"[Modal] Batch detection failed: {result.get('error')}")

        return result

    except Exception as e:
        logger.error(f"[Modal] Batch player detection failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def call_modal_extract_clip(
    user_id: str,
    input_key: str,
    output_key: str,
    start_time: float,
    end_time: float,
    copy_codec: bool = True,
) -> dict:
    """
    Call Modal extract_clip_modal function to extract a clip from a video.

    This is a CPU-only operation (no GPU) - just FFmpeg codec copy.

    Args:
        user_id: User folder in R2 (e.g., "a")
        input_key: R2 key for source video (e.g., "games/abc123.mp4")
        output_key: R2 key for output clip (e.g., "clips/def456.mp4")
        start_time: Start time in seconds
        end_time: End time in seconds
        copy_codec: If True, copy codecs (faster); if False, re-encode

    Returns:
        {"status": "success", "output_key": "...", "duration": float} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    extract_clip = _get_extract_clip_fn()

    logger.info(f"[Modal] Calling extract_clip_modal")
    logger.info(f"[Modal] User: {user_id}, Input: {input_key}, Output: {output_key}")
    logger.info(f"[Modal] Time range: {start_time:.2f}s - {end_time:.2f}s")

    try:
        result = await asyncio.to_thread(
            extract_clip.remote,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            start_time=start_time,
            end_time=end_time,
            copy_codec=copy_codec,
        )

        if result.get("status") == "success":
            logger.info(f"[Modal] Clip extraction completed: {result.get('output_key')}")
        else:
            logger.error(f"[Modal] Clip extraction failed: {result.get('error')}")

        return result

    except Exception as e:
        logger.error(f"[Modal] Clip extraction failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def call_modal_annotate_compilation(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    clips: list,
    gallery_output_key: str = None,
    progress_callback = None,
) -> dict:
    """
    Call Modal create_annotated_compilation function.

    Creates a video compilation with burned-in text annotations on Modal cloud.
    Avoids downloading large game videos locally.

    When MODAL_ENABLED=false, uses local FFmpeg with the same interface.
    This enables testing the full code path without Modal costs.

    Args:
        job_id: Unique job identifier
        user_id: User folder in R2 (e.g., "a")
        input_key: R2 key for source game video (e.g., "games/abc123.mp4")
        output_key: R2 key for output compilation (e.g., "downloads/compilation.mp4")
        clips: List of clip data with timestamps, names, ratings, tags, notes
        gallery_output_key: Optional secondary R2 key for gallery
        progress_callback: Optional async callable(progress: float, message: str)

    Returns:
        {"status": "success", "output_key": "...", "gallery_filename": "...", "clips_processed": N} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        # Use local fallback with same interface
        from app.services.local_processors import local_annotate_compilation
        logger.info(f"[Modal] Using local fallback for annotate job {job_id}")
        return await local_annotate_compilation(
            job_id=job_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            clips=clips,
            progress_callback=progress_callback,
        )

    create_annotated_compilation = _get_create_annotated_compilation_fn()

    logger.info(f"[Modal] Calling create_annotated_compilation for job {job_id}")
    logger.info(f"[Modal] User: {user_id}, Input: {input_key} -> Output: {output_key}")
    logger.info(f"[Modal] Clips: {len(clips)}")

    log_progress_event(job_id, "modal_start", extra={"type": "annotate", "clips": len(clips)})

    try:
        # Use remote_gen() to stream real progress from Modal
        # Must iterate in executor to avoid blocking the event loop (like framing does)
        loop = asyncio.get_running_loop()
        start_time = time.time()

        def get_generator():
            return create_annotated_compilation.remote_gen(
                job_id=job_id,
                user_id=user_id,
                input_key=input_key,
                output_key=output_key,
                clips=clips,
                gallery_output_key=gallery_output_key,
            )

        # Get the generator in executor (Modal API is sync)
        gen = await loop.run_in_executor(None, get_generator)

        log_progress_event(job_id, "modal_streaming_started")
        logger.info(f"[Modal] Streaming progress for job {job_id}")

        result = None
        last_progress = 0

        # Helper to get next item without blocking
        def next_item(generator):
            try:
                return next(generator)
            except StopIteration:
                return None

        # Stream progress updates from Modal (non-blocking iteration)
        while True:
            update = await loop.run_in_executor(None, next_item, gen)
            if update is None:
                break

            if isinstance(update, dict):
                progress = update.get("progress", 0)
                message = update.get("message", "Processing...")
                phase = update.get("phase", "processing")
                status = update.get("status")

                # Log progress updates
                if progress != last_progress:
                    logger.info(f"[Modal] Progress: {progress}% - {message}")
                    last_progress = progress

                # Send progress to callback
                if progress_callback and progress < 100:
                    try:
                        await progress_callback(progress, message, phase)
                        # Yield to event loop so WebSocket progress can be sent
                        await asyncio.sleep(0)
                    except Exception as e:
                        logger.warning(f"[Modal] Progress callback failed: {e}")

                # Check for final result
                if status == "success":
                    result = update
                    break
                elif status == "error":
                    result = update
                    break

        elapsed = time.time() - start_time
        log_progress_event(job_id, "modal_complete", elapsed=elapsed)

        if result:
            logger.info(f"[Modal] Annotated compilation job {job_id} completed: {result.get('clips_processed', 0)} clips in {elapsed:.1f}s")
            return result
        else:
            return {"status": "error", "error": "No result from Modal function"}

    except Exception as e:
        logger.error(f"[Modal] Annotated compilation job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


# Test function
if __name__ == "__main__":
    import asyncio

    async def test():
        print(f"Modal enabled: {modal_enabled()}")
        if modal_enabled():
            print("Modal is enabled")
            print("  - render_overlay: Apply highlight overlays (T4 GPU)")
            print("  - process_framing_ai: Crop with Real-ESRGAN AI upscaling (T4 GPU)")
            print("  - detect_players_modal: YOLO player detection (T4 GPU)")
            print("  - extract_clip_modal: FFmpeg clip extraction (CPU)")
            print("  - create_annotated_compilation: Annotated video with text overlays (CPU)")
        else:
            print("Modal is disabled - set MODAL_ENABLED=true to enable")

    asyncio.run(test())
