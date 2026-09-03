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

import asyncio
import logging
import multiprocessing
import multiprocessing.managers
import os
import socket
import time
from concurrent.futures import ProcessPoolExecutor

logger = logging.getLogger(__name__)

# --- Subprocess isolation for local processing (T2640) ---

_process_pool: ProcessPoolExecutor | None = None
_mp_manager: multiprocessing.managers.SyncManager | None = None


def _get_process_pool() -> ProcessPoolExecutor:
    global _process_pool
    if _process_pool is None:
        _process_pool = ProcessPoolExecutor(max_workers=2)
    return _process_pool


def _get_mp_manager() -> multiprocessing.managers.SyncManager:
    global _mp_manager
    if _mp_manager is None:
        _mp_manager = multiprocessing.Manager()
    return _mp_manager


def _subprocess_worker(sync_fn, kwargs, queue):
    """Run sync_fn in child process, sending progress via manager queue."""
    def progress_sink(pct, msg, phase):
        try:
            queue.put_nowait({"type": "progress", "progress": pct, "message": msg, "phase": phase})
        except Exception:
            pass

    kwargs["progress_callback"] = progress_sink
    try:
        return sync_fn(**kwargs)
    except Exception as e:
        return {"status": "error", "error": str(e)}


async def _run_in_subprocess(sync_fn, kwargs: dict, progress_callback=None) -> dict:
    """Execute sync_fn in a subprocess, bridging progress to async callback."""
    queue = _get_mp_manager().Queue()
    loop = asyncio.get_running_loop()
    pool = _get_process_pool()

    future = loop.run_in_executor(pool, _subprocess_worker, sync_fn, kwargs, queue)

    while not future.done():
        while True:
            try:
                msg = queue.get_nowait()
                if progress_callback and msg.get("type") == "progress":
                    await progress_callback(msg["progress"], msg["message"], msg["phase"])
            except Exception:
                break
        await asyncio.sleep(0.05)

    # Drain remaining progress messages after process completes
    while True:
        try:
            msg = queue.get_nowait()
            if progress_callback and msg.get("type") == "progress":
                await progress_callback(msg["progress"], msg["message"], msg["phase"])
        except Exception:
            break

    return future.result()

# Retry configuration for transient network errors
NETWORK_RETRY_ATTEMPTS = 3
NETWORK_RETRY_DELAY = 2.0  # seconds
NETWORK_RETRY_BACKOFF = 2.0  # exponential backoff multiplier

# Retry configuration for Modal job-level transient failures
MODAL_JOB_RETRY_ATTEMPTS = 3  # total attempts (1 initial + 2 retries)
MODAL_JOB_RETRY_DELAY = 3.0  # initial delay in seconds
MODAL_JOB_RETRY_BACKOFF = 2.0  # exponential backoff multiplier

# E6 benchmark anchor (.claude/knowledge/modal-gpu.md): T4 GPU sequential upscale
# throughput. A rough per-clip expected-duration estimate for the slow-job warning
# below, not a hard guarantee -- GPU contention/cold draws vary this legitimately.
MODAL_UPSCALE_SECONDS_PER_FRAME_ANCHOR = 0.681
SLOW_MODAL_JOB_THRESHOLD_MULTIPLIER = 2.0


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

    return any(keyword in error_msg for keyword in network_keywords)


def classify_modal_error(error: Exception) -> str:
    """
    Classify a Modal error as 'transient' or 'deterministic'.

    Transient errors are worth retrying (network issues, cold starts, capacity).
    Deterministic errors will fail again on retry (bad input, OOM, FFmpeg errors).

    Returns:
        'transient' or 'deterministic'
    """
    if isinstance(error, asyncio.TimeoutError):
        return "transient"

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
    extra: dict | None = None,
):
    """Log structured context at Modal job start."""
    parts = [
        "[Modal Job Start]",
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
    error: Exception | None = None,
    error_class: str | None = None,
    attempt: int | None = None,
    extra: dict | None = None,
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


def log_progress_event(job_id: str, phase: str, elapsed: float | None = None, extra: dict | None = None):
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


def resolve_modal_app_name(app_env: str) -> str:
    """Resolve the Modal app name for an environment (T8270).

    Staging and production must target DIFFERENT Modal apps so a `modal deploy`
    can be soaked on staging before it reaches prod's paying users. This is the
    SINGLE source of truth for the name; `video_processing.py` keeps a byte-for-byte
    copy of this logic (it CANNOT import this module -- the deployed Modal container
    image does not mount the `app` package, see the comments at its top). The parity
    is enforced structurally by `test_modal_app_name.py`, which imports both and
    asserts they agree, so the two copies cannot silently drift.

    No silent fallback: an unrecognized/misconfigured `app_env` RAISES rather than
    defaulting to the prod name. Pointing staging (or a typo'd env) at the prod Modal
    app is exactly the failure this task exists to prevent, so it must fail loudly.
    `dev`/`development`/`local`/`test` get their own clearly-non-prod name (Modal is
    off in dev, T4180, but the name must still never collide with prod).
    """
    if app_env == "production":
        return "reel-ballers-video-v2"
    if app_env == "staging":
        return "reel-ballers-video-v2-staging"
    if app_env in ("dev", "development", "local", "test"):
        return "reel-ballers-video-v2-dev"
    raise RuntimeError(
        f"Cannot resolve Modal app name: unrecognized APP_ENV={app_env!r}. "
        "Expected one of production/staging/dev/development/local/test. "
        "Refusing to guess -- a wrong guess could point traffic at the prod Modal app."
    )


# Modal app name, resolved per-environment (must match video_processing.py's copy).
from app.storage import APP_ENV  # noqa: E402  (env source of truth; no circular import)

MODAL_APP_NAME = resolve_modal_app_name(APP_ENV)

# Cached function references
_render_overlay_fn = None
_process_framing_ai_fn = None
_process_framing_ai_parallel_fn = None
_detect_players_fn = None
_detect_players_batch_fn = None


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
    from app.storage import R2_ENABLED, r2_user_prefix
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
        raise RuntimeError(f"Modal render_overlay not available: {e}") from e


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
        raise RuntimeError(f"Modal process_framing_ai not available: {e}") from e


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
        raise RuntimeError(f"Modal process_framing_ai_parallel not available: {e}") from e


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
        raise RuntimeError(f"Modal detect_players_modal not available: {e}") from e


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
        raise RuntimeError(f"Modal detect_players_batch_modal not available: {e}") from e


# Cached reference for unified function
_process_clips_ai_fn = None

# Cached reference for the CPU-only collection stitcher (T4945)
_stitch_members_fn = None


def _get_stitch_members_fn():
    """Get a reference to the deployed stitch_members function (T4945, CPU-only
    ffmpeg muxer for collection downloads)."""
    global _stitch_members_fn

    if _stitch_members_fn is not None:
        return _stitch_members_fn

    try:
        import modal
        _stitch_members_fn = modal.Function.from_name(MODAL_APP_NAME, "stitch_members")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/stitch_members")
        return _stitch_members_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to stitch_members: {e}")
        raise RuntimeError(f"Modal stitch_members not available: {e}") from e


async def call_modal_stitch_members(
    user_prefix: str, input_keys: list[str], output_key: str,
) -> dict:
    """Route a collection member-stitch to the CPU-only Modal `stitch_members`
    function (T4945 EPIC decision 1: keep the arbitrary-N concat/re-encode off
    the single shared app server; no GPU is involved).

    `user_prefix` MUST be the ALREADY-R2-resolved prefix (call
    `_resolve_modal_user_id` while the request's profile ContextVar is still
    alive). This wrapper deliberately does NOT re-resolve it -- the owner
    download invokes this from inside a StreamingResponse generator, after the
    request context has torn down, where the ContextVar is gone (T5220 gotcha).

    Returns `{"output_key", "duration"}`. Raises (RuntimeError, via
    `_get_stitch_members_fn`) if the function isn't deployed -- the caller
    degrades non-fatally.
    """
    fn = _get_stitch_members_fn()
    # stitch_members is a plain (non-generator) function -> .remote returns its
    # dict result directly; run the blocking call off the event loop.
    return await asyncio.to_thread(fn.remote, user_prefix, input_keys, output_key)


# Cached reference for the CPU-only serve-time composer (T7090 Phase 3)
_compose_fn = None


def _get_compose_fn():
    """Get a reference to the deployed compose_serve_time_modal function (T7090
    Phase 3, CPU-only ffmpeg card-burn + concat for download-time compose).

    NOTE: `compose_serve_time_modal` must be MANUALLY DEPLOYED
    (`modal deploy app/modal_functions/video_processing.py`) -- like every other
    function in that module it does NOT auto-deploy. Until it is deployed this
    `from_name` raises RuntimeError, and the dispatch caller degrades non-fatally
    to the local `compose_serve_time` (the Modal-off path)."""
    global _compose_fn

    if _compose_fn is not None:
        return _compose_fn

    try:
        import modal
        _compose_fn = modal.Function.from_name(MODAL_APP_NAME, "compose_serve_time_modal")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/compose_serve_time_modal")
        return _compose_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to compose_serve_time_modal: {e}")
        raise RuntimeError(f"Modal compose_serve_time_modal not available: {e}") from e


async def call_modal_compose(
    user_prefix: str,
    reel_key: str,
    card_plan: dict | None,
    intro_layer_keys: list[str],
    outro_enabled: bool,
    out_key: str,
) -> dict:
    """Route a download-time compose ([intro?][reel][outro?]) to the CPU-only
    Modal `compose_serve_time_modal` function (T7090 Phase 3): the OOM-prone
    ffmpeg card-burn + concat runs on Modal's headroom instead of the 1GB Fly box.

    The app renders the intro-card PNG layers (cheap PIL) and uploads them to an
    R2 scratch prefix; `card_plan` is the JSON plan (from
    `player_intro._plan_card_render`) describing the burn over those PNGs.
    `card_plan=None` and an empty `intro_layer_keys` means no intro segment.

    `user_prefix` MUST be the ALREADY-R2-resolved prefix. This wrapper does NOT
    resolve it, for two reasons: (1) the SHARE download composes objects under the
    SHARER's prefix, which is NOT derivable from the viewer's request context at
    all -- it must be passed explicitly; (2) defensiveness -- the caller owns
    resolving `_resolve_modal_user_id(user_id)` under the correct profile context
    (the owner/collection paths resolve it inside the request's own to_thread
    worker, where the profile ContextVar is still propagated).

    Returns `{"out_key", "duration", "full_fidelity", "degraded_reason"}`. Raises
    (RuntimeError, via `_get_compose_fn`) if the function isn't deployed -- the
    caller degrades non-fatally to the local compose.
    """
    fn = _get_compose_fn()
    return await asyncio.to_thread(
        fn.remote, user_prefix, reel_key, card_plan, intro_layer_keys,
        outro_enabled, out_key,
    )


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
        raise RuntimeError(f"Modal process_clips_ai not available: {e}") from e




async def call_modal_framing_ai(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict | None = None,
    video_duration: float | None = None,
    progress_callback = None,
    call_id_callback = None,
    include_audio: bool = True,
    export_mode: str = "quality",
    test_mode: bool = False,
    source_start_time: float = 0.0,
    source_end_time: float | None = None,
    profile_id: str | None = None,
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
        from app.services.local_processors import _framing_sync
        logger.info(f"[Modal] Using local subprocess for framing job {job_id}")
        return await _run_in_subprocess(
            _framing_sync,
            {
                "job_id": job_id,
                "user_id": user_id,
                "input_key": input_key,
                "output_key": output_key,
                "keyframes": keyframes,
                "output_width": output_width,
                "output_height": output_height,
                "fps": fps,
                "video_duration": video_duration,
                "segment_data": segment_data,
                "include_audio": include_audio,
                "export_mode": export_mode,
                "source_start_time": source_start_time,
                "source_end_time": source_end_time,
                "profile_id": profile_id,
            },
            progress_callback=progress_callback,
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

                def get_generator(process_fn=process_fn):
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
                    logger.info("[Modal] Using sequential processing (segment_data present)")
                else:
                    logger.info("[Modal] Using sequential processing (short video)")

                def get_generator(process_fn=process_fn):
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

            # remote_gen() returns a plain generator with no call-id handle (unlike
            # call_modal_clips_ai, this path doesn't have the Modal function emit its
            # own call id as a stream item) -- not available for this call type.
            modal_call_id = None

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
    transition: dict | None = None,
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
        call_id_callback: Optional callable(modal_call_id: str), invoked when the Modal
            container emits its own call id as the first stream item (remote_gen() gives
            the caller no handle to it directly -- see process_clips_ai's first yield)

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

    # Rough expected-duration estimate for the slow-job warning below (E6 anchor).
    expected_total_frames = sum((c.get('duration', 15.0) or 15.0) * fps for c in clips_data)
    expected_seconds = expected_total_frames * MODAL_UPSCALE_SECONDS_PER_FRAME_ANCHOR

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

            def get_generator(process_clips_ai=process_clips_ai):
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
            job_started = False  # Track if Modal actually started processing
            modal_call_id = None  # gen has no .object_id (plain generator, not a
            # FunctionCall) -- captured from the first stream item instead, which the
            # Modal function emits via modal.current_function_call_id().
            slow_job_warned = False

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

                if modal_call_id is None:
                    cid = update.get("modal_call_id")
                    if cid:
                        modal_call_id = cid
                        if call_id_callback:
                            call_id_callback(cid)
                        logger.info(f"[Modal] Stored call_id for recovery: {cid}")
                        # This item is a pure dispatch marker (progress=0, no real
                        # status) -- forwarding it to progress_callback would show
                        # the UI a backwards jump after the 5% "Starting..." tick.
                        continue

                if not slow_job_warned and expected_seconds > 0:
                    elapsed_so_far = time.time() - job_start_time
                    if elapsed_so_far > expected_seconds * SLOW_MODAL_JOB_THRESHOLD_MULTIPLIER:
                        slow_job_warned = True
                        logger.warning(
                            f"[SLOW MODAL JOB] job={job_id} elapsed={elapsed_so_far:.1f}s "
                            f"expected~{expected_seconds:.1f}s (E6 anchor) -- still running, "
                            f"not necessarily stuck (see modal app logs for per-frame progress)"
                        )

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
            logger.info(f"[Modal] Clips AI job {job_id} completed (call_id={modal_call_id}): {result}")
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


async def call_modal_overlay(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
    video_duration: float | None = None,
    progress_callback = None,
    call_id_callback = None,
    overlay_settings: dict | None = None,
    profile_id: str | None = None,
    text_layers: list | None = None,
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
        from app.services.local_processors import _overlay_sync
        logger.info(f"[Modal] Using local subprocess for overlay job {job_id}")
        return await _run_in_subprocess(
            _overlay_sync,
            {
                "job_id": job_id,
                "user_id": user_id,
                "input_key": input_key,
                "output_key": output_key,
                "highlight_regions": highlight_regions,
                "effect_type": effect_type,
                "video_duration": video_duration,
                "overlay_settings": overlay_settings,
                "profile_id": profile_id,
                "text_layers": text_layers,
            },
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
                    overlay_settings=overlay_settings or {},
                    text_layers=text_layers or [],
                )

            # Get the generator in executor (Modal API is sync)
            gen = await loop.run_in_executor(None, get_generator)

            # remote_gen() returns a plain generator with no call-id handle (unlike
            # call_modal_clips_ai, this path doesn't have the Modal function emit its
            # own call id as a stream item) -- not available for this call type.
            modal_call_id = None

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
    video_duration: float | None = None,
    progress_callback = None,
    call_id_callback = None,
    overlay_settings: dict | None = None,
    profile_id: str | None = None,
    text_layers: list | None = None,
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
        overlay_settings=overlay_settings,
        profile_id=profile_id,
        text_layers=text_layers,
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
            print("  - process_clips_ai: Unified multi-clip AI upscaling (GPU)")
        else:
            print("Modal is disabled - set MODAL_ENABLED=true to enable")

    asyncio.run(test())
