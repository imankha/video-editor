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

# Parallel processing threshold (seconds)
# Videos longer than this use parallel chunk processing
PARALLEL_THRESHOLD_SECONDS = 8.0
NUM_PARALLEL_CHUNKS = 4


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
    num_chunks: int = NUM_PARALLEL_CHUNKS,
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
    Automatically choose between sequential and parallel overlay processing.

    Uses parallel processing for videos longer than PARALLEL_THRESHOLD_SECONDS.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for working video
        output_key: R2 key for output video
        highlight_regions: Highlight regions with keyframes
        effect_type: "dark_overlay" | "brightness_boost" | "original"
        video_duration: Video duration in seconds (required for auto-selection)

    Returns:
        {"status": "success", "output_key": "...", "parallel": bool} or
        {"status": "error", "error": "..."}
    """
    use_parallel = video_duration is not None and video_duration >= PARALLEL_THRESHOLD_SECONDS

    if use_parallel:
        logger.info(f"[Modal] Video {video_duration:.1f}s >= {PARALLEL_THRESHOLD_SECONDS}s threshold, using PARALLEL processing")
        return await call_modal_overlay_parallel(
            job_id=job_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            highlight_regions=highlight_regions,
            effect_type=effect_type,
        )
    else:
        logger.info(f"[Modal] Video {video_duration:.1f}s < {PARALLEL_THRESHOLD_SECONDS}s threshold, using SEQUENTIAL processing")
        return await call_modal_overlay(
            job_id=job_id,
            user_id=user_id,
            input_key=input_key,
            output_key=output_key,
            highlight_regions=highlight_regions,
            effect_type=effect_type,
        )


# Test function
if __name__ == "__main__":
    import asyncio

    async def test():
        print(f"Modal enabled: {modal_enabled()}")
        if modal_enabled():
            print("Modal is enabled")
            print("  - render_overlay: Apply highlight overlays")
            print("  - process_framing: Crop, trim, speed adjustments")
        else:
            print("Modal is disabled - set MODAL_ENABLED=true to enable")

    asyncio.run(test())
