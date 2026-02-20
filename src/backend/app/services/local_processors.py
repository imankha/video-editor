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
        highlight_keyframes=None,
        highlight_effect_type: str = "original",
    ) -> dict:
        """Fast FFmpeg crop+resize — no AI, for E2E tests."""
        import ffmpeg as ffmpeg_lib

        logger.info(f"[MockUpscaler] Processing {input_path} -> {output_path}")

        # Get source dimensions
        try:
            probe = ffmpeg_lib.probe(input_path)
            video_info = next(s for s in probe['streams'] if s['codec_type'] == 'video')
            src_w = int(video_info['width'])
            src_h = int(video_info['height'])
        except Exception:
            src_w, src_h = 1920, 1080

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
                pix_fmt='yuv420p', t=10,
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


async def local_framing_mock(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    progress_callback=None,
) -> dict:
    """
    Mock framing processor for E2E tests.

    Same interface as local_framing but skips AI upscaling entirely.
    Uses fast FFmpeg crop+resize to produce a valid working video in seconds.
    """
    from app.storage import download_from_r2, upload_to_r2
    import ffmpeg as ffmpeg_lib

    logger.info(f"[LocalProcessor] Mock framing job {job_id} starting (test mode)")

    start_time = time.time()

    if progress_callback:
        try:
            await progress_callback(10, "Test mode: downloading...", ExportPhase.DOWNLOAD)
        except Exception as e:
            logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

    try:
        with tempfile.TemporaryDirectory(prefix="framing_mock_") as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            output_path = os.path.join(temp_dir, "output.mp4")

            # Download from R2
            if not await asyncio.to_thread(download_from_r2, user_id, input_key, Path(input_path)):
                return {"status": "error", "error": "Failed to download from R2"}

            if progress_callback:
                try:
                    await progress_callback(30, "Test mode: crop+resize...", ExportPhase.PROCESSING)
                except Exception as e:
                    logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            # Get source dimensions
            try:
                probe = ffmpeg_lib.probe(input_path)
                video_info = next(s for s in probe['streams'] if s['codec_type'] == 'video')
                src_w = int(video_info['width'])
                src_h = int(video_info['height'])
            except Exception:
                src_w, src_h = 1920, 1080

            # Use first keyframe for crop region
            # Keyframes may be fractional (0-1) or pixel coords — detect both
            kf = keyframes[0] if keyframes else {'x': 0, 'y': 0, 'width': 1, 'height': 1}
            raw_w = kf.get('width', 1)
            raw_h = kf.get('height', 1)
            raw_x = kf.get('x', 0)
            raw_y = kf.get('y', 0)

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

            crop_w = min(crop_w, src_w - crop_x)
            crop_h = min(crop_h, src_h - crop_y)
            crop_x = max(0, crop_x)
            crop_y = max(0, crop_y)

            # Fast FFmpeg crop + resize (no AI)
            try:
                stream = ffmpeg_lib.input(input_path)
                stream = ffmpeg_lib.filter(stream, 'crop', crop_w, crop_h, crop_x, crop_y)
                stream = ffmpeg_lib.filter(stream, 'scale', output_width, output_height)
                stream = ffmpeg_lib.output(stream, output_path,
                                           vcodec='libx264', crf=23, preset='ultrafast',
                                           acodec='aac', audio_bitrate='128k',
                                           pix_fmt='yuv420p', t=10)
                await asyncio.to_thread(
                    ffmpeg_lib.run, stream,
                    overwrite_output=True, capture_stdout=True, capture_stderr=True
                )
            except ffmpeg_lib.Error as e:
                stderr = e.stderr.decode() if e.stderr else str(e)
                logger.error(f"[LocalProcessor] Mock FFmpeg failed: {stderr}")
                return {"status": "error", "error": f"Mock FFmpeg failed: {stderr}"}

            if progress_callback:
                try:
                    await progress_callback(80, "Test mode: uploading...", ExportPhase.UPLOAD)
                except Exception as e:
                    logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            # Upload to R2
            if not await asyncio.to_thread(upload_to_r2, user_id, output_key, Path(output_path)):
                return {"status": "error", "error": "Failed to upload to R2"}

            total_time = time.time() - start_time
            logger.info(f"[LocalProcessor] Mock framing job {job_id} completed in {total_time:.1f}s")

            if progress_callback:
                try:
                    await progress_callback(100, "Complete!", ExportPhase.COMPLETE)
                except Exception as e:
                    logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

            return {"status": "success", "output_key": output_key}

    except Exception as e:
        logger.error(f"[LocalProcessor] Mock framing job {job_id} failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


async def local_annotate_compilation(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    clips: list,
    progress_callback=None,
    input_keys: dict = None,
) -> dict:
    """
    Local fallback for Modal create_annotated_compilation.

    Same interface as call_modal_annotate_compilation - takes R2 keys, returns same format.
    Downloads from R2, extracts clips with burned-in text, concatenates, uploads result to R2.
    """
    from app.storage import download_from_r2, download_from_r2_global, upload_to_r2
    from app.routers.annotate import create_clip_with_burned_text, concatenate_videos

    is_multi = input_keys is not None and len(input_keys) > 1

    logger.info(f"[LocalProcessor] Annotate compilation job {job_id} starting")
    logger.info(f"[LocalProcessor] User: {user_id}, Input: {input_key} -> Output: {output_key}, multi={is_multi}")
    logger.info(f"[LocalProcessor] Clips: {len(clips)}")

    start_time = time.time()

    if progress_callback:
        try:
            await progress_callback(5, "Downloading video...", ExportPhase.DOWNLOAD)
        except Exception as e:
            logger.warning(f"[LocalProcessor] Progress callback failed: {e}")

    try:
        with tempfile.TemporaryDirectory(prefix="annotate_") as temp_dir:
            output_path = os.path.join(temp_dir, "output.mp4")

            # Download source video(s) from R2
            # source_paths maps video_sequence -> local path (or None -> single)
            source_paths = {}

            if is_multi:
                # Game videos are stored globally (no user prefix)
                for seq, r2_key in sorted(input_keys.items()):
                    local_path = os.path.join(temp_dir, f"input_{seq}.mp4")
                    if not await asyncio.to_thread(download_from_r2_global, r2_key, Path(local_path)):
                        return {"status": "error", "error": f"Failed to download video sequence {seq} from R2"}
                    source_paths[seq] = local_path
            else:
                input_path = os.path.join(temp_dir, "input.mp4")
                if not await asyncio.to_thread(download_from_r2, user_id, input_key, Path(input_path)):
                    return {"status": "error", "error": "Failed to download from R2"}
                source_paths[None] = input_path

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

                # Resolve source path for this clip
                if is_multi:
                    clip_seq = clip.get('video_sequence')
                    clip_source = source_paths.get(clip_seq)
                    if not clip_source:
                        logger.error(f"[LocalProcessor] Clip {i} has video_sequence={clip_seq} but no matching source")
                        continue
                else:
                    clip_source = source_paths[None]

                clip_path = os.path.join(temp_dir, f"burned_{i}.mp4")
                success = await create_clip_with_burned_text(
                    source_path=clip_source,
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
