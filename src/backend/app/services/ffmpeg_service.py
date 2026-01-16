"""
FFmpeg Service - Helper functions for video processing with FFmpeg.

This module provides low-level FFmpeg operations used by video processors.
It isolates FFmpeg-specific code to make the codebase more maintainable
and testable.

GPU Encoding Support:
- NVIDIA NVENC (h264_nvenc) - Fastest, requires NVIDIA GPU
- Intel QuickSync (h264_qsv) - Fast, requires Intel CPU with iGPU
- AMD AMF (h264_amf) - Fast, requires AMD GPU
- CPU fallback (libx264) - Always available
"""

import subprocess
import tempfile
import os
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from functools import lru_cache

logger = logging.getLogger(__name__)

# =============================================================================
# GPU ENCODER DETECTION AND CONFIGURATION
# =============================================================================

def _test_encoder_works(encoder: str) -> bool:
    """
    Actually test if an encoder works by running a minimal encode.
    This catches cases where the encoder is listed but driver is too old.
    """
    try:
        # Create a minimal test: encode 1 frame of black video
        cmd = [
            'ffmpeg', '-y',
            '-f', 'lavfi', '-i', 'color=black:s=64x64:d=0.1',
            '-c:v', encoder,
            '-frames:v', '1',
            '-f', 'null', '-'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return result.returncode == 0
    except Exception as e:
        logger.debug(f"Encoder test failed for {encoder}: {e}")
        return False


@lru_cache(maxsize=1)
def get_available_encoders() -> Dict[str, bool]:
    """
    Check which hardware encoders are available AND working.
    Results are cached for the lifetime of the process.

    This does a runtime test of each encoder to catch driver version issues.

    Returns:
        Dictionary mapping encoder names to availability
    """
    try:
        result = subprocess.run(
            ['ffmpeg', '-encoders'],
            capture_output=True, text=True, timeout=10
        )
        output = result.stdout + result.stderr

        # First check which encoders are listed
        listed_encoders = {
            'h264_nvenc': 'h264_nvenc' in output,
            'hevc_nvenc': 'hevc_nvenc' in output,
            'h264_qsv': 'h264_qsv' in output,
            'h264_amf': 'h264_amf' in output,
            'h264_videotoolbox': 'h264_videotoolbox' in output,
            'libx264': True
        }

        # Now actually test each listed GPU encoder to verify it works
        encoders = {'libx264': True}  # CPU always works

        for encoder in ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox']:
            if listed_encoders.get(encoder):
                logger.info(f"Testing {encoder}...")
                if _test_encoder_works(encoder):
                    encoders[encoder] = True
                    logger.info(f"  {encoder}: OK")
                else:
                    encoders[encoder] = False
                    logger.warning(f"  {encoder}: Listed but not working (driver issue?)")

        # Log final available encoders
        available = [k for k, v in encoders.items() if v]
        logger.info(f"Working H.264 encoders: {available}")

        return encoders
    except Exception as e:
        logger.warning(f"Failed to detect encoders, using CPU fallback: {e}")
        return {'libx264': True}


def get_best_encoder(prefer_quality: bool = True) -> Tuple[str, Dict[str, str]]:
    """
    Get the best available H.264 encoder with optimal settings.

    Args:
        prefer_quality: If True, use quality-oriented settings; if False, use speed settings

    Returns:
        Tuple of (encoder_name, encoder_params_dict)
    """
    encoders = get_available_encoders()

    # NVIDIA NVENC - Best GPU option
    if encoders.get('h264_nvenc'):
        if prefer_quality:
            params = {
                'preset': 'p4',      # Balanced (p1=fastest, p7=best quality)
                'rc': 'vbr',         # Variable bitrate
                'cq': '19',          # Quality level (0-51, lower=better)
                'b:v': '0',          # Let CQ control quality
            }
        else:
            params = {
                'preset': 'p1',      # Fastest
                'rc': 'vbr',
                'cq': '23',
                'b:v': '0',
            }
        logger.info("Using NVIDIA NVENC encoder")
        return 'h264_nvenc', params

    # Intel QuickSync
    if encoders.get('h264_qsv'):
        if prefer_quality:
            params = {
                'preset': 'medium',
                'global_quality': '19',
            }
        else:
            params = {
                'preset': 'veryfast',
                'global_quality': '23',
            }
        logger.info("Using Intel QuickSync encoder")
        return 'h264_qsv', params

    # AMD AMF
    if encoders.get('h264_amf'):
        if prefer_quality:
            params = {
                'quality': 'quality',
                'rc': 'vbr_latency',
                'qp_i': '19',
                'qp_p': '19',
            }
        else:
            params = {
                'quality': 'speed',
                'rc': 'vbr_latency',
                'qp_i': '23',
                'qp_p': '23',
            }
        logger.info("Using AMD AMF encoder")
        return 'h264_amf', params

    # macOS VideoToolbox
    if encoders.get('h264_videotoolbox'):
        if prefer_quality:
            params = {
                'q:v': '65',  # Quality 0-100
            }
        else:
            params = {
                'q:v': '50',
            }
        logger.info("Using macOS VideoToolbox encoder")
        return 'h264_videotoolbox', params

    # CPU fallback (libx264)
    if prefer_quality:
        params = {
            'preset': 'fast',
            'crf': '18',
        }
    else:
        params = {
            'preset': 'ultrafast',
            'crf': '23',
        }
    logger.info("Using CPU (libx264) encoder")
    return 'libx264', params


def build_video_encoding_params(
    encoder: str,
    params: Dict[str, str],
    pixel_format: str = 'yuv420p'
) -> List[str]:
    """
    Build FFmpeg command-line parameters for video encoding.

    Args:
        encoder: Encoder name (e.g., 'h264_nvenc', 'libx264')
        params: Encoder-specific parameters
        pixel_format: Output pixel format

    Returns:
        List of FFmpeg command-line arguments
    """
    cmd = ['-c:v', encoder]

    if encoder == 'h264_nvenc':
        cmd.extend([
            '-preset', params.get('preset', 'p4'),
            '-rc', params.get('rc', 'vbr'),
            '-cq', params.get('cq', '19'),
            '-b:v', params.get('b:v', '0'),
        ])
    elif encoder == 'h264_qsv':
        cmd.extend([
            '-preset', params.get('preset', 'medium'),
            '-global_quality', params.get('global_quality', '19'),
        ])
    elif encoder == 'h264_amf':
        cmd.extend([
            '-quality', params.get('quality', 'quality'),
            '-rc', params.get('rc', 'vbr_latency'),
        ])
        if 'qp_i' in params:
            cmd.extend(['-qp_i', params['qp_i'], '-qp_p', params['qp_p']])
    elif encoder == 'h264_videotoolbox':
        cmd.extend(['-q:v', params.get('q:v', '65')])
    else:  # libx264
        cmd.extend([
            '-preset', params.get('preset', 'fast'),
            '-crf', params.get('crf', '18'),
        ])

    cmd.extend(['-pix_fmt', pixel_format])

    return cmd


def get_encoding_command_parts(prefer_quality: bool = True) -> List[str]:
    """
    Get video encoding command parts using best available encoder.
    Convenience function that combines get_best_encoder and build_video_encoding_params.

    Args:
        prefer_quality: If True, use quality settings; if False, use speed settings

    Returns:
        List of FFmpeg command-line arguments for video encoding
    """
    encoder, params = get_best_encoder(prefer_quality)
    return build_video_encoding_params(encoder, params)


# =============================================================================
# VIDEO INFO AND METADATA
# =============================================================================


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
        # Use GPU encoding if available
        encoding_params = get_encoding_command_parts(prefer_quality=True)

        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_file,
        ]
        cmd.extend(encoding_params)

        if include_audio:
            cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
        else:
            cmd.append('-an')

        cmd.append(output_path)

        logger.info(f"Cut concat command: {' '.join(cmd[:15])}...")
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

    # Use GPU encoding if available
    cmd.extend(get_encoding_command_parts(prefer_quality=True))
    cmd.append(output_path)

    try:
        logger.info(f"Fade concat command: {' '.join(cmd[:15])}...")
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

    # Use GPU encoding if available
    cmd.extend(get_encoding_command_parts(prefer_quality=True))
    cmd.append(output_path)

    try:
        logger.info(f"Dissolve concat command: {' '.join(cmd[:15])}...")
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
        # Use GPU encoding if available
        cmd.extend(get_encoding_command_parts(prefer_quality=True))
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
