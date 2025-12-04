"""
Video Encoding Module

Handles FFmpeg-based video encoding with:
- Frame interpolation support (RIFE CUDA/ncnn or FFmpeg minterpolate)
- Segment speed adjustments
- Audio handling
- Multi-pass encoding
"""

import cv2
import subprocess
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime

from .frame_interpolator import (
    get_frame_interpolator,
    InterpolationBackend,
    FrameInterpolator
)

logger = logging.getLogger(__name__)


class VideoEncoder:
    """
    FFmpeg-based video encoder with advanced features

    Supports:
    - Single-pass and multi-pass encoding
    - Frame interpolation
    - Segment-based speed adjustments
    - Audio tempo changes
    - Trimming
    """

    def __init__(
        self,
        codec: Optional[str] = None,
        preset: Optional[str] = None,
        crf: Optional[str] = None
    ):
        """
        Initialize video encoder

        Args:
            codec: FFmpeg codec (libx264, libx265), None = auto
            preset: FFmpeg preset (ultrafast, fast, slow), None = auto
            crf: Constant Rate Factor (lower = better quality), None = auto
        """
        self.ffmpeg_codec = codec
        self.ffmpeg_preset = preset
        self.ffmpeg_crf = crf

    @staticmethod
    def parse_ffmpeg_progress(line: str) -> Optional[int]:
        """
        Parse FFmpeg progress output to extract current frame number

        Args:
            line: Line from FFmpeg stderr output

        Returns:
            Frame number if found, None otherwise
        """
        # FFmpeg outputs progress lines like: "frame=  126 fps= 38 q=-1.0 ..."
        match = re.search(r'frame=\s*(\d+)', line)
        if match:
            return int(match.group(1))
        return None

    @staticmethod
    def build_atempo_filter(speed: float) -> str:
        """
        Build atempo filter chain for audio speed adjustment.
        FFmpeg's atempo only supports 0.5-2.0 range, so we chain multiple filters for extreme speeds.

        Args:
            speed: Target speed multiplier (e.g., 0.5 for half speed, 2.0 for double speed)

        Returns:
            String containing chained atempo filters (e.g., "atempo=2.0,atempo=2.0" for 4x speed)
        """
        if speed == 1.0:
            return ""  # No filter needed for normal speed

        if 0.5 <= speed <= 2.0:
            return f"atempo={speed}"

        # For speeds outside 0.5-2.0 range, chain multiple atempo filters
        filters = []
        remaining_speed = speed

        if speed > 2.0:
            # Chain multiple 2.0x filters
            while remaining_speed > 2.0:
                filters.append("atempo=2.0")
                remaining_speed /= 2.0
            # Apply remaining speed if it's not exactly 1.0
            if remaining_speed > 1.0:
                filters.append(f"atempo={remaining_speed}")
        else:  # speed < 0.5
            # Chain multiple 0.5x filters
            while remaining_speed < 0.5:
                filters.append("atempo=0.5")
                remaining_speed /= 0.5
            # Apply remaining speed if it's not exactly 1.0
            if remaining_speed < 1.0:
                filters.append(f"atempo={remaining_speed}")

        return ','.join(filters)

    @staticmethod
    def _get_minterpolate_filter(target_fps: float, high_quality: bool = True) -> str:
        """
        Get FFmpeg minterpolate filter string with optimized settings.

        Args:
            target_fps: Target frames per second
            high_quality: Use high-quality settings (slower but better)

        Returns:
            FFmpeg minterpolate filter string
        """
        if high_quality:
            # Best quality minterpolate settings:
            # - mi_mode=mci: Motion compensated interpolation (best quality)
            # - mc_mode=aobmc: Adaptive overlapped block motion compensation
            # - me_mode=bidir: Bidirectional motion estimation
            # - vsbmc=1: Variable-size block motion compensation (improves quality)
            # - scd=fdiff: Scene change detection using frame difference
            # - scd_threshold=10: Threshold for scene change detection
            return (
                f"minterpolate=fps={target_fps}:"
                f"mi_mode=mci:"
                f"mc_mode=aobmc:"
                f"me_mode=bidir:"
                f"vsbmc=1:"
                f"scd=fdiff:"
                f"scd_threshold=10"
            )
        else:
            # Faster but lower quality - simple blend
            return f"minterpolate=fps={target_fps}:mi_mode=blend"

    def create_video_from_frames(
        self,
        frames_dir: Path,
        output_path: str,
        fps: int,
        input_video_path: str,
        export_mode: str = "quality",
        progress_callback=None,
        segment_data: Optional[Dict[str, Any]] = None,
        include_audio: bool = True
    ):
        """
        Create video from enhanced frames using FFmpeg encoding
        Applies segment speed changes (with AI frame interpolation for 0.5x) and trimming

        Args:
            frames_dir: Directory containing frames
            output_path: Output video path
            fps: Output framerate
            input_video_path: Path to input video (for audio)
            export_mode: Export mode - "fast" (1-pass) or "quality" (2-pass)
            progress_callback: Optional callback(current, total, message, phase)
            segment_data: Optional segment speed/trim data for applying speed changes
            include_audio: Include audio in export (default True)
        """
        frames_pattern = str(frames_dir / "frame_%06d.png")

        # Count total frames for progress tracking
        frame_files = list(frames_dir.glob("frame_*.png"))
        input_frame_count = len(frame_files)
        logger.info(f"Total input frames: {input_frame_count}")

        # Get original FPS from input video (needed for frame interpolation and segment processing)
        cap = cv2.VideoCapture(input_video_path)
        original_fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()

        # Detect if frame interpolation is needed (target FPS > source FPS)
        # Use tolerance to handle floating-point comparisons (e.g., 29.97 vs 30)
        fps_tolerance = 0.5
        needs_interpolation = fps > (original_fps + fps_tolerance)
        interpolation_ratio = fps / original_fps if needs_interpolation else 1.0

        if needs_interpolation:
            logger.info("=" * 60)
            logger.info("AI FRAME INTERPOLATION REQUIRED")
            logger.info("=" * 60)
            logger.info(f"Source FPS: {original_fps}")
            logger.info(f"Target FPS: {fps}")
            logger.info(f"Interpolation ratio: {interpolation_ratio:.2f}x")
            logger.info(f"Using minterpolate with motion compensation for smooth {fps}fps output")
            logger.info("=" * 60)
        elif fps < original_fps:
            logger.info(f"Downsampling from {original_fps}fps to {fps}fps (no interpolation needed)")
        else:
            logger.info(f"Source and target FPS match ({original_fps}fps → {fps}fps, no interpolation needed)")

        # Build FFmpeg complex filter for segment speed changes
        filter_complex = None
        expected_output_frames = input_frame_count
        trim_filter = None

        # Initialize trim/segment variables (may be overwritten if segment_data exists)
        frames_pretrimmed = False
        trim_start = 0
        trim_end = None

        # Determine input framerate for FFmpeg (use original FPS to maintain correct timing)
        input_framerate = original_fps

        if segment_data:
            logger.info("=" * 60)
            logger.info("APPLYING SEGMENT SPEED/TRIM PROCESSING")
            logger.info("=" * 60)

            segments = segment_data.get('segments', [])
            trim_start = segment_data.get('trim_start', 0)
            trim_end = segment_data.get('trim_end')
            frames_pretrimmed = segment_data.get('frames_pretrimmed', False)

            # Calculate time offset for pre-trimmed frames
            # If frames are pre-trimmed, they start at 0.0s in the frame sequence
            # but represent trim_start in source time
            time_offset = trim_start if frames_pretrimmed else 0.0

            if segments:
                # Build complex filtergraph for segment-based speed changes
                filter_parts = []
                audio_filter_parts = []
                output_labels = []
                audio_output_labels = []
                expected_output_frames = 0

                if frames_pretrimmed:
                    logger.info(f"Frames pre-trimmed: adjusting all segment times by -{time_offset:.2f}s")

                for i, seg in enumerate(segments):
                    start_time = seg['start']
                    end_time = seg['end']
                    speed = seg['speed']

                    # Adjust segment times for pre-trimmed frames
                    # Video frames start at 0.0s in the sequence, so subtract the offset
                    video_start = start_time - time_offset
                    video_end = end_time - time_offset

                    # Clamp video times to valid range (can't be negative or beyond frame duration)
                    frame_duration = input_frame_count / original_fps
                    video_start = max(0.0, video_start)
                    video_end = min(frame_duration, video_end)

                    # Skip segment if it's completely outside the frame range
                    if video_start >= video_end:
                        logger.info(f"Segment {i}: {start_time:.2f}s-{end_time:.2f}s SKIPPED (outside pre-trimmed frame range)")
                        continue

                    # Audio uses original times from source
                    audio_start = start_time
                    audio_end = end_time

                    # Calculate input frames for this segment based on adjusted video times
                    # This accounts for clipping at trim boundaries
                    segment_duration = video_end - video_start
                    segment_input_frames = int(segment_duration * original_fps)

                    if speed == 0.5:
                        # For 0.5x speed: trim segment, apply minterpolate to double frames
                        logger.info(f"Segment {i}: source {start_time:.2f}s-{end_time:.2f}s @ 0.5x speed")
                        if frames_pretrimmed:
                            logger.info(f"  → Video trim adjusted: {video_start:.2f}s-{video_end:.2f}s (frames pre-trimmed)")
                        logger.info(f"  → Input frames: {segment_input_frames}, Output frames (2x): {segment_input_frames * 2}")

                        # Get interpolation backend info
                        interpolator = get_frame_interpolator()
                        backend_info = interpolator.get_backend_info()
                        logger.info(f"  → Interpolation backend: {backend_info['backend']} (quality: {backend_info['quality_tier']})")

                        if backend_info['is_fallback']:
                            logger.info(f"  → Using minterpolate with enhanced motion compensation")
                        else:
                            logger.info(f"  → Note: RIFE available for higher quality (use pre-processing for best results)")

                        logger.info(f"  → Applying atempo=0.5 to audio for slow motion")

                        # Get the minterpolate filter with improved settings
                        minterpolate_filter = self._get_minterpolate_filter(fps * 2)

                        # Trim video using adjusted times, reset PTS, interpolate to double FPS
                        filter_parts.append(
                            f"[0:v]trim=start={video_start}:end={video_end},setpts=PTS-STARTPTS,"
                            f"{minterpolate_filter},"
                            f"setpts=PTS*2[v{i}]"
                        )

                        # Audio: trim using original source times and slow down with atempo=0.5
                        if include_audio:
                            atempo_filter = self.build_atempo_filter(speed)
                            audio_filter_parts.append(
                                f"[1:a]atrim=start={audio_start}:end={audio_end},asetpts=PTS-STARTPTS,"
                                f"{atempo_filter}[a{i}]"
                            )
                            audio_output_labels.append(f"[a{i}]")

                        expected_output_frames += segment_input_frames * 2
                        output_labels.append(f"[v{i}]")
                    else:
                        # For other speeds or normal: trim and optionally adjust PTS
                        logger.info(f"Segment {i}: source {start_time:.2f}s-{end_time:.2f}s @ {speed}x speed")
                        if frames_pretrimmed:
                            logger.info(f"  → Video trim adjusted: {video_start:.2f}s-{video_end:.2f}s (frames pre-trimmed)")
                        logger.info(f"  → Frames: {segment_input_frames}")

                        # Trim video using adjusted times
                        filter_parts.append(
                            f"[0:v]trim=start={video_start}:end={video_end},setpts=PTS-STARTPTS[v{i}]"
                        )

                        # Audio: build atempo filter for speed adjustment using original source times
                        if include_audio:
                            atempo_filter = self.build_atempo_filter(speed)
                            if atempo_filter:
                                logger.info(f"  → Applying {atempo_filter} to audio")
                                audio_filter_parts.append(
                                    f"[1:a]atrim=start={audio_start}:end={audio_end},asetpts=PTS-STARTPTS,"
                                    f"{atempo_filter}[a{i}]"
                                )
                            else:
                                # No atempo needed for 1.0x speed
                                audio_filter_parts.append(
                                    f"[1:a]atrim=start={audio_start}:end={audio_end},asetpts=PTS-STARTPTS[a{i}]"
                                )
                            audio_output_labels.append(f"[a{i}]")

                        expected_output_frames += segment_input_frames
                        output_labels.append(f"[v{i}]")

                # Concatenate all video segments
                concat_inputs = ''.join(output_labels)
                concat_filter = f'{concat_inputs}concat=n={len(segments)}:v=1:a=0'

                # Concatenate all audio segments (only if audio is included)
                audio_concat_filter = None
                if include_audio and audio_output_labels:
                    audio_concat_inputs = ''.join(audio_output_labels)
                    audio_concat_filter = f'{audio_concat_inputs}concat=n={len(audio_output_labels)}:v=0:a=1'

                # Apply frame interpolation after concatenation if needed
                if needs_interpolation:
                    logger.info("=" * 60)
                    logger.info("APPLYING FRAME INTERPOLATION AFTER SEGMENT PROCESSING")
                    logger.info("=" * 60)
                    logger.info(f"Interpolating concatenated segments from {original_fps}fps to {fps}fps")

                    # Combine video and audio filters with improved minterpolate
                    minterpolate_filter = self._get_minterpolate_filter(fps)
                    all_filters = ';'.join(filter_parts + audio_filter_parts)
                    if audio_concat_filter:
                        filter_complex = f'{all_filters};{concat_filter}[concat];[concat]{minterpolate_filter}[outv];{audio_concat_filter}[outa]'
                    else:
                        # Video only - no audio filters
                        video_filters = ';'.join(filter_parts)
                        filter_complex = f'{video_filters};{concat_filter}[concat];[concat]{minterpolate_filter}[outv]'

                    expected_output_frames = int(expected_output_frames * interpolation_ratio)
                    logger.info(f"Expected output frames after interpolation: {expected_output_frames}")
                else:
                    # Combine video and audio filters
                    if audio_concat_filter:
                        all_filters = ';'.join(filter_parts + audio_filter_parts)
                        filter_complex = f'{all_filters};{concat_filter}[outv];{audio_concat_filter}[outa]'
                    else:
                        # Video only - no audio filters
                        video_filters = ';'.join(filter_parts)
                        filter_complex = f'{video_filters};{concat_filter}[outv]'

                logger.info(f"Expected output frames: {expected_output_frames}")
                logger.info(f"Filter complex: {filter_complex}")

            # Handle trim (apply after segment processing if no segments)
            # Check if frames are already pre-trimmed during processing
            frames_pretrimmed = segment_data.get('frames_pretrimmed', False) if segment_data else False

            if trim_start > 0 or trim_end:
                if not filter_complex:
                    if frames_pretrimmed:
                        # Frames are already trimmed - only trim audio, not video
                        logger.info("=" * 60)
                        logger.info("FRAMES PRE-TRIMMED DURING PROCESSING")
                        logger.info("=" * 60)
                        logger.info(f"Video frames already trimmed to {trim_start:.2f}s-{trim_end or 'end'}s")
                        logger.info("Applying audio trim only (video trim skipped)")
                        logger.info("=" * 60)
                        # Don't set trim_filter - frames are already the right range
                        # Audio trim will be handled separately in the FFmpeg command
                        trim_filter = None
                        expected_output_frames = input_frame_count  # Use actual frame count
                    else:
                        # Normal trim - apply to both video and audio
                        if trim_end:
                            trim_filter = f"trim=start={trim_start}:end={trim_end},setpts=PTS-STARTPTS"
                            logger.info(f"Applying trim: {trim_start:.2f}s to {trim_end:.2f}s")
                        else:
                            trim_filter = f"trim=start={trim_start},setpts=PTS-STARTPTS"
                            logger.info(f"Trimming start at {trim_start:.2f}s")

                        # Recalculate expected frames for trim
                        total_duration = input_frame_count / original_fps
                        actual_end = trim_end if trim_end else total_duration
                        trimmed_duration = actual_end - trim_start
                        expected_output_frames = int(trimmed_duration * original_fps)

        # Apply frame interpolation if needed (when target FPS > source FPS and no segment processing)
        if needs_interpolation and not filter_complex and not trim_filter:
            # Add minterpolate filter for frame interpolation
            logger.info("=" * 60)
            logger.info("APPLYING FRAME INTERPOLATION FILTER")
            logger.info("=" * 60)
            logger.info(f"Interpolating {input_frame_count} frames @ {original_fps}fps → {int(input_frame_count * interpolation_ratio)} frames @ {fps}fps")

            # Get interpolation backend info and log it
            interpolator = get_frame_interpolator()
            backend_info = interpolator.get_backend_info()
            logger.info(f"Interpolation backend: {backend_info['backend']} (quality: {backend_info['quality_tier']})")

            # Create video filter with improved minterpolate settings
            minterpolate_filter = self._get_minterpolate_filter(fps)
            trim_filter = minterpolate_filter
            expected_output_frames = int(input_frame_count * interpolation_ratio)

            logger.info(f"Motion interpolation filter: {trim_filter}")
            logger.info("=" * 60)
        elif needs_interpolation and trim_filter:
            # Append minterpolate to existing trim filter
            logger.info("=" * 60)
            logger.info("APPLYING FRAME INTERPOLATION WITH TRIM")
            logger.info("=" * 60)
            logger.info(f"Combining trim and interpolation filters")

            # Get improved minterpolate settings
            minterpolate_filter = self._get_minterpolate_filter(fps)
            trim_filter = f"{trim_filter},{minterpolate_filter}"
            expected_output_frames = int(expected_output_frames * interpolation_ratio)

            logger.info(f"Combined filter: {trim_filter}")
            logger.info("=" * 60)

        logger.info(f"Expected output frame count: {expected_output_frames}")

        # Set encoding parameters based on export mode (with custom overrides)
        # OPTIMIZED: Based on A/B testing, H.264 fast preset with CRF 18 provides best speed/quality balance
        if export_mode == "fast":
            codec = self.ffmpeg_codec or "libx264"  # H.264 - faster encoding
            preset = self.ffmpeg_preset or "ultrafast"
            crf = self.ffmpeg_crf or "20"
            logger.info(f"Encoding video with FAST settings ({codec}, 1-pass, {preset} preset, CRF {crf}) at {fps} fps...")
        else:
            # OPTIMIZED: Use H.264 fast preset CRF 18 (tested to be optimal for speed without quality loss)
            codec = self.ffmpeg_codec or "libx264"  # H.264 - fast encoding
            preset = self.ffmpeg_preset or "fast"
            crf = self.ffmpeg_crf or "18"
            logger.info(f"Encoding video with QUALITY settings ({codec}, 1-pass, {preset} preset, CRF {crf}) at {fps} fps...")

        # Log if custom parameters are being used
        if self.ffmpeg_codec or self.ffmpeg_preset or self.ffmpeg_crf:
            logger.info(f"Using CUSTOM FFmpeg parameters: codec={codec}, preset={preset}, CRF={crf}")

        # Pass 1 - Analysis (only for quality mode with H.265, single-pass for H.264)
        if export_mode == "quality" and codec == "libx265":
            self._run_ffmpeg_pass1(
                frames_pattern, input_video_path, input_framerate,
                filter_complex, trim_filter, codec, preset, crf,
                expected_output_frames, progress_callback, audio_trim_params
            )
        else:
            logger.info("=" * 60)
            logger.info("Skipping pass 1 for FAST mode - using single-pass encoding")
            logger.info("=" * 60)

        # Prepare audio trim parameters if frames are pre-trimmed
        audio_trim_params = None
        if frames_pretrimmed and (trim_start > 0 or trim_end):
            audio_trim_params = {'start': trim_start, 'end': trim_end}
            logger.info(f"Audio trim params: start={trim_start:.2f}s, end={trim_end or 'end'}s")

        # Pass 2 - Encode (or single-pass for fast mode)
        self._run_ffmpeg_pass2(
            frames_pattern, input_video_path, output_path, input_framerate, fps,
            filter_complex, trim_filter, codec, preset, crf, export_mode,
            needs_interpolation, interpolation_ratio, include_audio,
            expected_output_frames, progress_callback, audio_trim_params
        )

    def _run_ffmpeg_pass1(
        self, frames_pattern, input_video_path, input_framerate,
        filter_complex, trim_filter, codec, preset, crf,
        expected_output_frames, progress_callback, audio_trim_params=None
    ):
        """Run FFmpeg pass 1 (analysis)"""
        ffmpeg_pass1_start = datetime.now()
        logger.info("=" * 60)
        logger.info(f"[EXPORT_PHASE] FFMPEG_PASS1 START - {ffmpeg_pass1_start.isoformat()}")
        logger.info("Starting pass 1 - analyzing video...")
        logger.info("=" * 60)

        cmd_pass1 = [
            'ffmpeg', '-y',
            '-framerate', str(input_framerate),
            '-i', frames_pattern,
            '-i', input_video_path
        ]

        # Add filter_complex for segment processing or simple trim filter
        if filter_complex:
            cmd_pass1.extend(['-filter_complex', filter_complex, '-map', '[outv]'])
            # Map audio from filter_complex if it has audio output, otherwise map original audio
            if '[outa]' in filter_complex:
                cmd_pass1.extend(['-map', '[outa]'])
            else:
                cmd_pass1.extend(['-map', '1:a?'])
        elif trim_filter:
            cmd_pass1.extend(['-vf', trim_filter, '-map', '0:v', '-map', '1:a?'])
        else:
            cmd_pass1.extend(['-map', '0:v', '-map', '1:a?'])

        cmd_pass1.extend([
            '-c:v', codec,
            '-preset', preset,
            '-crf', crf,
            '-x265-params', 'pass=1:vbv-maxrate=80000:vbv-bufsize=160000:aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6',
            '-an',  # No audio in pass 1
            '-f', 'null',
            '/dev/null' if os.name != 'nt' else 'NUL'
        ])

        try:
            # Use Popen to read stderr in real-time for progress monitoring
            process = subprocess.Popen(
                cmd_pass1,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True
            )

            # Read stderr line by line to track progress
            last_frame = 0
            for line in process.stderr:
                # Parse frame number from FFmpeg output
                frame_num = self.parse_ffmpeg_progress(line)
                if frame_num is not None and frame_num > last_frame:
                    last_frame = frame_num
                    # Send progress callback
                    if progress_callback:
                        progress_callback(
                            frame_num,
                            expected_output_frames,
                            f"Pass 1: Analyzing frame {frame_num}/{expected_output_frames}",
                            phase='ffmpeg_pass1'
                        )

            # Wait for process to complete
            process.wait()

            if process.returncode != 0:
                # Read any remaining output for error reporting
                _, stderr = process.communicate()
                logger.error(f"FFmpeg pass 1 failed with return code {process.returncode}")
                raise RuntimeError(f"Video encoding pass 1 failed: {stderr}")

            ffmpeg_pass1_end = datetime.now()
            ffmpeg_pass1_duration = (ffmpeg_pass1_end - ffmpeg_pass1_start).total_seconds()
            logger.info("=" * 60)
            logger.info(f"[EXPORT_PHASE] FFMPEG_PASS1 END - {ffmpeg_pass1_end.isoformat()}")
            logger.info(f"[EXPORT_PHASE] FFMPEG_PASS1 DURATION - {ffmpeg_pass1_duration:.2f} seconds")
            logger.info("Pass 1 complete!")
            logger.info("=" * 60)
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg pass 1 failed: {e.stderr}")
            raise RuntimeError(f"Video encoding pass 1 failed: {e.stderr}")
        except Exception as e:
            logger.error(f"FFmpeg pass 1 failed: {e}")
            raise RuntimeError(f"Video encoding pass 1 failed: {e}")

    def _run_ffmpeg_pass2(
        self, frames_pattern, input_video_path, output_path, input_framerate, fps,
        filter_complex, trim_filter, codec, preset, crf, export_mode,
        needs_interpolation, interpolation_ratio, include_audio,
        expected_output_frames, progress_callback, audio_trim_params=None
    ):
        """Run FFmpeg pass 2 (encoding)"""
        ffmpeg_pass2_start = datetime.now()
        logger.info("=" * 60)
        logger.info(f"[EXPORT_PHASE] FFMPEG_ENCODE START - {ffmpeg_pass2_start.isoformat()}")

        if export_mode == "quality":
            logger.info("Starting pass 2 - encoding video...")
        else:
            logger.info("Starting single-pass encoding...")

        logger.info(f"Input framerate: {input_framerate}fps")
        logger.info(f"Output framerate: {fps}fps")
        if needs_interpolation:
            logger.info(f"Frame interpolation: {interpolation_ratio:.2f}x (minterpolate active)")
        logger.info("=" * 60)

        # Build FFmpeg command based on codec
        cmd_pass2 = [
            'ffmpeg', '-y',
            '-framerate', str(input_framerate),
            '-i', frames_pattern,
            '-i', input_video_path
        ]

        # Add filter_complex for segment processing or simple trim filter
        if filter_complex:
            cmd_pass2.extend(['-filter_complex', filter_complex, '-map', '[outv]'])
            if include_audio:
                # Map audio from filter_complex if it has audio output, otherwise map original audio
                if '[outa]' in filter_complex:
                    cmd_pass2.extend(['-map', '[outa]'])
                else:
                    cmd_pass2.extend(['-map', '1:a?'])
        elif trim_filter:
            cmd_pass2.extend(['-vf', trim_filter, '-map', '0:v'])
            if include_audio:
                cmd_pass2.extend(['-map', '1:a?'])
        else:
            cmd_pass2.extend(['-map', '0:v'])
            if include_audio:
                # Check if we need to trim audio separately (for pre-trimmed frames)
                if audio_trim_params:
                    # Video frames are already trimmed, but we need to trim audio from source
                    start = audio_trim_params['start']
                    end = audio_trim_params['end']
                    if end:
                        audio_filter = f'[1:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[outa]'
                    else:
                        audio_filter = f'[1:a]atrim=start={start},asetpts=PTS-STARTPTS[outa]'
                    cmd_pass2.extend(['-filter_complex', audio_filter, '-map', '[outa]'])
                    logger.info(f"Applying audio trim filter: {audio_filter}")
                else:
                    cmd_pass2.extend(['-map', '1:a?'])

        cmd_pass2.extend([
            '-c:v', codec,
            '-preset', preset,
            '-crf', crf
        ])

        # Add codec-specific parameters
        if codec == 'libx265':
            # H.265 specific parameters
            if export_mode == "quality":
                x265_params = 'pass=2:vbv-maxrate=80000:vbv-bufsize=160000:aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6'
            else:
                x265_params = 'aq-mode=3:aq-strength=1.0:deblock=-1,-1'
            cmd_pass2.extend(['-x265-params', x265_params])
        # libx264 uses default parameters (no special params needed for fast mode)

        # Add audio encoding parameters if audio is included
        if include_audio:
            cmd_pass2.extend(['-c:a', 'aac', '-b:a', '256k'])
        else:
            cmd_pass2.extend(['-an'])  # No audio

        # Add common parameters
        cmd_pass2.extend([
            '-r', str(fps),  # Explicit output framerate - CRITICAL for frame interpolation
            '-pix_fmt', 'yuv420p',
            '-colorspace', 'bt709',
            '-color_primaries', 'bt709',
            '-color_trc', 'bt709',
            '-color_range', 'tv',
            '-movflags', '+faststart',
            str(output_path)
        ])

        try:
            # Use Popen to read stderr in real-time for progress monitoring
            process = subprocess.Popen(
                cmd_pass2,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True
            )

            # Read stderr line by line to track progress
            last_frame = 0
            for line in process.stderr:
                # Parse frame number from FFmpeg output
                frame_num = self.parse_ffmpeg_progress(line)
                if frame_num is not None and frame_num > last_frame:
                    last_frame = frame_num
                    # Send progress callback
                    if progress_callback:
                        if export_mode == "quality":
                            message = f"Pass 2: Encoding frame {frame_num}/{expected_output_frames}"
                        else:
                            message = f"Encoding frame {frame_num}/{expected_output_frames}"
                        progress_callback(
                            frame_num,
                            expected_output_frames,
                            message,
                            phase='ffmpeg_encode'
                        )

            # Wait for process to complete
            process.wait()

            if process.returncode != 0:
                # Read any remaining output for error reporting
                _, stderr = process.communicate()
                logger.error(f"FFmpeg encoding failed with return code {process.returncode}")
                raise RuntimeError(f"Video encoding failed: {stderr}")

            ffmpeg_pass2_end = datetime.now()
            ffmpeg_pass2_duration = (ffmpeg_pass2_end - ffmpeg_pass2_start).total_seconds()
            logger.info("=" * 60)
            logger.info(f"[EXPORT_PHASE] FFMPEG_ENCODE END - {ffmpeg_pass2_end.isoformat()}")
            logger.info(f"[EXPORT_PHASE] FFMPEG_ENCODE DURATION - {ffmpeg_pass2_duration:.2f} seconds")
            if export_mode == "quality":
                logger.info("Pass 2 complete! Video encoding finished.")
            else:
                logger.info("Single-pass encoding complete!")
            logger.info("=" * 60)
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg encoding failed: {e.stderr}")
            raise RuntimeError(f"Video encoding failed: {e.stderr}")
        except Exception as e:
            logger.error(f"FFmpeg encoding failed: {e}")
            raise RuntimeError(f"Video encoding failed: {e}")

    def interpolate_frames_for_slowmo(
        self,
        frames_dir: Path,
        speed: float,
        fps: float,
        progress_callback=None
    ) -> tuple[Path, bool]:
        """
        Interpolate frames for slowmo using best available backend.

        Tries backends in order: RIFE CUDA → RIFE ncnn → minterpolate fallback

        Args:
            frames_dir: Directory containing input frames
            speed: Speed multiplier (e.g., 0.5 for half speed)
            fps: Original FPS
            progress_callback: Optional callback(current, total, message, phase)

        Returns:
            Tuple of (output_frames_dir, used_rife)
            - output_frames_dir: Directory with interpolated frames (or original if fallback)
            - used_rife: True if RIFE was used, False if minterpolate should be used
        """
        # Calculate multiplier (0.5x speed = 2x frames needed)
        multiplier = int(1 / speed)

        if multiplier < 2:
            logger.info(f"Speed {speed}x doesn't require interpolation (multiplier={multiplier})")
            return frames_dir, False

        # Get the frame interpolator
        interpolator = get_frame_interpolator()
        backend = interpolator.backend

        logger.info("=" * 60)
        logger.info("SLOWMO FRAME INTERPOLATION")
        logger.info("=" * 60)
        logger.info(f"Speed: {speed}x → Frame multiplier: {multiplier}x")
        logger.info(f"Backend: {backend.value}")
        logger.info(f"Backend info: {interpolator.get_backend_info()}")

        # If minterpolate backend, signal to use FFmpeg filter instead
        if backend == InterpolationBackend.MINTERPOLATE:
            logger.info("Using FFmpeg minterpolate filter (no GPU interpolation available)")
            logger.info("=" * 60)
            return frames_dir, False

        # Create output directory for interpolated frames
        interpolated_dir = frames_dir.parent / f"{frames_dir.name}_interpolated"
        interpolated_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Input frames dir: {frames_dir}")
        logger.info(f"Output frames dir: {interpolated_dir}")

        # Wrap progress callback
        def rife_progress(current, total, message):
            if progress_callback:
                progress_callback(current, total, message, phase='rife_interpolation')

        try:
            success = interpolator.interpolate_frames(
                input_frames_dir=frames_dir,
                output_frames_dir=interpolated_dir,
                multiplier=multiplier,
                fps=fps,
                progress_callback=rife_progress
            )

            if success:
                logger.info(f"✓ RIFE interpolation complete: {multiplier}x frames generated")
                logger.info("=" * 60)
                return interpolated_dir, True
            else:
                logger.warning("RIFE interpolation returned False, falling back to minterpolate")
                # Clean up empty directory
                if interpolated_dir.exists() and not any(interpolated_dir.iterdir()):
                    interpolated_dir.rmdir()
                return frames_dir, False

        except Exception as e:
            logger.error(f"RIFE interpolation failed: {e}")
            logger.warning("Falling back to FFmpeg minterpolate")
            # Clean up on failure
            if interpolated_dir.exists():
                shutil.rmtree(interpolated_dir, ignore_errors=True)
            return frames_dir, False

    def get_interpolation_backend_info(self) -> dict:
        """Get information about the interpolation backend being used"""
        interpolator = get_frame_interpolator()
        return interpolator.get_backend_info()
