"""
Export endpoints for the Video Editor API.

This router handles all video export operations:
- /api/export/crop - Basic crop export
- /api/export/upscale - AI upscale export
- /api/export/upscale-comparison - Comparison export with multiple models
- /api/export/overlay - Overlay-only export
"""

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from datetime import datetime
from pathlib import Path
from typing import List, Tuple, Dict, Any, Optional
import json
import os
import re
import tempfile
import uuid
import asyncio
import subprocess
import logging
import ffmpeg
import shutil

from ..models import CropKeyframe, HighlightKeyframe
from ..websocket import export_progress, manager
from ..interpolation import generate_crop_filter
from ..database import get_db_connection, WORKING_VIDEOS_PATH, FINAL_VIDEOS_PATH
from ..services.clip_cache import get_clip_cache
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/export", tags=["export"])

# AI upscaler will be imported on-demand to avoid import errors
AIVideoUpscaler = None
try:
    from app.ai_upscaler import AIVideoUpscaler as _AIVideoUpscaler
    AIVideoUpscaler = _AIVideoUpscaler
except (ImportError, OSError, AttributeError) as e:
    logger.warning(f"AI upscaler dependencies not available: {e}")
    logger.warning("AI upscaling features will be disabled")


# =============================================================================
# Multi-Clip Export Helper Functions
# =============================================================================

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

    # Calculate target resolution (4x upscale, capped at 1440p)
    sr_w = int(min_crop_width * 4)
    sr_h = int(min_crop_height * 4)

    max_w, max_h = 2560, 1440
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
    import hashlib

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
        # Call progress callback to show we're done with this clip
        if progress_callback:
            progress_callback(1, 1, "Using cached result", 'cached')
        return output_path

    logger.info(f"[Multi-Clip] Processing clip {clip_index}: {len(keyframes)} keyframes, segment_data={segment_data}")

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


def get_video_duration(video_path: str) -> float:
    """Get duration of a video file using ffprobe."""
    probe = ffmpeg.probe(video_path)
    return float(probe['format']['duration'])


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

    logger.info(f"[Chapters] Created metadata file with {len(clip_info)} chapters: {metadata_path}")
    return metadata_path


def add_chapters_to_video(
    input_path: str,
    metadata_path: str,
    output_path: str
) -> None:
    """
    Add chapter metadata to a video file.

    Args:
        input_path: Path to the input video
        metadata_path: Path to the ffmetadata file
        output_path: Path for the output video with chapters
    """
    cmd = [
        'ffmpeg', '-y',
        '-i', input_path,
        '-i', metadata_path,
        '-map_metadata', '1',
        '-codec', 'copy',
        output_path
    ]

    logger.info(f"[Chapters] Adding chapters: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"[Chapters] Failed to add chapters: {result.stderr}")
        # Don't raise - chapters are optional, just log the error
    else:
        logger.info(f"[Chapters] Successfully added chapters to {output_path}")


def concatenate_clips_with_transition(
    clip_paths: List[str],
    output_path: str,
    transition: Dict[str, Any],
    include_audio: bool = True,
    clip_info: Optional[List[Dict[str, Any]]] = None
) -> None:
    """
    Concatenate processed clips with transitions and embed chapter markers.

    Transition types:
    - "cut": Simple concatenation (no transition effect)
    - "fade": Fade to black between clips
    - "dissolve": Cross-dissolve between clips

    Args:
        clip_paths: List of paths to processed clip files
        output_path: Path for the final concatenated output
        transition: Transition settings {'type': str, 'duration': float}
        include_audio: Whether to include audio in output
        clip_info: Optional list of clip info for chapter markers
                   Each item: {'name': str, 'index': int}
    """
    transition_type = transition.get('type', 'cut')
    transition_duration = transition.get('duration', 0.5)

    if len(clip_paths) == 1:
        # Single clip - just copy
        shutil.copy(clip_paths[0], output_path)
        return

    if transition_type == 'cut':
        # Simple concatenation using concat demuxer
        concat_file = os.path.join(os.path.dirname(output_path), 'concat.txt')
        with open(concat_file, 'w') as f:
            for path in clip_paths:
                # Escape single quotes in path
                escaped_path = path.replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")

        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_file,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '18',
            '-pix_fmt', 'yuv420p',
        ]

        if include_audio:
            cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
        else:
            cmd.append('-an')

        cmd.append(output_path)

        logger.info(f"[Multi-Clip] Running concat: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"[Multi-Clip] Concat error: {result.stderr}")
            raise RuntimeError(f"FFmpeg concat failed: {result.stderr}")

    elif transition_type == 'fade':
        # Fade to black between clips
        _concatenate_with_fade(clip_paths, output_path, transition_duration, include_audio)

    elif transition_type == 'dissolve':
        # Cross-dissolve between clips using xfade
        _concatenate_with_dissolve(clip_paths, output_path, transition_duration, include_audio)

    else:
        # Default to cut for unknown transition types
        logger.warning(f"[Multi-Clip] Unknown transition type '{transition_type}', falling back to cut")
        concatenate_clips_with_transition(clip_paths, output_path, {'type': 'cut'}, include_audio, clip_info)
        return  # Chapter embedding already done in recursive call

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
                logger.warning("[Multi-Clip] Chapter embedding produced no output, keeping original")

            # Cleanup
            if os.path.exists(metadata_path):
                os.remove(metadata_path)
            if os.path.exists(temp_output):
                os.remove(temp_output)

        except Exception as e:
            logger.error(f"[Multi-Clip] Failed to add chapters: {e}")
            # Continue without chapters - video is still valid


def _concatenate_with_fade(
    clip_paths: List[str],
    output_path: str,
    fade_duration: float,
    include_audio: bool
) -> None:
    """
    Concatenate clips with fade to black transitions.
    Applies fade out to end of each clip (except last) and fade in to start of each clip (except first).
    """
    # Get clip durations
    durations = [get_video_duration(path) for path in clip_paths]

    # Build complex filter
    filter_parts = []
    video_labels = []
    audio_labels = []

    for i, (path, dur) in enumerate(zip(clip_paths, durations)):
        is_first = (i == 0)
        is_last = (i == len(clip_paths) - 1)

        # Video filter: fade in/out
        video_filter = f"[{i}:v]"
        effects = []

        if not is_last:
            # Fade out at end
            fade_start = max(0, dur - fade_duration)
            effects.append(f"fade=t=out:st={fade_start}:d={fade_duration}")

        if not is_first:
            # Fade in at start
            effects.append(f"fade=t=in:st=0:d={fade_duration}")

        if effects:
            video_filter += ','.join(effects)
        video_filter += f"[v{i}]"
        filter_parts.append(video_filter)
        video_labels.append(f"[v{i}]")

        # Audio filter: fade in/out (if audio included)
        if include_audio:
            audio_filter = f"[{i}:a]"
            audio_effects = []

            if not is_last:
                audio_effects.append(f"afade=t=out:st={max(0, dur - fade_duration)}:d={fade_duration}")

            if not is_first:
                audio_effects.append(f"afade=t=in:st=0:d={fade_duration}")

            if audio_effects:
                audio_filter += ','.join(audio_effects)
            audio_filter += f"[a{i}]"
            filter_parts.append(audio_filter)
            audio_labels.append(f"[a{i}]")

    # Concatenate video streams
    video_concat = ''.join(video_labels) + f"concat=n={len(clip_paths)}:v=1:a=0[outv]"
    filter_parts.append(video_concat)

    # Concatenate audio streams (if audio included)
    if include_audio:
        audio_concat = ''.join(audio_labels) + f"concat=n={len(clip_paths)}:v=0:a=1[outa]"
        filter_parts.append(audio_concat)

    filter_complex = ';'.join(filter_parts)

    # Build FFmpeg command
    cmd = ['ffmpeg', '-y']
    for path in clip_paths:
        cmd.extend(['-i', path])

    cmd.extend(['-filter_complex', filter_complex])
    cmd.extend(['-map', '[outv]'])

    if include_audio:
        cmd.extend(['-map', '[outa]'])
        cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
    else:
        cmd.append('-an')

    cmd.extend(['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p'])
    cmd.append(output_path)

    logger.info(f"[Multi-Clip] Running fade transition")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"[Multi-Clip] Fade error: {result.stderr}")
        raise RuntimeError(f"FFmpeg fade transition failed: {result.stderr}")


def _concatenate_with_dissolve(
    clip_paths: List[str],
    output_path: str,
    dissolve_duration: float,
    include_audio: bool
) -> None:
    """
    Concatenate clips with cross-dissolve transitions using xfade filter.
    """
    # Get clip durations
    durations = [get_video_duration(path) for path in clip_paths]

    # Build xfade chain for video
    # [0:v][1:v]xfade=transition=dissolve:duration=0.5:offset=D0[v01]
    # [v01][2:v]xfade=transition=dissolve:duration=0.5:offset=D1[v012]
    video_filter_parts = []
    current_label = "[0:v]"
    cumulative_duration = durations[0]

    for i in range(1, len(clip_paths)):
        offset = cumulative_duration - dissolve_duration
        output_label = f"[v{i}]" if i < len(clip_paths) - 1 else "[outv]"

        video_filter_parts.append(
            f"{current_label}[{i}:v]xfade=transition=dissolve:duration={dissolve_duration}:offset={offset}{output_label}"
        )

        current_label = output_label
        cumulative_duration += durations[i] - dissolve_duration

    # Build audio crossfade chain
    audio_filter_parts = []
    if include_audio:
        current_audio = "[0:a]"
        for i in range(1, len(clip_paths)):
            output_label = f"[a{i}]" if i < len(clip_paths) - 1 else "[outa]"
            audio_filter_parts.append(
                f"{current_audio}[{i}:a]acrossfade=d={dissolve_duration}{output_label}"
            )
            current_audio = output_label

    # Combine filters
    all_filters = video_filter_parts + audio_filter_parts
    filter_complex = ';'.join(all_filters)

    # Build FFmpeg command
    cmd = ['ffmpeg', '-y']
    for path in clip_paths:
        cmd.extend(['-i', path])

    cmd.extend(['-filter_complex', filter_complex])
    cmd.extend(['-map', '[outv]'])

    if include_audio:
        cmd.extend(['-map', '[outa]'])
        cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
    else:
        cmd.append('-an')

    cmd.extend(['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p'])
    cmd.append(output_path)

    logger.info(f"[Multi-Clip] Running dissolve transition")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"[Multi-Clip] Dissolve error: {result.stderr}")
        raise RuntimeError(f"FFmpeg dissolve transition failed: {result.stderr}")


# =============================================================================
# Export Endpoints
# =============================================================================

@router.post("/crop")
async def export_crop(
    video: UploadFile = File(...),
    keyframes_json: str = Form(...)
):
    """
    Export video with crop applied.
    Accepts video file and crop keyframes, returns cropped video.
    """
    # Parse keyframes
    try:
        keyframes_data = json.loads(keyframes_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid keyframes JSON: {str(e)}")

    keyframes = [CropKeyframe(**kf) for kf in keyframes_data]

    if len(keyframes) == 0:
        raise HTTPException(status_code=400, detail="No crop keyframes provided")

    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"output_{uuid.uuid4().hex}.mp4")

    # Save uploaded file
    with open(input_path, 'wb') as f:
        content = await video.read()
        f.write(content)

    # Get video info
    probe = ffmpeg.probe(input_path)
    video_info = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    duration = float(probe['format']['duration'])
    fps = eval(video_info['r_frame_rate'])

    # Convert keyframes to dict format
    keyframes_dict = [
        {
            'time': kf.time,
            'x': kf.x,
            'y': kf.y,
            'width': kf.width,
            'height': kf.height
        }
        for kf in keyframes
    ]

    # Sort keyframes by time
    keyframes_dict.sort(key=lambda k: k['time'])

    # Generate crop filter with structured parameters
    crop_params = generate_crop_filter(keyframes_dict, duration, fps)

    # Process video with FFmpeg
    try:
        stream = ffmpeg.input(input_path)
        stream = ffmpeg.filter(stream, 'crop',
                             w=crop_params['width_expr'],
                             h=crop_params['height_expr'],
                             x=crop_params['x_expr'],
                             y=crop_params['y_expr'])
        stream = ffmpeg.output(stream, output_path,
                             vcodec='libx265',
                             crf=10,
                             preset='veryslow',
                             **{'x265-params': 'aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6'},
                             acodec='aac',
                             audio_bitrate='256k',
                             pix_fmt='yuv420p',
                             colorspace='bt709',
                             color_primaries='bt709',
                             color_trc='bt709',
                             color_range='tv')
        ffmpeg.run(stream, overwrite_output=True, capture_stdout=True, capture_stderr=True)
    except ffmpeg.Error as e:
        # Fallback to average crop
        logger.warning(f"Complex crop filter failed, falling back to average crop. Error: {e.stderr.decode()}")

        avg_crop = {
            'x': round(sum(kf['x'] for kf in keyframes_dict) / len(keyframes_dict), 3),
            'y': round(sum(kf['y'] for kf in keyframes_dict) / len(keyframes_dict), 3),
            'width': round(sum(kf['width'] for kf in keyframes_dict) / len(keyframes_dict), 3),
            'height': round(sum(kf['height'] for kf in keyframes_dict) / len(keyframes_dict), 3)
        }

        stream = ffmpeg.input(input_path)
        stream = ffmpeg.filter(stream, 'crop',
                             avg_crop['width'], avg_crop['height'],
                             avg_crop['x'], avg_crop['y'])
        stream = ffmpeg.output(stream, output_path,
                             vcodec='libx265',
                             crf=10,
                             preset='veryslow',
                             **{'x265-params': 'aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6'},
                             acodec='aac',
                             audio_bitrate='256k',
                             pix_fmt='yuv420p',
                             colorspace='bt709',
                             color_primaries='bt709',
                             color_trc='bt709',
                             color_range='tv')
        ffmpeg.run(stream, overwrite_output=True, capture_stdout=True, capture_stderr=True)

    return FileResponse(
        output_path,
        media_type='video/mp4',
        filename=f"cropped_{video.filename}",
        background=None
    )


@router.post("/upscale")
async def export_with_ai_upscale(
    video: UploadFile = File(...),
    keyframes_json: str = Form(...),
    target_fps: int = Form(30),
    export_id: str = Form(...),
    export_mode: str = Form("quality"),
    segment_data_json: str = Form(None),
    include_audio: str = Form("true"),
    enable_source_preupscale: str = Form("false"),
    enable_diffusion_sr: str = Form("false"),
):
    """
    Export video with AI upscaling and de-zoom (Framing mode).

    This endpoint handles crop, trim, speed, and AI upscaling.
    Highlight overlays are handled separately by /overlay endpoint.

    Steps:
    1. Extracts frames with crop applied (de-zoom - removes digital zoom)
    2. Detects aspect ratio and determines target resolution
    3. Upscales each frame using Real-ESRGAN AI model
    4. Reassembles into final video
    """
    # Initialize progress tracking
    export_progress[export_id] = {
        "progress": 10,
        "message": "Starting export...",
        "status": "processing"
    }

    # Parse parameters
    include_audio_bool = include_audio.lower() == "true"
    enable_source_preupscale_bool = enable_source_preupscale.lower() == "true"
    enable_diffusion_sr_bool = enable_diffusion_sr.lower() == "true"

    logger.info(f"Audio setting: {'Include audio' if include_audio_bool else 'Video only'}")

    # Parse keyframes
    try:
        keyframes_data = json.loads(keyframes_json)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid keyframes JSON: {str(e)}")

    keyframes = [CropKeyframe(**kf) for kf in keyframes_data]
    if len(keyframes) == 0:
        raise HTTPException(status_code=400, detail="No crop keyframes provided")

    # Parse segment data (speed/trim)
    segment_data = None
    if segment_data_json:
        try:
            segment_data = json.loads(segment_data_json)
            logger.info(f"Segment data received: {json.dumps(segment_data, indent=2)}")
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid segment data JSON: {str(e)}")

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"upscaled_{uuid.uuid4().hex}.mp4")

    try:
        # Save uploaded file
        with open(input_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        # Convert keyframes
        keyframes_dict = [
            {'time': kf.time, 'x': kf.x, 'y': kf.y, 'width': kf.width, 'height': kf.height}
            for kf in keyframes
        ]

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
            enable_source_preupscale=enable_source_preupscale_bool,
            enable_diffusion_sr=enable_diffusion_sr_bool,
            sr_model_name='realesr_general_x4v3'
        )

        if upscaler.upsampler is None:
            raise HTTPException(
                status_code=503,
                detail={"error": "AI SR model failed to load"}
            )

        # Capture event loop
        loop = asyncio.get_running_loop()

        # Progress ranges
        if export_mode == "FAST":
            progress_ranges = {
                'ai_upscale': (10, 95),
                'ffmpeg_encode': (95, 100)
            }
        else:
            progress_ranges = {
                'ai_upscale': (10, 28),
                'ffmpeg_pass1': (28, 81),
                'ffmpeg_encode': (81, 100)
            }

        def progress_callback(current, total, message, phase='ai_upscale'):
            if phase not in progress_ranges:
                phase = 'ai_upscale'
            start_percent, end_percent = progress_ranges[phase]
            phase_progress = (current / total) if total > 0 else 0
            overall_percent = start_percent + (phase_progress * (end_percent - start_percent))

            progress_data = {
                "progress": overall_percent,
                "message": message,
                "status": "processing",
                "current": current,
                "total": total,
                "phase": phase
            }
            export_progress[export_id] = progress_data
            logger.info(f"Progress: {overall_percent:.1f}% - {message}")

            try:
                asyncio.run_coroutine_threadsafe(
                    manager.send_progress(export_id, progress_data),
                    loop
                )
            except Exception as e:
                logger.error(f"Failed to send WebSocket update: {e}")

        # Update progress
        init_data = {"progress": 10, "message": "Initializing AI upscaler...", "status": "processing"}
        export_progress[export_id] = init_data
        await manager.send_progress(export_id, init_data)

        # Run upscaling (no highlight params - those are handled by /overlay endpoint)
        result = await asyncio.to_thread(
            upscaler.process_video_with_upscale,
            input_path=input_path,
            output_path=output_path,
            keyframes=keyframes_dict,
            target_fps=target_fps,
            export_mode=export_mode,
            progress_callback=progress_callback,
            segment_data=segment_data,
            include_audio=include_audio_bool,
        )

        logger.info(f"AI upscaling complete. Output: {output_path}")

        # Complete
        complete_data = {"progress": 100, "message": "Export complete!", "status": "complete"}
        export_progress[export_id] = complete_data
        await manager.send_progress(export_id, complete_data)

        return FileResponse(
            output_path,
            media_type='video/mp4',
            filename=f"upscaled_{video.filename}",
            background=None
        )

    except Exception as e:
        logger.error(f"AI upscaling failed: {str(e)}", exc_info=True)
        error_data = {"progress": 0, "message": f"Export failed: {str(e)}", "status": "error"}
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)

        import shutil
        import time
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[AI Upscale] Cleanup failed: {cleanup_error}")
        raise HTTPException(status_code=500, detail=f"AI upscaling failed: {str(e)}")


@router.post("/overlay")
async def export_overlay_only(
    video: UploadFile = File(...),
    export_id: str = Form(...),
    highlight_regions_json: str = Form(None),  # New region-based format
    highlight_keyframes_json: str = Form(None),  # Legacy flat format (deprecated)
    highlight_effect_type: str = Form("original"),
):
    """
    Export video with highlight overlays ONLY - no cropping, no AI upscaling.

    This is a fast export for Overlay mode where the video has already been
    cropped/trimmed during Framing export.

    Audio from input video is always preserved (audio settings are handled in framing export).

    Highlight format (new region-based):
    [
        {
            "id": "region-123",
            "start_time": 0,
            "end_time": 3,
            "keyframes": [
                {"time": 0, "x": 100, "y": 200, "radiusX": 50, "radiusY": 80, "opacity": 0.15, "color": "#FFFF00"},
                ...
            ]
        },
        ...
    ]
    """
    import cv2
    from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator

    # Initialize progress
    export_progress[export_id] = {
        "progress": 5,
        "message": "Starting overlay export...",
        "status": "processing"
    }

    logger.info(f"[Overlay Export] Effect type: {highlight_effect_type}")

    # Parse highlight regions (new format) or keyframes (legacy format)
    highlight_regions = []

    if highlight_regions_json:
        # New region-based format
        try:
            regions_data = json.loads(highlight_regions_json)
            for region in regions_data:
                highlight_regions.append({
                    'id': region.get('id', ''),
                    'start_time': region['start_time'],
                    'end_time': region['end_time'],
                    'keyframes': [
                        {
                            'time': kf['time'],
                            'x': kf['x'],
                            'y': kf['y'],
                            'radiusX': kf['radiusX'],
                            'radiusY': kf['radiusY'],
                            'opacity': kf['opacity'],
                            'color': kf['color']
                        }
                        for kf in region.get('keyframes', [])
                    ]
                })
            logger.info(f"[Overlay Export] Received {len(highlight_regions)} highlight regions:")
            for region in highlight_regions:
                logger.info(f"  Region {region['id']}: {region['start_time']:.2f}s - {region['end_time']:.2f}s, {len(region['keyframes'])} keyframes")
        except (json.JSONDecodeError, KeyError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight regions JSON: {str(e)}")
    elif highlight_keyframes_json:
        # Legacy flat keyframe format - convert to single region covering entire video
        try:
            highlight_data = json.loads(highlight_keyframes_json)
            keyframes = [
                {
                    'time': kf['time'],
                    'x': kf['x'],
                    'y': kf['y'],
                    'radiusX': kf['radiusX'],
                    'radiusY': kf['radiusY'],
                    'opacity': kf['opacity'],
                    'color': kf['color']
                }
                for kf in highlight_data
            ]
            if keyframes:
                # Create a single region spanning all keyframes
                highlight_regions.append({
                    'id': 'legacy',
                    'start_time': keyframes[0]['time'],
                    'end_time': keyframes[-1]['time'],
                    'keyframes': keyframes
                })
            logger.info(f"[Overlay Export] Legacy format: {len(keyframes)} keyframes converted to 1 region")
        except (json.JSONDecodeError, KeyError) as e:
            raise HTTPException(status_code=400, detail=f"Invalid highlight keyframes JSON: {str(e)}")

    # Create temp directory
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, f"input_{uuid.uuid4().hex}{Path(video.filename).suffix}")
    output_path = os.path.join(temp_dir, f"overlay_{uuid.uuid4().hex}.mp4")
    frames_dir = os.path.join(temp_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    try:
        # Save uploaded file
        with open(input_path, 'wb') as f:
            content = await video.read()
            f.write(content)

        # Update progress
        progress_data = {"progress": 10, "message": "Processing video...", "status": "processing"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        # Open video
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Could not open video file")

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        logger.info(f"[Overlay Export] Video: {width}x{height} @ {fps}fps, {frame_count} frames")

        # Fast path: no highlights
        if not highlight_regions:
            cap.release()
            logger.info("[Overlay Export] No highlights - copying video directly")
            import shutil
            shutil.copy(input_path, output_path)

            progress_data = {"progress": 100, "message": "Export complete!", "status": "complete"}
            export_progress[export_id] = progress_data
            await manager.send_progress(export_id, progress_data)

            return FileResponse(
                output_path,
                media_type='video/mp4',
                filename=f"overlayed_{video.filename}",
                background=None
            )

        # SINGLE-PASS APPROACH: Process all frames, only render highlights where needed
        # This is simpler and more reliable than segment-based approach

        video_duration = frame_count / fps
        logger.info(f"[Overlay Export] Video duration: {video_duration:.3f}s")

        # Sort regions by start time for efficient lookup
        sorted_regions = sorted(highlight_regions, key=lambda r: r['start_time'])
        for region in sorted_regions:
            logger.info(f"  Region: {region['start_time']:.3f}s - {region['end_time']:.3f}s ({len(region['keyframes'])} keyframes)")

        # Process all frames
        logger.info(f"[Overlay Export] Processing {frame_count} frames...")

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current_time = frame_idx / fps

            # Find active region for this frame
            active_region = None
            for region in sorted_regions:
                if region['start_time'] <= current_time <= region['end_time']:
                    active_region = region
                    break

            # Render highlight if in a region
            if active_region:
                highlight = KeyframeInterpolator.interpolate_highlight(active_region['keyframes'], current_time)
                if highlight is not None:
                    frame = KeyframeInterpolator.render_highlight_on_frame(
                        frame,
                        highlight,
                        (width, height),
                        crop=None,
                        effect_type=highlight_effect_type
                    )

            # Write frame
            frame_path = os.path.join(frames_dir, f"frame_{frame_idx:06d}.png")
            cv2.imwrite(frame_path, frame)
            frame_idx += 1

            # Update progress
            if frame_idx % 30 == 0:
                progress = 10 + int((frame_idx / frame_count) * 60)
                progress_data = {
                    "progress": progress,
                    "message": f"Processing frames... {frame_idx}/{frame_count}",
                    "status": "processing"
                }
                export_progress[export_id] = progress_data
                await manager.send_progress(export_id, progress_data)

        cap.release()
        logger.info(f"[Overlay Export] Rendered {frame_idx} frames")

        # Encode final video with audio from original
        progress_data = {"progress": 75, "message": "Encoding video...", "status": "processing"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        ffmpeg_cmd = [
            'ffmpeg', '-y',
            '-framerate', str(fps),
            '-i', os.path.join(frames_dir, 'frame_%06d.png'),
            '-i', input_path,
            '-map', '0:v',
            '-map', '1:a?',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '18',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',
            output_path
        ]

        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"[Overlay Export] Encoding error: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"FFmpeg encoding failed: {result.stderr}")

        # Complete
        progress_data = {"progress": 100, "message": "Export complete!", "status": "complete"}
        export_progress[export_id] = progress_data
        await manager.send_progress(export_id, progress_data)

        def cleanup_temp_dir():
            import shutil
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)

        return FileResponse(
            output_path,
            media_type='video/mp4',
            filename=f"overlayed_{video.filename}",
            background=BackgroundTask(cleanup_temp_dir)
        )

    except HTTPException:
        import shutil
        import time
        # Delay cleanup to allow FFmpeg to release file handles
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Overlay Export] Cleanup failed (will be cleaned by OS): {cleanup_error}")
        raise
    except Exception as e:
        logger.error(f"[Overlay Export] Failed: {str(e)}", exc_info=True)
        error_data = {"progress": 0, "message": f"Export failed: {str(e)}", "status": "error"}
        export_progress[export_id] = error_data
        await manager.send_progress(export_id, error_data)
        import shutil
        import time
        # Delay cleanup to allow FFmpeg to release file handles
        time.sleep(0.5)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_error:
            logger.warning(f"[Overlay Export] Cleanup failed (will be cleaned by OS): {cleanup_error}")
        raise HTTPException(status_code=500, detail=f"Overlay export failed: {str(e)}")


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
    - multi_clip_data_json: JSON containing:
      {
        "clips": [
          {
            "clipIndex": 0,
            "fileName": "...",
            "segments": {...},
            "cropKeyframes": [...],
            "trimRange": {...}
          },
          ...
        ],
        "globalAspectRatio": "9:16",
        "transition": { "type": "fade", "duration": 0.5 }
      }
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
            clip_info=sorted_clips  # Pass clip info for chapter markers
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


# Note: The upscale-comparison endpoint is intentionally omitted from this refactor
# as it's a specialized debugging endpoint that adds significant complexity.
# It can be added later if needed by copying from the original main.py.


# =============================================================================
# Video Metadata Endpoints
# =============================================================================

@router.post("/chapters")
async def extract_chapters(
    video: UploadFile = File(...)
):
    """
    Extract chapter markers from a video file.

    Returns chapter data that can be used to auto-generate highlight regions
    in Overlay mode. Each chapter represents a clip boundary from a multi-clip export.

    Returns:
        {
            "chapters": [
                {
                    "title": "Clip Name",
                    "start_time": 0.0,
                    "end_time": 10.5
                },
                ...
            ]
        }
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
            # Convert time from string ratio (e.g., "10/1") or float
            start_time = float(chapter.get('start_time', 0))
            end_time = float(chapter.get('end_time', 0))

            # Get chapter title from tags
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
        # Return empty chapters on error - video may not have chapters
        return {"chapters": []}

    finally:
        # Cleanup (with retry for Windows file locking)
        import time
        time.sleep(0.3)
        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass  # Let OS clean up temp files


@router.post("/concat-for-overlay")
async def concat_for_overlay(
    request: Request,
):
    """
    Concatenate multiple video clips without any framing/cropping.

    This endpoint is used when the user wants to skip Framing mode and go
    directly to Overlay mode with pre-edited clips. The clips are simply
    concatenated with a cut transition and chapter markers are embedded.

    Returns the concatenated video blob and clip metadata for auto-generating
    highlight regions in Overlay mode.

    Request format (multipart form):
    - video_0, video_1, video_2, ... : Video files uploaded as multipart form
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
            # Calculate clip metadata
            # 'name' is used by frontend for display label
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

            # Return the file with clip metadata in header
            import base64
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
            clip_info=clip_info  # For chapter markers
        )

        # Calculate clip timestamps in concatenated video
        # 'name' is used by frontend for display label
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

        # Return the file with clip metadata in header
        import base64
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


# =============================================================================
# Project-Based Export Endpoints
# =============================================================================

@router.post("/framing")
async def export_framing(
    project_id: int = Form(...),
    video: UploadFile = File(...),
    clips_data: str = Form("[]")
):
    """
    Export framed video for a project.

    This endpoint:
    1. Receives the rendered video from the frontend
    2. Saves it to working_videos folder
    3. Creates working_videos DB entry with next version number
    4. Updates project.working_video_id
    5. Resets project.final_video_id (framing changed, need to re-export overlay)
    6. Sets exported_at timestamp for all working clips

    Request:
    - project_id: The project ID
    - video: The rendered video file
    - clips_data: JSON with clip configurations (for metadata)

    Response:
    - success: boolean
    - working_video_id: The new working video ID
    - filename: The saved filename
    """
    logger.info(f"[Framing Export] Starting for project {project_id}")

    try:
        clips_config = json.loads(clips_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid clips_data JSON")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id, working_video_id FROM projects WHERE id = ?", (project_id,))
        project = cursor.fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Generate unique filename
        filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
        file_path = WORKING_VIDEOS_PATH / filename

        # Save the video file
        content = await video.read()
        with open(file_path, 'wb') as f:
            f.write(content)

        logger.info(f"[Framing Export] Saved working video: {filename} ({len(content)} bytes)")

        # Get next version number for working video
        cursor.execute("""
            SELECT COALESCE(MAX(version), 0) + 1 as next_version
            FROM working_videos
            WHERE project_id = ?
        """, (project_id,))
        next_version = cursor.fetchone()['next_version']

        # Reset final_video_id since framing changed (user needs to re-export from overlay)
        cursor.execute("""
            UPDATE projects SET final_video_id = NULL WHERE id = ?
        """, (project_id,))
        logger.info(f"[Framing Export] Reset final_video_id due to framing change")

        # Create new working video entry with version number
        cursor.execute("""
            INSERT INTO working_videos (project_id, filename, version)
            VALUES (?, ?, ?)
        """, (project_id, filename, next_version))
        working_video_id = cursor.lastrowid

        # Update project with new working video ID
        cursor.execute("""
            UPDATE projects SET working_video_id = ? WHERE id = ?
        """, (working_video_id, project_id))

        # Set exported_at timestamp for all working clips (latest versions only)
        cursor.execute("""
            UPDATE working_clips
            SET exported_at = datetime('now')
            WHERE id IN (
                SELECT id FROM (
                    SELECT wc.id, ROW_NUMBER() OVER (
                        PARTITION BY COALESCE(rc.end_time, wc.uploaded_filename)
                        ORDER BY wc.version DESC
                    ) as rn
                    FROM working_clips wc
                    LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
                    WHERE wc.project_id = ?
                ) WHERE rn = 1
            )
        """, (project_id,))

        conn.commit()

        logger.info(f"[Framing Export] Created working video {working_video_id} for project {project_id}")

        return JSONResponse({
            'success': True,
            'working_video_id': working_video_id,
            'filename': filename,
            'project_id': project_id
        })


@router.get("/projects/{project_id}/working-video")
async def get_working_video(project_id: int):
    """Stream the working video for a project."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get latest working video for this project
        cursor.execute("""
            SELECT filename
            FROM working_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))
        result = cursor.fetchone()

        if not result:
            raise HTTPException(status_code=404, detail="Working video not found")

        file_path = WORKING_VIDEOS_PATH / result['filename']
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        return FileResponse(
            path=str(file_path),
            media_type="video/mp4",
            filename=result['filename']
        )


@router.post("/final")
async def export_final(
    project_id: int = Form(...),
    video: UploadFile = File(...),
    overlay_data: str = Form("{}")
):
    """
    Export final video with overlays for a project.

    This endpoint:
    1. Receives the rendered video with overlays from the frontend
    2. Saves it to final_videos folder
    3. Creates final_videos DB entry with next version number
    4. Updates project.final_video_id to point to latest version

    Request:
    - project_id: The project ID
    - video: The rendered video file with overlays
    - overlay_data: JSON with overlay configurations (for metadata)

    Response:
    - success: boolean
    - final_video_id: The new final video ID
    - filename: The saved filename
    """
    logger.info(f"[Final Export] Starting for project {project_id}")

    try:
        overlay_config = json.loads(overlay_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid overlay_data JSON")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists and has a working video
        cursor.execute("""
            SELECT id, name, working_video_id, final_video_id
            FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if not project['working_video_id']:
            raise HTTPException(
                status_code=400,
                detail="Project must have a working video before final export"
            )

        # Generate filename using project name
        # Sanitize project name: keep alphanumeric, spaces, hyphens, underscores
        project_name = project['name'] or f"project_{project_id}"
        safe_name = re.sub(r'[^\w\s-]', '', project_name).strip()
        safe_name = re.sub(r'[\s]+', '_', safe_name)  # Replace spaces with underscores
        if not safe_name:
            safe_name = f"project_{project_id}"

        # Check for existing file and add version suffix if needed
        base_filename = f"{safe_name}_final"
        filename = f"{base_filename}.mp4"
        file_path = FINAL_VIDEOS_PATH / filename
        version_suffix = 1
        while file_path.exists():
            version_suffix += 1
            filename = f"{base_filename}_{version_suffix}.mp4"
            file_path = FINAL_VIDEOS_PATH / filename

        # Save the video file
        content = await video.read()
        with open(file_path, 'wb') as f:
            f.write(content)

        logger.info(f"[Final Export] Saved final video: {filename} ({len(content)} bytes)")

        # Get next version number for final video
        cursor.execute("""
            SELECT COALESCE(MAX(version), 0) + 1 as next_version
            FROM final_videos
            WHERE project_id = ?
        """, (project_id,))
        next_version = cursor.fetchone()['next_version']
        logger.info(f"[Final Export] Creating final video version {next_version} for project {project_id}")

        # Create new final video entry with version number
        cursor.execute("""
            INSERT INTO final_videos (project_id, filename, version)
            VALUES (?, ?, ?)
        """, (project_id, filename, next_version))
        final_video_id = cursor.lastrowid

        # Update project with new final video ID
        cursor.execute("""
            UPDATE projects SET final_video_id = ? WHERE id = ?
        """, (final_video_id, project_id))

        conn.commit()

        logger.info(f"[Final Export] Created final video {final_video_id} for project {project_id}")

        return JSONResponse({
            'success': True,
            'final_video_id': final_video_id,
            'filename': filename,
            'project_id': project_id
        })


@router.get("/projects/{project_id}/final-video")
async def get_final_video(project_id: int):
    """Stream the final video for a project."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get latest final video for this project
        cursor.execute("""
            SELECT filename
            FROM final_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))
        result = cursor.fetchone()

        if not result:
            raise HTTPException(status_code=404, detail="Final video not found")

        file_path = FINAL_VIDEOS_PATH / result['filename']
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        return FileResponse(
            path=str(file_path),
            media_type="video/mp4",
            filename=result['filename']
        )


@router.put("/projects/{project_id}/overlay-data")
async def save_overlay_data(
    project_id: int,
    highlights_data: str = Form("[]"),
    text_overlays: str = Form("[]"),
    effect_type: str = Form("original")
):
    """
    Save overlay editing state for a project.

    Called by frontend auto-save when user modifies highlights in Overlay mode.
    Saves to working_videos table for the project's current working video.

    Request (form data):
    - highlights_data: JSON string of highlight regions
    - text_overlays: JSON string of text overlay configs
    - effect_type: 'original' | 'brightness_boost' | 'dark_overlay'

    Response:
    - success: boolean
    - saved_at: timestamp
    """
    logger.info(f"[Overlay Data] Saving for project {project_id}")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get project's current working video
        cursor.execute("""
            SELECT working_video_id FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if not project['working_video_id']:
            raise HTTPException(
                status_code=400,
                detail="Project has no working video - complete framing first"
            )

        # Update working video with overlay data
        cursor.execute("""
            UPDATE working_videos
            SET highlights_data = ?,
                text_overlays = ?,
                effect_type = ?
            WHERE id = ?
        """, (highlights_data, text_overlays, effect_type, project['working_video_id']))

        conn.commit()

        logger.info(f"[Overlay Data] Saved for working_video {project['working_video_id']}")

        return JSONResponse({
            'success': True,
            'saved_at': datetime.now().isoformat(),
            'working_video_id': project['working_video_id']
        })


@router.get("/projects/{project_id}/overlay-data")
async def get_overlay_data(project_id: int):
    """
    Get saved overlay editing state for a project.

    Called by frontend when entering Overlay mode to restore previous edits.

    Response:
    - highlights_data: Parsed JSON array of highlight regions
    - text_overlays: Parsed JSON array of text overlay configs
    - effect_type: 'original' | 'brightness_boost' | 'dark_overlay'
    - has_data: boolean indicating if any data exists
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get latest working video's overlay data for this project
        cursor.execute("""
            SELECT highlights_data, text_overlays, effect_type
            FROM working_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))
        result = cursor.fetchone()

        if not result:
            return JSONResponse({
                'highlights_data': [],
                'text_overlays': [],
                'effect_type': 'original',
                'has_data': False
            })

        # Parse JSON strings
        highlights = []
        text_overlays = []

        if result['highlights_data']:
            try:
                highlights = json.loads(result['highlights_data'])
            except json.JSONDecodeError:
                pass

        if result['text_overlays']:
            try:
                text_overlays = json.loads(result['text_overlays'])
            except json.JSONDecodeError:
                pass

        return JSONResponse({
            'highlights_data': highlights,
            'text_overlays': text_overlays,
            'effect_type': result['effect_type'] or 'original',
            'has_data': len(highlights) > 0 or len(text_overlays) > 0
        })