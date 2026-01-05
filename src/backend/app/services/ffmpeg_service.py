"""
FFmpeg Service - Helper functions for video processing with FFmpeg.

This module provides low-level FFmpeg operations used by video processors.
It isolates FFmpeg-specific code to make the codebase more maintainable
and testable.
"""

import subprocess
import tempfile
import os
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)


def get_video_duration(video_path: str) -> float:
    """Get video duration using FFprobe."""
    cmd = [
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        video_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(result.stdout.strip())
    except (subprocess.CalledProcessError, ValueError) as e:
        logger.error(f"Failed to get duration for {video_path}: {e}")
        return 0.0


def get_video_info(video_path: str) -> Dict[str, Any]:
    """
    Get comprehensive video information using FFprobe.

    Returns:
        Dictionary with width, height, duration, fps, codec
    """
    cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate,codec_name',
        '-show_entries', 'format=duration',
        '-of', 'json',
        video_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        import json
        data = json.loads(result.stdout)

        stream = data.get('streams', [{}])[0]
        format_data = data.get('format', {})

        # Parse frame rate (e.g., "30/1" -> 30.0)
        fps_str = stream.get('r_frame_rate', '30/1')
        if '/' in fps_str:
            num, den = fps_str.split('/')
            fps = float(num) / float(den) if float(den) != 0 else 30.0
        else:
            fps = float(fps_str)

        return {
            'width': stream.get('width', 0),
            'height': stream.get('height', 0),
            'duration': float(format_data.get('duration', 0)),
            'fps': fps,
            'codec': stream.get('codec_name', 'unknown'),
        }
    except Exception as e:
        logger.error(f"Failed to get video info for {video_path}: {e}")
        return {'width': 0, 'height': 0, 'duration': 0, 'fps': 30.0, 'codec': 'unknown'}


def create_chapter_metadata_file(
    chapters: List[Dict[str, Any]],
    output_path: str
) -> str:
    """
    Create an FFmpeg-compatible chapter metadata file.

    Args:
        chapters: List of chapter dicts with 'name', 'start_time', 'end_time'
        output_path: Base path for the video file (metadata file will be created nearby)

    Returns:
        Path to the created metadata file
    """
    metadata_path = output_path + '.chapters.txt'

    with open(metadata_path, 'w', encoding='utf-8') as f:
        f.write(';FFMETADATA1\n')

        for chapter in chapters:
            # FFmpeg uses milliseconds for timestamps
            start_ms = int(chapter['start_time'] * 1000)
            end_ms = int(chapter['end_time'] * 1000)

            f.write('\n[CHAPTER]\n')
            f.write('TIMEBASE=1/1000\n')
            f.write(f'START={start_ms}\n')
            f.write(f'END={end_ms}\n')
            f.write(f"title={chapter['name']}\n")

    return metadata_path


def add_chapters_to_video(
    input_path: str,
    metadata_path: str,
    output_path: str
) -> bool:
    """
    Add chapter metadata to a video file.

    Args:
        input_path: Path to input video
        metadata_path: Path to FFmpeg metadata file
        output_path: Path for output video with chapters

    Returns:
        True if successful, False otherwise
    """
    cmd = [
        'ffmpeg', '-y',
        '-i', input_path,
        '-i', metadata_path,
        '-map_metadata', '1',
        '-codec', 'copy',
        output_path
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to add chapters: {e.stderr}")
        return False


def concatenate_with_cut(
    clip_paths: List[str],
    output_path: str,
    include_audio: bool = True
) -> bool:
    """
    Concatenate clips with simple cut transitions (no crossfade).

    Args:
        clip_paths: List of input video paths
        output_path: Path for concatenated output
        include_audio: Whether to include audio

    Returns:
        True if successful, False otherwise
    """
    if not clip_paths:
        return False

    # Create concat file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        concat_file = f.name
        for path in clip_paths:
            # FFmpeg concat demuxer requires escaped paths
            escaped_path = path.replace("'", "'\\''")
            f.write(f"file '{escaped_path}'\n")

    try:
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

        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Cut concatenation failed: {e.stderr}")
        return False
    finally:
        if os.path.exists(concat_file):
            os.remove(concat_file)


def concatenate_with_fade(
    clip_paths: List[str],
    output_path: str,
    fade_duration: float = 0.5,
    include_audio: bool = True
) -> bool:
    """
    Concatenate clips with fade to black transitions.

    Args:
        clip_paths: List of input video paths
        output_path: Path for concatenated output
        fade_duration: Duration of fade in seconds
        include_audio: Whether to include audio

    Returns:
        True if successful, False otherwise
    """
    if not clip_paths:
        return False

    durations = [get_video_duration(path) for path in clip_paths]
    filter_parts = []
    video_labels = []
    audio_labels = []

    for i, (path, dur) in enumerate(zip(clip_paths, durations)):
        is_first = (i == 0)
        is_last = (i == len(clip_paths) - 1)

        # Video filter: fade in/out
        effects = []

        if not is_last:
            fade_start = max(0, dur - fade_duration)
            effects.append(f"fade=t=out:st={fade_start}:d={fade_duration}")

        if not is_first:
            effects.append(f"fade=t=in:st=0:d={fade_duration}")

        if effects:
            filter_parts.append(f"[{i}:v]{','.join(effects)}[v{i}]")
        else:
            filter_parts.append(f"[{i}:v]copy[v{i}]")
        video_labels.append(f"[v{i}]")

        # Audio filter
        if include_audio:
            audio_effects = []
            if not is_last:
                audio_effects.append(f"afade=t=out:st={max(0, dur - fade_duration)}:d={fade_duration}")
            if not is_first:
                audio_effects.append(f"afade=t=in:st=0:d={fade_duration}")

            if audio_effects:
                filter_parts.append(f"[{i}:a]{','.join(audio_effects)}[a{i}]")
            else:
                filter_parts.append(f"[{i}:a]acopy[a{i}]")
            audio_labels.append(f"[a{i}]")

    # Concatenate
    filter_parts.append(f"{''.join(video_labels)}concat=n={len(clip_paths)}:v=1:a=0[outv]")
    if include_audio:
        filter_parts.append(f"{''.join(audio_labels)}concat=n={len(clip_paths)}:v=0:a=1[outa]")

    filter_complex = ';'.join(filter_parts)

    # Build command
    cmd = ['ffmpeg', '-y']
    for path in clip_paths:
        cmd.extend(['-i', path])

    cmd.extend(['-filter_complex', filter_complex])
    cmd.extend(['-map', '[outv]'])

    if include_audio:
        cmd.extend(['-map', '[outa]', '-c:a', 'aac', '-b:a', '192k'])
    else:
        cmd.append('-an')

    cmd.extend(['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p'])
    cmd.append(output_path)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Fade concatenation failed: {e.stderr}")
        return False


def concatenate_with_dissolve(
    clip_paths: List[str],
    output_path: str,
    dissolve_duration: float = 0.5,
    include_audio: bool = True
) -> bool:
    """
    Concatenate clips with cross-dissolve transitions using xfade filter.

    Args:
        clip_paths: List of input video paths
        output_path: Path for concatenated output
        dissolve_duration: Duration of dissolve in seconds
        include_audio: Whether to include audio

    Returns:
        True if successful, False otherwise
    """
    if not clip_paths:
        return False

    if len(clip_paths) == 1:
        # Single clip, just copy
        import shutil
        shutil.copy2(clip_paths[0], output_path)
        return True

    durations = [get_video_duration(path) for path in clip_paths]

    # Video xfade chain
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

    # Build command
    cmd = ['ffmpeg', '-y']
    for path in clip_paths:
        cmd.extend(['-i', path])

    cmd.extend(['-filter_complex', filter_complex])
    cmd.extend(['-map', '[outv]'])

    if include_audio:
        cmd.extend(['-map', '[outa]', '-c:a', 'aac', '-b:a', '192k'])
    else:
        cmd.append('-an')

    cmd.extend(['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p'])
    cmd.append(output_path)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Dissolve concatenation failed: {e.stderr}")
        return False


def concatenate_clips(
    clip_paths: List[str],
    output_path: str,
    transition_type: str = "cut",
    transition_duration: float = 0.5,
    include_audio: bool = True
) -> bool:
    """
    Concatenate clips with the specified transition type.

    Args:
        clip_paths: List of input video paths
        output_path: Path for concatenated output
        transition_type: "cut" | "fade" | "dissolve"
        transition_duration: Duration of transition in seconds
        include_audio: Whether to include audio

    Returns:
        True if successful, False otherwise
    """
    if transition_type == "fade":
        return concatenate_with_fade(clip_paths, output_path, transition_duration, include_audio)
    elif transition_type == "dissolve":
        return concatenate_with_dissolve(clip_paths, output_path, transition_duration, include_audio)
    else:  # "cut" or default
        return concatenate_with_cut(clip_paths, output_path, include_audio)


def extract_clip(
    input_path: str,
    output_path: str,
    start_time: float,
    end_time: float,
    copy_codec: bool = True
) -> bool:
    """
    Extract a clip from a video file.

    Args:
        input_path: Path to input video
        output_path: Path for extracted clip
        start_time: Start time in seconds
        end_time: End time in seconds
        copy_codec: If True, copy codecs (faster); if False, re-encode

    Returns:
        True if successful, False otherwise
    """
    duration = end_time - start_time

    cmd = [
        'ffmpeg', '-y',
        '-ss', str(start_time),
        '-i', input_path,
        '-t', str(duration),
    ]

    if copy_codec:
        cmd.extend(['-c', 'copy'])
    else:
        cmd.extend(['-c:v', 'libx264', '-preset', 'fast', '-crf', '18'])
        cmd.extend(['-c:a', 'aac', '-b:a', '192k'])

    cmd.append(output_path)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Clip extraction failed: {e.stderr}")
        return False


def is_ffmpeg_available() -> bool:
    """Check if FFmpeg is available in PATH."""
    try:
        result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True,
            text=True,
            check=True
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def get_ffmpeg_version() -> Optional[str]:
    """Get FFmpeg version string."""
    try:
        result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True,
            text=True,
            check=True
        )
        # First line contains version
        return result.stdout.split('\n')[0]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
