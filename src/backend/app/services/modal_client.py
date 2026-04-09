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

    result = await call_modal_overlay(
        job_id="...",
        user_id="f47ac10b-58cc-4372-a567-0e02b2c3d479",  # UUID from auth
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
import socket

logger = logging.getLogger(__name__)

# Retry configuration for transient network errors
NETWORK_RETRY_ATTEMPTS = 3
NETWORK_RETRY_DELAY = 2.0  # seconds
NETWORK_RETRY_BACKOFF = 2.0  # exponential backoff multiplier

# Retry configuration for Modal job-level transient failures
MODAL_JOB_RETRY_ATTEMPTS = 3  # total attempts (1 initial + 2 retries)
MODAL_JOB_RETRY_DELAY = 3.0  # initial delay in seconds
MODAL_JOB_RETRY_BACKOFF = 2.0  # exponential backoff multiplier


def _is_transient_network_error(error: Exception) -> bool:
    """
    Check if an error is a transient network error that should be retried.

    These are errors that can happen due to flaky internet connections
    and are likely to succeed on retry.
    """
    error_msg = str(error).lower()

    # DNS resolution failures
    if isinstance(error, socket.gaierror):
        return True

    # Connection errors
    if isinstance(error, (ConnectionError, ConnectionResetError, ConnectionRefusedError)):
        return True

    # Check error message for network-related keywords
    network_keywords = [
        "getaddrinfo failed",
        "name resolution",
        "dns",
        "connection reset",
        "connection refused",
        "connection aborted",
        "network unreachable",
        "host unreachable",
        "temporary failure",
        "timed out",
        "broken pipe",
    ]

    for keyword in network_keywords:
        if keyword in error_msg:
            return True

    return False


def classify_modal_error(error: Exception) -> str:
    """
    Classify a Modal error as 'transient' or 'deterministic'.

    Transient errors are worth retrying (network issues, cold starts, capacity).
    Deterministic errors will fail again on retry (bad input, OOM, FFmpeg errors).

    Returns:
        'transient' or 'deterministic'
    """
    error_msg = str(error).lower()
    error_type = type(error).__name__.lower()

    # --- Transient patterns (should retry) ---
    # Network / connection errors
    if _is_transient_network_error(error):
        return "transient"

    # Modal infrastructure errors
    transient_patterns = [
        "503",
        "capacity",
        "input aborted",
        "not reschedulable",
        "cold start",
        "cold_start",
        "container startup",
        "service unavailable",
        "internal server error",
        "rate limit",
        "too many requests",
    ]
    for pattern in transient_patterns:
        if pattern in error_msg:
            return "transient"

    # Modal-specific exception types that indicate infra issues
    if "modal" in error_type and ("timeout" in error_msg or "unavailable" in error_msg):
        return "transient"

    # --- Deterministic patterns (should NOT retry) ---
    deterministic_patterns = [
        "ffmpeg",
        "broken pipe",
        "out of memory",
        "oom",
        "cuda out of memory",
        "outofmemoryerror",
        "invalid input",
        "invalid crop",
        "no such file",
        "file not found",
        "permission denied",
        "keyerror",
        "valueerror",
        "typeerror",
        "index out of range",
    ]
    for pattern in deterministic_patterns:
        if pattern in error_msg or pattern in error_type:
            return "deterministic"

    # Default: treat unknown errors as deterministic (don't waste retries)
    return "deterministic"


def _log_modal_job_start(
    job_type: str,
    job_id: str,
    user_id: str,
    modal_app: str,
    extra: dict = None,
):
    """Log structured context at Modal job start."""
    parts = [
        f"[Modal Job Start]",
        f"type={job_type}",
        f"job={job_id}",
        f"user={user_id}",
        f"app={modal_app}",
    ]
    if extra:
        for k, v in extra.items():
            parts.append(f"{k}={v}")
    logger.info(" ".join(parts))


def _log_modal_job_end(
    job_type: str,
    job_id: str,
    user_id: str,
    modal_app: str,
    elapsed: float,
    status: str,
    error: Exception = None,
    error_class: str = None,
    attempt: int = None,
    extra: dict = None,
):
    """Log structured context at Modal job completion or failure."""
    parts = [
        f"[Modal Job {'Error' if error else 'Done'}]",
        f"type={job_type}",
        f"job={job_id}",
        f"user={user_id}",
        f"app={modal_app}",
        f"elapsed={elapsed:.2f}s",
        f"status={status}",
    ]
    if attempt is not None:
        parts.append(f"attempt={attempt}/{MODAL_JOB_RETRY_ATTEMPTS}")
    if error_class:
        parts.append(f"error_class={error_class}")
    if error:
        parts.append(f"error={str(error)[:100]}")
    if extra:
        for k, v in extra.items():
            parts.append(f"{k}={v}")
    if error:
        logger.error(" ".join(parts))
    else:
        logger.info(" ".join(parts))


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


def _translate_modal_error(error: Exception) -> str:
    """
    Translate technical Modal errors to user-friendly messages.

    Common Modal errors:
    - "Input aborted - not reschedulable": GPU container was preempted/crashed
    - "CUDA out of memory": GPU ran out of VRAM
    - Timeouts: Container exceeded time limit
    - Network errors: DNS, connection issues
    """
    error_msg = str(error)

    if "Input aborted" in error_msg or "not reschedulable" in error_msg:
        return "GPU processing was interrupted by cloud provider. Please retry - this is temporary."
    elif "CUDA out of memory" in error_msg or "OutOfMemoryError" in error_msg:
        return "GPU ran out of memory. Try processing fewer clips or lower resolution."
    elif "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
        return "Processing took too long and was cancelled. Try shorter clips or fewer clips."

    # Network-related errors - be specific about the cause
    if _is_transient_network_error(error):
        return "Internet connection lost during processing. Please check your connection and retry."
    elif "connection" in error_msg.lower() or "network" in error_msg.lower():
        return "Network error communicating with GPU server. Please retry."

    # Return original if no translation available
    return error_msg


# Modal is available if MODAL_ENABLED=true
_modal_enabled = os.environ.get("MODAL_ENABLED", "false").lower() == "true"

# Modal app name (must match the name in video_processing.py)
MODAL_APP_NAME = "reel-ballers-video-v2"

# Cached function references
_render_overlay_fn = None
_process_framing_ai_fn = None
_process_framing_ai_parallel_fn = None
_process_multi_clip_fn = None
_detect_players_fn = None
_detect_players_batch_fn = None
_extract_clip_fn = None


def modal_enabled() -> bool:
    """Check if Modal processing is enabled."""
    return _modal_enabled


def _resolve_modal_user_id(user_id: str) -> str:
    """Convert raw user_id to R2-prefixed user_id for Modal functions.

    Modal functions construct R2 paths as {user_id}/{key}, so user_id must
    be the full R2 prefix (e.g. "staging/users/a/profiles/default").

    This centralizes the conversion that was previously duplicated in every
    caller (7 sites across 5 files), eliminating a recurring bug class where
    callers forgot to convert and Modal couldn't find files in R2.
    """
    from app.storage import r2_user_prefix, R2_ENABLED
    return r2_user_prefix(user_id) if R2_ENABLED else user_id


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


def _get_process_framing_ai_parallel_fn():
    """Get a reference to the deployed process_framing_ai_parallel function."""
    global _process_framing_ai_parallel_fn

    if _process_framing_ai_parallel_fn is not None:
        return _process_framing_ai_parallel_fn

    try:
        import modal
        _process_framing_ai_parallel_fn = modal.Function.from_name(MODAL_APP_NAME, "process_framing_ai_parallel")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/process_framing_ai_parallel")
        return _process_framing_ai_parallel_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to process_framing_ai_parallel: {e}")
        raise RuntimeError(f"Modal process_framing_ai_parallel not available: {e}")


# GPU thresholds for framing AI parallelization (mirrors video_processing.py)
# Based on E6 benchmark: T4 processes at ~1.47 fps (681ms/frame)
FRAMING_AI_GPU_THRESHOLDS = {
    3: (1, "sequential"),       # 0-3s: 1 GPU
    10: (2, "2-gpu-parallel"),  # 3-10s: 2 GPUs
    float('inf'): (4, "4-gpu-parallel"),  # 10s+: 4 GPUs
}


def get_framing_ai_gpu_config(video_duration: float) -> tuple:
    """
    Get optimal GPU config for framing_ai based on video duration.

    Returns:
        (num_chunks, description) tuple
    """
    for threshold, config in sorted(FRAMING_AI_GPU_THRESHOLDS.items()):
        if video_duration < threshold:
            return config
    return (4, "4-gpu-parallel")


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
    test_mode: bool = False,
    source_start_time: float = 0.0,
    source_end_time: float = None,
) -> dict:
    """
    Call Modal process_framing_ai function for AI-upscaled crop exports.

    Three modes:
    1. test_mode=True: Fast FFmpeg crop+resize (no AI, for E2E tests)
    2. MODAL_ENABLED=false: Local Real-ESRGAN/FFmpeg
    3. MODAL_ENABLED=true: Cloud GPU via Modal

    Args:
        job_id: Unique export job identifier
        user_id: Raw user ID (R2 prefix conversion handled internally)
        input_key: R2 key for source video (games/{hash}.mp4 or raw_clips/{file})
        output_key: R2 key for output video
        keyframes: Crop keyframes [{time, x, y, width, height}, ...]
        output_width: Target width (default 810 for 9:16)
        output_height: Target height (default 1440)
        fps: Target frame rate (default 30)
        segment_data: Optional trim/speed data
        video_duration: Video duration in seconds (for progress estimation)
        progress_callback: async callable(progress: float, message: str, phase: str) for updates
        call_id_callback: Optional callable(call_id: str) - NOT USED with remote_gen
        test_mode: Skip AI upscaling, use fast FFmpeg crop+resize (for E2E tests)
        source_start_time: Start time of clip in source video (seconds)
        source_end_time: End time of clip in source video (seconds). None = full video.

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    if test_mode:
        # Fast FFmpeg crop+resize - no AI, for E2E tests
        from app.services.local_processors import local_framing_mock
        logger.info(f"[Modal] Using TEST MODE mock for framing job {job_id}")
        return await local_framing_mock(
            job_id=job_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            keyframes=keyframes,
            output_width=output_width,
            output_height=output_height,
            progress_callback=progress_callback,
            source_start_time=source_start_time,
            source_end_time=source_end_time,
        )

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
            source_start_time=source_start_time,
            source_end_time=source_end_time,
        )

    # Convert raw user_id to R2-prefixed user_id for Modal
    user_id = _resolve_modal_user_id(user_id)

    # Determine parallelization strategy based on video duration
    effective_duration = video_duration or 10  # Default to 10s if unknown
    num_chunks, config_name = get_framing_ai_gpu_config(effective_duration)

    estimated_frames = int(effective_duration * fps)

    _log_modal_job_start(
        job_type="framing_ai",
        job_id=job_id,
        user_id=user_id,
        modal_app=MODAL_APP_NAME,
        extra={
            "config": config_name,
            "num_chunks": num_chunks,
            "resolution": f"{output_width}x{output_height}",
            "duration": f"{effective_duration:.1f}s",
            "frames": estimated_frames,
            "input": input_key,
            "output": output_key,
        },
    )

    # Track timing for progress improvement
    job_start_time = time.time()
    log_progress_event(job_id, "modal_start", extra={
        "type": "framing_ai",
        "frames": estimated_frames,
        "config": config_name,
        "num_chunks": num_chunks,
    })

    last_error = None
    for attempt in range(1, MODAL_JOB_RETRY_ATTEMPTS + 1):
        try:
            # Use remote_gen() to stream real progress from Modal
            # This iterates over yield statements in the Modal function
            loop = asyncio.get_running_loop()

            # Choose parallel or sequential processing
            if num_chunks > 1 and segment_data is None:
                # Use parallel processing (not supported with segment_data/speed changes yet)
                process_fn = _get_process_framing_ai_parallel_fn()
                logger.info(f"[Modal] Using parallel processing with {num_chunks} chunks")

                def get_generator():
                    return process_fn.remote_gen(
                        job_id=job_id,
                        user_id=user_id,
                        input_key=input_key,
                        output_key=output_key,
                        keyframes=keyframes,
                        output_width=output_width,
                        output_height=output_height,
                        fps=fps,
                        num_chunks=num_chunks,
                        include_audio=include_audio,
                        source_start_time=source_start_time,
                        source_end_time=source_end_time,
                    )
            else:
                # Use sequential processing
                process_fn = _get_process_framing_ai_fn()
                if segment_data:
                    logger.info(f"[Modal] Using sequential processing (segment_data present)")
                else:
                    logger.info(f"[Modal] Using sequential processing (short video)")

                def get_generator():
                    return process_fn.remote_gen(
                        job_id=job_id,
                        user_id=user_id,
                        input_key=input_key,
                        output_key=output_key,
                        keyframes=keyframes,
                        output_width=output_width,
                        output_height=output_height,
                        fps=fps,
                        segment_data=segment_data,
                        include_audio=include_audio,
                        source_start_time=source_start_time,
                        source_end_time=source_end_time,
                    )

            # Get the generator in executor (Modal API is sync)
            gen = await loop.run_in_executor(None, get_generator)

            # Capture Modal call ID for correlation
            modal_call_id = None
            try:
                if hasattr(gen, 'object_id'):
                    modal_call_id = gen.object_id
                    logger.info(f"[Modal] Framing AI call_id: {modal_call_id}")
            except Exception:
                pass

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

            _log_modal_job_end(
                job_type="framing_ai",
                job_id=job_id,
                user_id=user_id,
                modal_app=MODAL_APP_NAME,
                elapsed=total_elapsed,
                status=result.get("status", "unknown") if result else "no_result",
                extra={"call_id": modal_call_id or "unknown", "frames": frames_processed},
            )

            final = result or {"status": "error", "error": "No result received from Modal"}
            final["gpu_seconds"] = round(total_elapsed, 2)
            final["modal_function"] = "framing"
            return final

        except Exception as e:
            last_error = e
            total_elapsed = time.time() - job_start_time
            error_class = classify_modal_error(e)

            _log_modal_job_end(
                job_type="framing_ai",
                job_id=job_id,
                user_id=user_id,
                modal_app=MODAL_APP_NAME,
                elapsed=total_elapsed,
                status="error",
                error=e,
                error_class=error_class,
                attempt=attempt,
            )

            if error_class == "transient" and attempt < MODAL_JOB_RETRY_ATTEMPTS:
                delay = MODAL_JOB_RETRY_DELAY * (MODAL_JOB_RETRY_BACKOFF ** (attempt - 1))
                logger.warning(
                    f"[Modal] Transient error on attempt {attempt}/{MODAL_JOB_RETRY_ATTEMPTS}, "
                    f"retrying in {delay:.0f}s: {e}"
                )
                if progress_callback:
                    try:
                        await progress_callback(
                            -1,
                            f"Retrying... attempt {attempt + 1}/{MODAL_JOB_RETRY_ATTEMPTS}",
                            "retry",
                        )
                    except Exception:
                        pass
                await asyncio.sleep(delay)
                continue
            else:
                break

    # All retries exhausted or deterministic error
    total_elapsed = time.time() - job_start_time
    log_progress_event(job_id, "modal_error", elapsed=total_elapsed, extra={"error": str(last_error)[:50]})
    logger.error(f"[Modal] AI framing job {job_id} failed: {last_error}", exc_info=True)
    return {"status": "error", "error": _translate_modal_error(last_error)}


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
    call_id_callback = None,
) -> dict:
    """
    Call unified Modal process_clips_ai function for AI-upscaled exports.

    Handles both single-clip and multi-clip exports with real-time progress streaming.
    Includes retry logic for transient network errors.

    Args:
        job_id: Unique export job identifier
        user_id: Raw user ID (R2 prefix conversion handled internally)
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
        call_id_callback: Optional callable(modal_call_id: str) to store call ID for recovery

    Returns:
        {"status": "success", "output_key": "...", "clips_processed": N} or
        {"status": "error", "error": "..."} or
        {"status": "connection_lost", "error": "...", "recoverable": True}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    # Convert raw user_id to R2-prefixed user_id for Modal
    user_id = _resolve_modal_user_id(user_id)

    total_clips = len(clips_data)

    _log_modal_job_start(
        job_type="clips_ai",
        job_id=job_id,
        user_id=user_id,
        modal_app=MODAL_APP_NAME,
        extra={
            "clips": total_clips,
            "resolution": f"{target_width}x{target_height}",
            "fps": fps,
            "output": output_key,
        },
    )

    job_start_time = time.time()
    log_progress_event(job_id, "modal_start", extra={"type": "clips_ai", "clips": total_clips})

    # Retry logic for initial connection
    last_error = None
    for attempt in range(NETWORK_RETRY_ATTEMPTS):
        try:
            process_clips_ai = _get_process_clips_ai_fn()

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

            # Try to get the Modal call_id for recovery
            try:
                if hasattr(gen, 'object_id'):
                    modal_call_id = gen.object_id
                    if call_id_callback and modal_call_id:
                        call_id_callback(modal_call_id)
                        logger.info(f"[Modal] Stored call_id for recovery: {modal_call_id[:20]}...")
            except Exception as e:
                logger.warning(f"[Modal] Could not get call_id for recovery: {e}")

            log_progress_event(job_id, "modal_streaming_started")
            logger.info(f"[Modal] Streaming progress for job {job_id}")

            result = None
            last_progress = None
            job_started = False  # Track if Modal actually started processing

            def next_item(generator):
                try:
                    return next(generator)
                except StopIteration:
                    return None

            while True:
                try:
                    update = await loop.run_in_executor(None, next_item, gen)
                except Exception as stream_error:
                    # Connection lost during streaming
                    if _is_transient_network_error(stream_error):
                        total_elapsed = time.time() - job_start_time
                        log_progress_event(job_id, "modal_connection_lost", elapsed=total_elapsed)
                        logger.warning(f"[Modal] Connection lost during streaming for job {job_id}: {stream_error}")

                        # If the job started (we got at least one progress update), it may complete on Modal
                        if job_started:
                            return {
                                "status": "connection_lost",
                                "error": "Internet connection lost. Your export may still complete - check back in a few minutes.",
                                "recoverable": True,
                                "message": "Connection lost but job may still be running. Use 'Check Status' to see if it completed.",
                            }
                        else:
                            # Job never started - retry
                            raise stream_error
                    else:
                        raise stream_error

                if update is None:
                    break

                job_started = True  # We received at least one update

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
            final = result or {"status": "error", "error": "No result received from Modal"}
            final["gpu_seconds"] = round(total_elapsed, 2)
            final["modal_function"] = "overlay"
            return final

        except Exception as e:
            last_error = e
            if _is_transient_network_error(e) and attempt < NETWORK_RETRY_ATTEMPTS - 1:
                delay = NETWORK_RETRY_DELAY * (NETWORK_RETRY_BACKOFF ** attempt)
                logger.warning(f"[Modal] Network error on attempt {attempt + 1}, retrying in {delay}s: {e}")
                await asyncio.sleep(delay)
                continue
            else:
                # Non-retryable error or exhausted retries
                break

    # All retries exhausted or non-retryable error
    total_elapsed = time.time() - job_start_time
    log_progress_event(job_id, "modal_error", elapsed=total_elapsed, extra={"error": str(last_error)[:50]})
    logger.error(f"[Modal] Clips AI job {job_id} failed: {last_error}", exc_info=True)

    # Return recoverable status for network errors (job might still be running on Modal)
    if _is_transient_network_error(last_error):
        return {
            "status": "connection_lost",
            "error": "Internet connection lost. Your export may still complete - check back in a few minutes.",
            "recoverable": True,
            "message": "Connection lost. Use 'Check Status' to see if the export completed.",
        }

    return {"status": "error", "error": _translate_modal_error(last_error)}


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
        user_id: Raw user ID (R2 prefix conversion handled internally)
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

    # Convert raw user_id to R2-prefixed user_id for Modal
    user_id = _resolve_modal_user_id(user_id)

    process_multi_clip = _get_process_multi_clip_fn()

    # Estimate processing time: ~1.0s per frame total on T4 GPU for Real-ESRGAN
    # Assume ~10s per clip at 30fps = 300 frames per clip
    estimated_frames_per_clip = 300
    total_frames = len(clips_data) * estimated_frames_per_clip
    estimated_time = total_frames * 1.0  # seconds total

    _log_modal_job_start(
        job_type="framing_ai_multiclip",
        job_id=job_id,
        user_id=user_id,
        modal_app=MODAL_APP_NAME,
        extra={
            "clips": len(clips_data),
            "resolution": f"{target_width}x{target_height}",
            "estimated_frames": total_frames,
            "estimated_time": f"{estimated_time:.0f}s",
            "output": output_key,
        },
    )

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

        _log_modal_job_end(
            job_type="framing_ai_multiclip",
            job_id=job_id,
            user_id=user_id,
            modal_app=MODAL_APP_NAME,
            elapsed=total_elapsed,
            status=result.get("status", "unknown"),
            extra={"call_id": modal_call_id or "unknown", "clips": len(clips_data)},
        )

        return result

    except Exception as e:
        total_elapsed = time.time() - job_start_time
        error_class = classify_modal_error(e)
        log_progress_event(job_id, "modal_error", elapsed=total_elapsed, extra={"error": str(e)[:50]})

        _log_modal_job_end(
            job_type="framing_ai_multiclip",
            job_id=job_id,
            user_id=user_id,
            modal_app=MODAL_APP_NAME,
            elapsed=total_elapsed,
            status="error",
            error=e,
            error_class=error_class,
            extra={"call_id": modal_call_id or "unknown"},
        )

        # Check if this is a transient/connection error
        is_connection_error = error_class == "transient" or _is_transient_network_error(e)

        if modal_call_id and is_connection_error:
            # Connection error while polling - job may still be running on Modal
            logger.warning(f"[Modal] Connection lost while polling job {job_id}: {e}")
            logger.info(f"[Modal] Job {job_id} may still be running, returning recoverable status (call_id: {modal_call_id})")
            return {"status": "connection_lost", "call_id": modal_call_id, "message": "Connection lost but job may still be running. Refresh to check status."}

        logger.error(f"[Modal] Multi-clip job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": _translate_modal_error(e)}


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
        user_id: Raw user ID (R2 prefix conversion handled internally)
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

    # Convert raw user_id to R2-prefixed user_id for Modal
    user_id = _resolve_modal_user_id(user_id)

    render_overlay = _get_render_overlay_fn()

    estimated_frames = int((video_duration or 10) * 30)  # Assume 30fps

    _log_modal_job_start(
        job_type="overlay",
        job_id=job_id,
        user_id=user_id,
        modal_app=MODAL_APP_NAME,
        extra={
            "regions": len(highlight_regions),
            "effect": effect_type,
            "duration": f"{video_duration or 'unknown'}s",
            "frames": estimated_frames,
            "input": input_key,
            "output": output_key,
        },
    )

    # Track timing for progress improvement
    job_start_time = time.time()
    log_progress_event(job_id, "modal_start", extra={"type": "overlay", "frames": estimated_frames})

    last_error = None
    for attempt in range(1, MODAL_JOB_RETRY_ATTEMPTS + 1):
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

            # Capture Modal call ID for correlation
            modal_call_id = None
            try:
                if hasattr(gen, 'object_id'):
                    modal_call_id = gen.object_id
                    logger.info(f"[Modal] Overlay call_id: {modal_call_id}")
            except Exception:
                pass

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

            _log_modal_job_end(
                job_type="overlay",
                job_id=job_id,
                user_id=user_id,
                modal_app=MODAL_APP_NAME,
                elapsed=total_elapsed,
                status=result.get("status", "unknown") if result else "no_result",
                extra={"call_id": modal_call_id or "unknown", "frames": estimated_frames},
            )

            final = result or {"status": "error", "error": "No result received from Modal"}
            final["gpu_seconds"] = round(total_elapsed, 2)
            final["modal_function"] = "overlay"
            return final

        except Exception as e:
            last_error = e
            total_elapsed = time.time() - job_start_time
            error_class = classify_modal_error(e)

            _log_modal_job_end(
                job_type="overlay",
                job_id=job_id,
                user_id=user_id,
                modal_app=MODAL_APP_NAME,
                elapsed=total_elapsed,
                status="error",
                error=e,
                error_class=error_class,
                attempt=attempt,
            )

            if error_class == "transient" and attempt < MODAL_JOB_RETRY_ATTEMPTS:
                delay = MODAL_JOB_RETRY_DELAY * (MODAL_JOB_RETRY_BACKOFF ** (attempt - 1))
                logger.warning(
                    f"[Modal] Transient error on attempt {attempt}/{MODAL_JOB_RETRY_ATTEMPTS}, "
                    f"retrying in {delay:.0f}s: {e}"
                )
                if progress_callback:
                    try:
                        await progress_callback(
                            -1,
                            f"Retrying... attempt {attempt + 1}/{MODAL_JOB_RETRY_ATTEMPTS}",
                            "retry",
                        )
                    except Exception:
                        pass
                await asyncio.sleep(delay)
                continue
            else:
                break

    # All retries exhausted or deterministic error
    total_elapsed = time.time() - job_start_time
    log_progress_event(job_id, "modal_error", elapsed=total_elapsed, extra={"error": str(last_error)[:50]})
    logger.error(f"[Modal] Overlay job {job_id} failed: {last_error}", exc_info=True)
    return {"status": "error", "error": _translate_modal_error(last_error)}


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
        user_id: Raw user ID (R2 prefix conversion handled internally)
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
        user_id: Raw user ID (R2 prefix conversion handled internally)
        input_key: R2 key for input video
        frame_number: Frame number to analyze
        confidence_threshold: Minimum confidence for detections

    Returns:
        {"status": "success", "detections": [...], "video_width": int, "video_height": int} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    # Convert raw user_id to R2-prefixed user_id for Modal
    user_id = _resolve_modal_user_id(user_id)

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
        return {"status": "error", "error": _translate_modal_error(e)}


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
        user_id: Raw user ID (R2 prefix conversion handled internally)
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

    # Convert raw user_id to R2-prefixed user_id for Modal
    user_id = _resolve_modal_user_id(user_id)

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
        return {"status": "error", "error": _translate_modal_error(e)}


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
        user_id: Raw user ID (R2 prefix conversion handled internally)
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

    # Convert raw user_id to R2-prefixed user_id for Modal
    user_id = _resolve_modal_user_id(user_id)

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
        return {"status": "error", "error": _translate_modal_error(e)}



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
        else:
            print("Modal is disabled - set MODAL_ENABLED=true to enable")

    asyncio.run(test())
