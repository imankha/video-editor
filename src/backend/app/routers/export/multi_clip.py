"""
Multi-clip export endpoints.

This module handles exports involving multiple video clips:
- /multi-clip - Export multiple clips with transitions
- /chapters - Extract chapter markers from video
- /concat-for-overlay - Concatenate clips for overlay mode

Uses the transition strategy pattern for different transition types.
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse
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

from ...websocket import export_progress, manager
from ...services.clip_cache import get_clip_cache
from ...services.transitions import apply_transition
from ...constants import VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT, AI_UPSCALE_FACTOR
from ...services.ffmpeg_service import get_video_duration

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
    loop: asyncio.AbstractEventLoop
) -> str:
    """
    Process a single clip with its crop/trim/speed settings.
    Uses caching to avoid re-processing unchanged clips.
    Returns path to processed clip.
    """
    clip_index = clip_data['clipIndex']

    # Save video to temp
    input_path = os.path.join(temp_dir, f"input_{clip_index}.mp4")
    content = await video_file.read()
    with open(input_path, 'wb') as f:
        f.write(content)

    # Compute content hash for cache key (first 1MB + size for speed)
    content_sample = content[:1024 * 1024]  # First 1MB
    content_hash = hashlib.sha256(content_sample).hexdigest()[:12]
    content_identity = f"{content_hash}|{len(content)}"

    # Output path for this clip
    output_path = os.path.join(temp_dir, f"processed_{clip_index}.mp4")

    # Convert crop keyframes to expected format
    keyframes = [
        {
            'time': kf['time'],
            'x': kf['x'],
            'y': kf['y'],
            'width': kf['width'],
            'height': kf['height']
        }
        for kf in clip_data.get('cropKeyframes', [])
    ]

    # Build segment_data from clip's segments
    segment_data = None
    segments = clip_data.get('segments')
    trim_range = clip_data.get('trimRange')

    if segments or trim_range:
        segment_data = {}

        if trim_range:
            segment_data['trim_start'] = trim_range.get('start', 0)
            segment_data['trim_end'] = trim_range.get('end', clip_data.get('duration', 0))

        # Convert segment speeds if present
        if segments and segments.get('segmentSpeeds'):
            boundaries = segments.get('boundaries', [])
            speeds = segments.get('segmentSpeeds', {})

            segment_list = []
            for i in range(len(boundaries) - 1):
                segment_list.append({
                    'start': boundaries[i],
                    'end': boundaries[i + 1],
                    'speed': speeds.get(str(i), 1.0)
                })
            segment_data['segments'] = segment_list

    # Check cache before processing
    cache = get_clip_cache()
    cache_key = cache.generate_key(
        cache_type='framing',
        video_id=content_identity,
        crop_keyframes=keyframes,
        segment_data=segment_data,
        target_fps=target_fps,
        export_mode=export_mode,
        include_audio=include_audio
    )

    cached_path = cache.get(cache_key)
    if cached_path:
        # Cache hit - copy to output path
        shutil.copy2(cached_path, output_path)
        logger.info(f"[Multi-Clip] Cache HIT for clip {clip_index}")
        if progress_callback:
            progress_callback(1, 1, "Using cached result", 'cached')
        return output_path

    logger.info(f"[Multi-Clip] Processing clip {clip_index}: {len(keyframes)} keyframes")

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
        sr_model_name='realesr_general_x4v3'
    )

    if upscaler.upsampler is None:
        raise HTTPException(
            status_code=503,
            detail={"error": "AI SR model failed to load"}
        )

    # Process with AIVideoUpscaler (run in thread to not block async)
    await asyncio.to_thread(
        upscaler.process_video_with_upscale,
        input_path=input_path,
        output_path=output_path,
        keyframes=keyframes,
        target_fps=target_fps,
        export_mode=export_mode,
        progress_callback=progress_callback,
        segment_data=segment_data,
        include_audio=include_audio
    )

    # Save to cache for future use
    try:
        cache.put(output_path, cache_key)
        logger.info(f"[Multi-Clip] Cached clip {clip_index}")
    except Exception as e:
        logger.warning(f"[Multi-Clip] Failed to cache clip {clip_index}: {e}")

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
        "status": "processing"
    }

    logger.info(f"[Multi-Clip Export] Starting export {export_id}")

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

    try:
        # Calculate consistent target resolution for all clips
        target_resolution = calculate_multi_clip_resolution(clips_data, global_aspect_ratio)
        logger.info(f"[Multi-Clip Export] Target resolution: {target_resolution}")

        # Get event loop for progress callbacks
        loop = asyncio.get_running_loop()

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

            # Process this clip
            output_path = await process_single_clip(
                clip_data=clip_data,
                video_file=video_file,
                temp_dir=temp_dir,
                target_fps=target_fps,
                export_mode=export_mode,
                include_audio=include_audio_bool,
                progress_callback=clip_progress_callback,
                loop=loop
            )

            processed_paths.append(output_path)
            logger.info(f"[Multi-Clip Export] Clip {clip_index} processed: {output_path}")

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

        # Complete
        progress_data = {
            "progress": 100,
            "message": "Export complete!",
            "status": "complete"
        }
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        # Return the file with cleanup
        def cleanup():
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)

        return FileResponse(
            final_output,
            media_type='video/mp4',
            filename=f"multi_clip_{export_id}.mp4",
            background=BackgroundTask(cleanup)
        )

    except HTTPException:
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Multi-Clip Export] Cleanup failed: {cleanup_error}")
        raise
    except Exception as e:
        logger.error(f"[Multi-Clip Export] Failed: {str(e)}", exc_info=True)
        error_data = {"progress": 0, "message": f"Export failed: {str(e)}", "status": "error"}
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)
        import time
        time.sleep(0.5)
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
