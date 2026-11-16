"""
Local processing fallbacks for Modal functions.

These functions have the SAME INTERFACE as Modal functions, enabling:
1. Unified router code (no `if modal_enabled()` branching)
2. Testing the full code path without Modal costs
3. Development without Modal credentials

Each function:
- Takes R2 keys as input/output (same as Modal)
- Downloads from R2, processes locally, uploads to R2
- Returns same format: {"status": "success/error", ...}
- Accepts progress_callback with same signature
"""

import asyncio
import logging
import os
import tempfile
import time
from pathlib import Path

from app.constants import ExportPhase

logger = logging.getLogger(__name__)


class MockVideoUpscaler:
    """
    Drop-in replacement for AIVideoUpscaler that skips AI upscaling.

    Uses FFmpeg-only crop+resize for fast E2E test exports.
    Same interface as AIVideoUpscaler.process_video_with_upscale().
    """

    def __init__(self, **kwargs):
        # Must be truthy — process_single_clip checks `upscaler.upsampler is None`
        # and raises 503 if falsy (see multi_clip.py process_single_clip)
        self.upsampler = True

    def process_video_with_upscale(
        self,
        input_path: str,
        output_path: str,
        keyframes: list,
        target_fps: int = 30,
        export_mode: str = "quality",
        progress_callback=None,
        segment_data=None,
        include_audio: bool = True,
        rotation: float = 0,
        highlight_keyframes=None,
        highlight_effect_type: str = "original",
    ) -> dict:
        """Fast FFmpeg crop+resize — no AI, for E2E tests."""
        import ffmpeg as ffmpeg_lib

        logger.info(f"[MockUpscaler] Processing {input_path} -> {output_path}")
        if rotation:
            # T6451: accepted to match AIVideoUpscaler's interface (crash fix), but
            # NOT applied — this mock is FFmpeg-only crop+resize (no frame_processor,
            # which is where the real upscaler applies rotation), and guessing at the
            # right rotate-vs-crop ordering here risks a silently-wrong transform.
            # Loud, not silent: dev/CI exports of a rotated clip will look unrotated.
            logger.warning(
                f"[MockUpscaler] rotation={rotation} requested but NOT applied "
                f"(pipeline-verification mock only, no AI upscale) — output will "
                f"be unrotated. Real rotation only renders via AIVideoUpscaler (Modal/CUDA)."
            )

        # Get source dimensions. T4280: a failed probe means the file is bad -- raise
        # rather than guessing 1920x1080, which would crop/scale against wrong dimensions
        # and produce corrupt output downstream (a silent fallback for internal data).
        try:
            probe = ffmpeg_lib.probe(input_path)
            video_info = next(s for s in probe['streams'] if s['codec_type'] == 'video')
            src_w = int(video_info['width'])
            src_h = int(video_info['height'])
        except Exception as e:
            logger.error(f"[MockUpscaler] Failed to probe source dimensions for {input_path}: {e}")
            raise RuntimeError(f"Cannot process video: ffprobe failed for {input_path}: {e}") from e

        # Use first keyframe for crop
        # Keyframes may be fractional (0-1) or pixel coords — detect and handle both
        kf = keyframes[0] if keyframes else {'x': 0, 'y': 0, 'width': 1, 'height': 1}
        raw_w = kf.get('width', 1)
        raw_h = kf.get('height', 1)
        raw_x = kf.get('x', 0)
        raw_y = kf.get('y', 0)

        # If values are <= 1.0, they're fractional — multiply by source dims
        # If values are > 1.0, they're already pixel coords
        if raw_w <= 1.0 and raw_h <= 1.0:
            crop_w = max(2, int(raw_w * src_w))
            crop_h = max(2, int(raw_h * src_h))
            crop_x = int(raw_x * src_w)
            crop_y = int(raw_y * src_h)
        else:
            crop_w = max(2, int(raw_w))
            crop_h = max(2, int(raw_h))
            crop_x = int(raw_x)
            crop_y = int(raw_y)

        # Clamp to source dimensions
        crop_w = min(crop_w, src_w - crop_x)
        crop_h = min(crop_h, src_h - crop_y)
        crop_x = max(0, crop_x)
        crop_y = max(0, crop_y)

        try:
            stream = ffmpeg_lib.input(input_path)
            stream = ffmpeg_lib.filter(stream, 'crop', crop_w, crop_h, crop_x, crop_y)
            stream = ffmpeg_lib.filter(stream, 'scale', 810, 1440)
            out_args = dict(
                vcodec='libx264', crf=23, preset='ultrafast',
                pix_fmt='yuv420p', t=10, movflags='+faststart',
            )
            if include_audio:
                out_args.update(acodec='aac', audio_bitrate='128k')
            else:
                out_args['an'] = None
            stream = ffmpeg_lib.output(stream, output_path, **out_args)
            ffmpeg_lib.run(stream, overwrite_output=True, capture_stdout=True, capture_stderr=True)
        except ffmpeg_lib.Error as e:
            stderr = e.stderr.decode() if e.stderr else str(e)
            logger.error(f"[MockUpscaler] FFmpeg failed: {stderr}")
            raise

        if progress_callback:
            try:
                progress_callback(1, 1, "Mock complete", 'complete')
            except Exception:
                pass

        logger.info(f"[MockUpscaler] Done: {output_path}")
        return {"status": "success"}


async def local_overlay(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
    video_duration: float | None = None,
    progress_callback=None,
) -> dict:
    """
    Local fallback for Modal render_overlay.

    Same interface as call_modal_overlay - takes R2 keys, returns same format.
    Downloads from R2, processes with local FFmpeg, uploads result to R2.
    """
    from app.routers.export.overlay import _process_frames_to_ffmpeg
    from app.storage import download_from_r2, upload_to_r2

    logger.info(f"[LocalProcessor] Overlay job {job_id} starting")
    logger.info(f"[LocalProcessor] User: {user_id}, Input: {input_key} -> Output: {output_key}")
    logger.info(f"[LocalProcessor] Regions: {len(highlight_regions)}, Effect: {effect_type}")
    # DEBUG: Log first region's keyframes to verify data passed correctly
    if highlight_regions and len(highlight_regions) > 0:
        first_region = highlight_regions[0]
        logger.info(f"[LocalProcessor] DEBUG - First region: start={first_region.get('start_time')}, end={first_region.get('end_time')}")
        if first_region.get('keyframes'):
            logger.info(f"[LocalProcessor] DEBUG - First region keyframes sample: {first_region['keyframes'][:3]}")
    else:
        logger.warning("[LocalProcessor] DEBUG - highlight_regions is EMPTY!")

    start_time = time.time()

    # Send initial progress
    if progress_callback:
        try:
            await progress_callback(5, "Downloading video...", ExportPhase.DOWNLOAD)
        except Exception as e:
            logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

    try:
        # Create temp directory for processing
        with tempfile.TemporaryDirectory(prefix="overlay_") as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            output_path = os.path.join(temp_dir, "output.mp4")

            # Download from R2
            if not await asyncio.to_thread(download_from_r2, user_id, input_key, Path(input_path)):
                return {"status": "error", "error": "Failed to download from R2"}

            download_time = time.time() - start_time
            logger.info(f"[LocalProcessor] Downloaded in {download_time:.1f}s")

            if progress_callback:
                try:
                    await progress_callback(10, "Processing frames...", ExportPhase.PROCESSING)
                except Exception as e:
                    logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            # Process locally
            if not highlight_regions:
                # No highlights - just copy
                import shutil
                shutil.copy(input_path, output_path)
            else:
                # Get event loop for thread-safe callbacks
                loop = asyncio.get_running_loop()

                def sync_progress_callback(progress: int, message: str):
                    """Wrap async callback for sync processing thread."""
                    if progress_callback:
                        try:
                            # Scale progress from 0-100 to 10-90 range
                            scaled = 10 + int(progress * 0.8)
                            asyncio.run_coroutine_threadsafe(
                                progress_callback(scaled, message, ExportPhase.PROCESSING),
                                loop
                            )
                        except Exception as e:
                            logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

                # Run processing in thread to avoid blocking
                await asyncio.to_thread(
                    _process_frames_to_ffmpeg,
                    input_path,
                    output_path,
                    highlight_regions,
                    effect_type,
                    sync_progress_callback
                )

            process_time = time.time() - start_time - download_time
            logger.info(f"[LocalProcessor] Processed in {process_time:.1f}s")

            if progress_callback:
                try:
                    await progress_callback(92, "Uploading result...", ExportPhase.UPLOAD)
                except Exception as e:
                    logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            # Upload to R2
            if not await asyncio.to_thread(upload_to_r2, user_id, output_key, Path(output_path)):
                return {"status": "error", "error": "Failed to upload to R2"}

            total_time = time.time() - start_time
            logger.info(f"[LocalProcessor] Overlay job {job_id} completed in {total_time:.1f}s")

            if progress_callback:
                try:
                    await progress_callback(100, "Complete!", ExportPhase.COMPLETE)
                except Exception as e:
                    logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            return {"status": "success", "output_key": output_key}

    except Exception as e:
        logger.error(f"[LocalProcessor] Overlay job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


# --- Sync functions for subprocess isolation (T2640) ---
# These run in a child process via ProcessPoolExecutor.
# All I/O is sync, progress_callback is a plain function (writes to queue).


def _overlay_sync(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
    video_duration: float | None = None,
    progress_callback=None,
    overlay_settings: dict | None = None,
    profile_id: str | None = None,
    text_layers: list | None = None,
) -> dict:
    from app.routers.export.overlay import _process_frames_to_ffmpeg
    from app.storage import download_from_r2, upload_to_r2

    # ContextVars don't cross the process boundary — re-establish the profile context the
    # R2 key builder needs (this runs in a ProcessPoolExecutor child, T2640).
    if profile_id:
        from app.profile_context import set_current_profile_id
        set_current_profile_id(profile_id)

    logger.info(f"[Subprocess] Overlay job {job_id} starting")
    start_time = time.time()

    if progress_callback:
        progress_callback(5, "Downloading video...", ExportPhase.DOWNLOAD)

    try:
        with tempfile.TemporaryDirectory(prefix="overlay_") as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            output_path = os.path.join(temp_dir, "output.mp4")

            if not download_from_r2(user_id, input_key, Path(input_path)):
                return {"status": "error", "error": "Failed to download from R2"}

            download_time = time.time() - start_time
            logger.info(f"[Subprocess] Downloaded in {download_time:.1f}s")

            if progress_callback:
                progress_callback(10, "Processing frames...", ExportPhase.PROCESSING)

            # T5225: a project with text but no highlight regions must still go
            # through the frame loop -- the plain-copy shortcut would silently
            # drop the text (same class of bug as the has_keyframes gate in
            # overlay.py's render_overlay endpoint).
            if not highlight_regions and not text_layers:
                import shutil
                shutil.copy(input_path, output_path)
            else:
                def frame_progress(progress: int, message: str):
                    if progress_callback:
                        scaled = 10 + int(progress * 0.8)
                        progress_callback(scaled, message, ExportPhase.PROCESSING)

                _process_frames_to_ffmpeg(
                    input_path,
                    output_path,
                    highlight_regions,
                    effect_type,
                    frame_progress,
                    overlay_settings=overlay_settings,
                    text_layers=text_layers,
                )

            process_time = time.time() - start_time - download_time
            logger.info(f"[Subprocess] Processed in {process_time:.1f}s")

            if progress_callback:
                progress_callback(92, "Uploading result...", ExportPhase.UPLOAD)

            if not upload_to_r2(user_id, output_key, Path(output_path)):
                return {"status": "error", "error": "Failed to upload to R2"}

            total_time = time.time() - start_time
            logger.info(f"[Subprocess] Overlay job {job_id} completed in {total_time:.1f}s")

            if progress_callback:
                progress_callback(100, "Complete!", ExportPhase.COMPLETE)

            return {"status": "success", "output_key": output_key}

    except Exception as e:
        logger.error(f"[Subprocess] Overlay job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}
