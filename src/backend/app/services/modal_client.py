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

logger = logging.getLogger(__name__)

# Modal is available if MODAL_ENABLED=true
_modal_enabled = os.environ.get("MODAL_ENABLED", "false").lower() == "true"

# Modal app name (must match the name in video_processing.py)
MODAL_APP_NAME = "reel-ballers-video"

# Cached function references
_render_overlay_fn = None
_render_overlay_parallel_fn = None
_process_framing_fn = None
_process_framing_ai_fn = None
_detect_players_fn = None

# Cost-optimized GPU configuration thresholds
# Based on analysis with CPU orchestrator:
# - Sequential is cheaper but slower for long videos
# - 2 GPUs has best cost/time ratio for medium videos
# - 4/8 GPUs for when time matters more than cost
#
# Cost model (GPU-seconds):
#   1 GPU:  5 + F/60      (base 5s startup)
#   2 GPUs: 14 + F/60     (2 workers × 7s startup)
#   4 GPUs: 28 + F/60     (4 workers × 7s startup)
#   8 GPUs: 56 + F/60     (8 workers × 7s startup)
#
# Time model (wall-clock seconds):
#   1 GPU:  5 + F/60      (sequential processing)
#   2 GPUs: 12 + F/120    (orchestrator overhead + parallel)
#   4 GPUs: 12 + F/240
#   8 GPUs: 12 + F/480
#
# Time break-even: 1 vs 2 at ~28s, 1 vs 4 at ~19s, 1 vs 8 at ~16s
# Cost-optimized thresholds (higher to favor cheaper sequential):

GPU_CONFIG_THRESHOLDS = [
    # (max_duration, num_chunks, description)
    (30, 1, "sequential"),       # 0-30s: 1 GPU - sequential is both faster AND cheaper
    (90, 2, "2-gpu-parallel"),   # 30-90s: 2 GPUs - best cost/time ratio
    (180, 4, "4-gpu-parallel"),  # 90-180s: 4 GPUs - worth extra cost for time
    (float('inf'), 8, "8-gpu-parallel"),  # 180s+: 8 GPUs - max parallelism
]


def get_optimal_gpu_config(video_duration: float) -> tuple:
    """
    Get the cost-optimal GPU configuration for a given video duration.

    Returns:
        (num_chunks, description)
        - num_chunks=1 means sequential processing
        - num_chunks>1 means parallel with that many GPU workers
    """
    if video_duration is None:
        return (1, "sequential")  # Default to sequential if unknown

    for max_duration, num_chunks, desc in GPU_CONFIG_THRESHOLDS:
        if video_duration < max_duration:
            return (num_chunks, desc)

    return (8, "8-gpu-parallel")  # Fallback


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


def _get_render_overlay_parallel_fn():
    """Get a reference to the deployed render_overlay_parallel function."""
    global _render_overlay_parallel_fn

    if _render_overlay_parallel_fn is not None:
        return _render_overlay_parallel_fn

    try:
        import modal
        _render_overlay_parallel_fn = modal.Function.from_name(MODAL_APP_NAME, "render_overlay_parallel")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/render_overlay_parallel")
        return _render_overlay_parallel_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to render_overlay_parallel: {e}")
        raise RuntimeError(f"Modal render_overlay_parallel not available: {e}")


def _get_process_framing_fn():
    """Get a reference to the deployed process_framing function."""
    global _process_framing_fn

    if _process_framing_fn is not None:
        return _process_framing_fn

    try:
        import modal
        _process_framing_fn = modal.Function.from_name(MODAL_APP_NAME, "process_framing")
        logger.info(f"[Modal] Connected to: {MODAL_APP_NAME}/process_framing")
        return _process_framing_fn
    except Exception as e:
        logger.error(f"[Modal] Failed to connect to process_framing: {e}")
        raise RuntimeError(f"Modal process_framing not available: {e}")


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






async def call_modal_framing(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 1080,
    output_height: int = 1920,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """
    Call Modal process_framing function for crop/trim/speed exports.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for source video
        output_key: R2 key for output video
        keyframes: Crop keyframes [{time, x, y, width, height}, ...]
        output_width: Target width (default 1080)
        output_height: Target height (default 1920)
        fps: Target frame rate (default 30)
        segment_data: Optional trim/speed data

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    process_framing = _get_process_framing_fn()

    logger.info(f"[Modal] Calling process_framing for job {job_id}")
    logger.info(f"[Modal] User: {user_id}, Input: {input_key} -> Output: {output_key}")

    try:
        result = await asyncio.to_thread(
            process_framing.remote,
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

        logger.info(f"[Modal] Framing job {job_id} completed: {result}")
        return result

    except Exception as e:
        logger.error(f"[Modal] Framing job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


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
) -> dict:
    """
    Call Modal process_framing_ai function for AI-upscaled crop exports.

    Uses Real-ESRGAN on cloud GPU for frame-by-frame super resolution.

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

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    process_framing_ai = _get_process_framing_ai_fn()

    logger.info(f"[Modal] Calling process_framing_ai for job {job_id}")
    logger.info(f"[Modal] User: {user_id}, Input: {input_key} -> Output: {output_key}")
    logger.info(f"[Modal] Target: {output_width}x{output_height}")

    try:
        result = await asyncio.to_thread(
            process_framing_ai.remote,
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

        logger.info(f"[Modal] AI framing job {job_id} completed: {result}")
        return result

    except Exception as e:
        logger.error(f"[Modal] AI framing job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def call_modal_overlay(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
) -> dict:
    """
    Call Modal render_overlay function for highlight overlays.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for working video
        output_key: R2 key for output video
        highlight_regions: Highlight regions with keyframes
        effect_type: "dark_overlay" | "brightness_boost" | "original"

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    render_overlay = _get_render_overlay_fn()

    logger.info(f"[Modal] Calling render_overlay for job {job_id}")
    logger.info(f"[Modal] User: {user_id}, Input: {input_key} -> Output: {output_key}")
    logger.info(f"[Modal] Regions: {len(highlight_regions)}, Effect: {effect_type}")

    try:
        result = await asyncio.to_thread(
            render_overlay.remote,
            job_id=job_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            highlight_regions=highlight_regions,
            effect_type=effect_type,
        )

        logger.info(f"[Modal] Overlay job {job_id} completed: {result}")
        return result

    except Exception as e:
        logger.error(f"[Modal] Overlay job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def call_modal_overlay_parallel(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
    num_chunks: int = 4,  # Default to 4, but caller should specify based on get_optimal_gpu_config()
) -> dict:
    """
    Call Modal render_overlay_parallel for parallel chunk processing.

    Use this for longer videos (>8s) to get ~3-4x speedup by processing
    chunks on separate GPU containers in parallel.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for working video
        output_key: R2 key for output video
        highlight_regions: Highlight regions with keyframes
        effect_type: "dark_overlay" | "brightness_boost" | "original"
        num_chunks: Number of parallel chunks (default 4)

    Returns:
        {"status": "success", "output_key": "...", "parallel": True} or
        {"status": "error", "error": "..."}
    """
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    render_overlay_parallel = _get_render_overlay_parallel_fn()

    logger.info(f"[Modal] Calling render_overlay_parallel for job {job_id}")
    logger.info(f"[Modal] User: {user_id}, Input: {input_key} -> Output: {output_key}")
    logger.info(f"[Modal] Regions: {len(highlight_regions)}, Effect: {effect_type}, Chunks: {num_chunks}")

    try:
        result = await asyncio.to_thread(
            render_overlay_parallel.remote,
            job_id=job_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            highlight_regions=highlight_regions,
            effect_type=effect_type,
            num_chunks=num_chunks,
        )

        logger.info(f"[Modal] Parallel overlay job {job_id} completed: {result}")
        return result

    except Exception as e:
        logger.error(f"[Modal] Parallel overlay job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def call_modal_overlay_auto(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
    video_duration: float = None,
) -> dict:
    """
    Automatically choose the cost-optimal GPU configuration for overlay processing.

    Selects between:
    - 1 GPU (sequential): Videos < 30s - cheapest and often fastest
    - 2 GPUs: Videos 30-90s - best cost/time tradeoff
    - 4 GPUs: Videos 90-180s - worth the extra cost for time savings
    - 8 GPUs: Videos > 180s - maximum parallelism for very long videos

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for working video
        output_key: R2 key for output video
        highlight_regions: Highlight regions with keyframes
        effect_type: "dark_overlay" | "brightness_boost" | "original"
        video_duration: Video duration in seconds (used for auto-selection)

    Returns:
        {"status": "success", "output_key": "...", "parallel": bool, "config": "..."} or
        {"status": "error", "error": "..."}
    """
    num_chunks, config_desc = get_optimal_gpu_config(video_duration)

    duration_str = f"{video_duration:.1f}s" if video_duration else "unknown"
    logger.info(f"[Modal] Video {duration_str} -> {config_desc} ({num_chunks} GPU{'s' if num_chunks > 1 else ''})")

    if num_chunks == 1:
        # Sequential processing - single GPU
        result = await call_modal_overlay(
            job_id=job_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            highlight_regions=highlight_regions,
            effect_type=effect_type,
        )
        if result.get("status") == "success":
            result["config"] = config_desc
            result["parallel"] = False
        return result
    else:
        # Parallel processing with N GPU workers
        result = await call_modal_overlay_parallel(
            job_id=job_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            highlight_regions=highlight_regions,
            effect_type=effect_type,
            num_chunks=num_chunks,
        )
        if result.get("status") == "success":
            result["config"] = config_desc
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




# Test function
if __name__ == "__main__":
    import asyncio

    async def test():
        print(f"Modal enabled: {modal_enabled()}")
        if modal_enabled():
            print("Modal is enabled")
            print("  - render_overlay: Apply highlight overlays")
            print("  - render_overlay_parallel: Parallel chunk processing")
            print("  - process_framing: Crop, trim, speed adjustments (FFmpeg)")
            print("  - process_framing_ai: Crop with Real-ESRGAN AI upscaling")
            print("  - detect_players_modal: YOLO player detection")
        else:
            print("Modal is disabled - set MODAL_ENABLED=true to enable")

    asyncio.run(test())
