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

import os
import asyncio
import logging
import tempfile
import time
from pathlib import Path

from app.constants import ExportPhase

logger = logging.getLogger(__name__)


async def local_overlay(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
    video_duration: float = None,
    progress_callback=None,
) -> dict:
    """
    Local fallback for Modal render_overlay.

    Same interface as call_modal_overlay - takes R2 keys, returns same format.
    Downloads from R2, processes with local FFmpeg, uploads result to R2.
    """
    from app.storage import download_from_r2, upload_to_r2
    from app.routers.export.overlay import _process_frames_to_ffmpeg

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
        logger.warning(f"[LocalProcessor] DEBUG - highlight_regions is EMPTY!")

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


async def local_framing(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    video_duration: float = None,
    segment_data: dict = None,
    progress_callback=None,
    include_audio: bool = True,
    export_mode: str = "quality",
) -> dict:
    """
    Local fallback for Modal process_framing_ai.

    Same interface as call_modal_framing_ai - takes R2 keys, returns same format.
    Downloads from R2, processes with local Real-ESRGAN/FFmpeg, uploads result to R2.
    """
    from app.storage import download_from_r2, upload_to_r2

    logger.info(f"[LocalProcessor] Framing job {job_id} starting")
    logger.info(f"[LocalProcessor] User: {user_id}, Input: {input_key} -> Output: {output_key}")
    logger.info(f"[LocalProcessor] Target: {output_width}x{output_height} @ {fps}fps")

    start_time = time.time()

    if progress_callback:
        try:
            await progress_callback(5, "Downloading video...", ExportPhase.DOWNLOAD)
        except Exception as e:
            logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

    try:
        # Import AIVideoUpscaler here to avoid import errors if dependencies not installed
        try:
            from app.ai_upscaler import AIVideoUpscaler
        except (ImportError, OSError, AttributeError) as e:
            logger.error(f"[LocalProcessor] AI upscaler not available: {e}")
            return {"status": "error", "error": f"AI upscaler not available: {e}"}

        with tempfile.TemporaryDirectory(prefix="framing_") as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            output_path = os.path.join(temp_dir, "output.mp4")

            # Download from R2
            if not await asyncio.to_thread(download_from_r2, user_id, input_key, Path(input_path)):
                return {"status": "error", "error": "Failed to download from R2"}

            download_time = time.time() - start_time
            logger.info(f"[LocalProcessor] Downloaded in {download_time:.1f}s")

            if progress_callback:
                try:
                    await progress_callback(15, "Processing with AI upscaler...", ExportPhase.PROCESSING)
                except Exception as e:
                    logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            # Initialize upscaler
            upscaler = AIVideoUpscaler(
                device='cuda',
                export_mode=export_mode,
                enable_source_preupscale=False,
                enable_diffusion_sr=False,
                sr_model_name='realesr_general_x4v3'
            )

            if upscaler.upsampler is None:
                return {"status": "error", "error": "AI SR model failed to load"}

            # Get event loop for thread-safe callbacks
            loop = asyncio.get_running_loop()

            # Progress ranges for local processing
            is_fast_mode = export_mode.upper() == "FAST"
            if is_fast_mode:
                progress_ranges = {
                    'ai_upscale': (15, 95),
                    'ffmpeg_encode': (95, 100)
                }
            else:
                progress_ranges = {
                    'ai_upscale': (15, 30),
                    'ffmpeg_pass1': (30, 85),
                    'ffmpeg_encode': (85, 100)
                }

            def sync_progress_callback(current, total, message, phase='ai_upscale'):
                """Wrap async callback for sync processing thread."""
                if progress_callback:
                    try:
                        if phase not in progress_ranges:
                            phase = 'ai_upscale'
                        start_pct, end_pct = progress_ranges[phase]
                        phase_progress = (current / total) if total > 0 else 0
                        overall = start_pct + (phase_progress * (end_pct - start_pct))

                        asyncio.run_coroutine_threadsafe(
                            progress_callback(overall, message, phase),
                            loop
                        )
                    except Exception as e:
                        logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            # Process with Real-ESRGAN
            result = await asyncio.to_thread(
                upscaler.process_video_with_upscale,
                input_path=input_path,
                output_path=output_path,
                keyframes=keyframes,
                target_fps=fps,
                export_mode=export_mode,
                progress_callback=sync_progress_callback,
                segment_data=segment_data,
                include_audio=include_audio,
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
            logger.info(f"[LocalProcessor] Framing job {job_id} completed in {total_time:.1f}s")

            if progress_callback:
                try:
                    await progress_callback(100, "Complete!", ExportPhase.COMPLETE)
                except Exception as e:
                    logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            return {"status": "success", "output_key": output_key}

    except Exception as e:
        logger.error(f"[LocalProcessor] Framing job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def local_annotate_compilation(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    clips: list,
    progress_callback=None,
) -> dict:
    """
    Local fallback for Modal create_annotated_compilation.

    Same interface as call_modal_annotate_compilation - takes R2 keys, returns same format.
    Downloads from R2, extracts clips with burned-in text, concatenates, uploads result to R2.
    """
    from app.storage import download_from_r2, upload_to_r2
    from app.routers.annotate import create_clip_with_burned_text, concatenate_videos

    logger.info(f"[LocalProcessor] Annotate compilation job {job_id} starting")
    logger.info(f"[LocalProcessor] User: {user_id}, Input: {input_key} -> Output: {output_key}")
    logger.info(f"[LocalProcessor] Clips: {len(clips)}")

    start_time = time.time()

    if progress_callback:
        try:
            await progress_callback(5, "Downloading video...", ExportPhase.DOWNLOAD)
        except Exception as e:
            logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

    try:
        with tempfile.TemporaryDirectory(prefix="annotate_") as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            output_path = os.path.join(temp_dir, "output.mp4")

            # Download from R2
            if not await asyncio.to_thread(download_from_r2, user_id, input_key, Path(input_path)):
                return {"status": "error", "error": "Failed to download from R2"}

            download_time = time.time() - start_time
            logger.info(f"[LocalProcessor] Downloaded in {download_time:.1f}s")

            # Extract each clip with burned-in text
            burned_clips = []
            total_clips = len(clips)

            for i, clip in enumerate(clips):
                progress_pct = int(10 + (i / total_clips) * 70)
                if progress_callback:
                    try:
                        await progress_callback(progress_pct, f"Processing clip {i+1}/{total_clips}...", ExportPhase.PROCESSING)
                    except Exception as e:
                        logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

                clip_path = os.path.join(temp_dir, f"burned_{i}.mp4")
                success = await create_clip_with_burned_text(
                    source_path=input_path,
                    output_path=clip_path,
                    start_time=clip['start_time'],
                    end_time=clip['end_time'],
                    clip_name=clip.get('name', ''),
                    clip_notes=clip.get('notes', ''),
                    rating=clip.get('rating', 3),
                    tags=clip.get('tags', []),
                )
                if success:
                    burned_clips.append(clip_path)

            if not burned_clips:
                return {"status": "error", "error": "No clips were successfully processed"}

            if progress_callback:
                try:
                    await progress_callback(85, "Concatenating clips...", "concat")
                except Exception as e:
                    logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            # Concatenate all clips
            if not await concatenate_videos(burned_clips, output_path):
                return {"status": "error", "error": "Failed to concatenate clips"}

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
            logger.info(f"[LocalProcessor] Annotate job {job_id} completed in {total_time:.1f}s")

            if progress_callback:
                try:
                    await progress_callback(100, "Complete!", ExportPhase.COMPLETE)
                except Exception as e:
                    logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            return {"status": "success", "output_key": output_key, "clips_processed": len(burned_clips)}

    except Exception as e:
        logger.error(f"[LocalProcessor] Annotate job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}
