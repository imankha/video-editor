"""
Modal GPU functions for video processing.

This module handles video export processing on Modal's cloud GPUs.
No Docker required - Modal handles the environment automatically.

Architecture:
    FastAPI (Fly.io) -> <function>.remote() -> Modal GPU -> R2

Available functions:
    - render_overlay: Apply highlight overlays frame-by-frame
    - render_overlay_parallel: Parallel chunk processing using Modal .map()
    - process_framing: Crop, trim, speed changes with FFmpeg

Parallelization Strategy:
    For longer videos, we split into chunks and process each chunk on a
    separate container using Modal's .map() for true parallelism. Each chunk
    is processed independently, then concatenated. This gives ~3-4x speedup
    for videos longer than 10 seconds.
"""

import modal
import os
import tempfile
import logging
import json

# Define the Modal app
app = modal.App("reel-ballers-video")

# Define the container image with all dependencies
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")  # Added libs for OpenCV/YOLO
    .pip_install(
        "boto3",
        "opencv-python-headless",  # Headless for server use
        "numpy",
    )
)

# Separate image for YOLO detection (includes ultralytics)
yolo_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        "boto3",
        "opencv-python-headless",
        "numpy",
        "ultralytics",  # YOLOv8
        "torch",
        "torchvision",
    )
)

# Image for Real-ESRGAN AI upscaling
# Must use torch 2.1.0 + torchvision 0.16.0:
# - torchvision 0.17+ removed functional_tensor module that basicsr imports
# - numpy 1.26.4 for compatibility with torch 2.1.0
upscale_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        "boto3",
        "opencv-python-headless",
        "numpy==1.26.4",
        "torch==2.1.0",
        "torchvision==0.16.0",
        "basicsr==1.4.2",
        "realesrgan==0.3.0",
    )
)

# Cost-optimized GPU configuration thresholds
# Based on analysis: parallel has fixed startup overhead that only pays off for longer videos
# Time break-even: 1 vs 2 GPUs at ~28s, 1 vs 4 GPUs at ~19s, 1 vs 8 GPUs at ~16s
# But cost-per-time-saved favors fewer GPUs, so we use higher thresholds
GPU_CONFIG_THRESHOLDS = {
    # video_duration -> (num_chunks, description)
    30: (1, "sequential"),      # 0-30s: 1 GPU (sequential is both faster AND cheaper)
    90: (2, "2-gpu-parallel"),  # 30-90s: 2 GPUs (best cost/time ratio)
    180: (4, "4-gpu-parallel"), # 90-180s: 4 GPUs (worth extra cost for time savings)
    float('inf'): (8, "8-gpu-parallel"),  # 180s+: 8 GPUs (maximum parallelism)
}

def get_optimal_gpu_config(video_duration: float) -> tuple:
    """
    Get the cost-optimal GPU configuration for a given video duration.

    Returns:
        (num_chunks, description) - 1 means sequential, >1 means parallel
    """
    if video_duration is None:
        return (1, "sequential")  # Default to sequential if unknown

    for threshold, config in sorted(GPU_CONFIG_THRESHOLDS.items()):
        if video_duration < threshold:
            return config
    return (8, "8-gpu-parallel")  # Fallback for very long videos  # Number of parallel workers

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_r2_client():
    """Create an R2 client using environment credentials."""
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT_URL"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _has_audio_stream(video_path: str) -> bool:
    """
    Check if a video file has an audio stream using ffprobe.

    Args:
        video_path: Path to the video file

    Returns:
        True if video has at least one audio stream, False otherwise
    """
    import subprocess
    try:
        result = subprocess.run(
            [
                'ffprobe', '-v', 'error',
                '-select_streams', 'a',
                '-show_entries', 'stream=codec_type',
                '-of', 'csv=p=0',
                video_path
            ],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode != 0:
            logger.warning(f"ffprobe failed for {video_path}: {result.stderr}")
            # Assume audio exists to avoid breaking existing behavior
            return True
        # If there's any output, there's an audio stream
        has_audio = bool(result.stdout.strip())
        logger.info(f"Audio stream check for {video_path}: {has_audio}")
        return has_audio
    except Exception as e:
        logger.warning(f"Failed to check audio stream for {video_path}: {e}")
        # Assume audio exists to avoid breaking existing behavior
        return True


@app.function(
    image=image,
    gpu="T4",  # NVIDIA T4 - good balance of cost/performance
    timeout=600,  # 10 minutes max
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def render_overlay(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
) -> dict:
    """
    Apply highlight overlays to video on GPU.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2 (e.g., "a")
        input_key: R2 key for input video (relative to user folder)
        output_key: R2 key for output video (relative to user folder)
        highlight_regions: List of regions with keyframes
        effect_type: "dark_overlay" | "brightness_boost" | "original"

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    try:
        logger.info(f"[{job_id}] Starting overlay render for user {user_id}")
        logger.info(f"[{job_id}] Input: {input_key}, Output: {output_key}")
        logger.info(f"[{job_id}] Regions: {len(highlight_regions)}, Effect: {effect_type}")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download input from R2
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[{job_id}] Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Process overlay
            output_path = os.path.join(temp_dir, "output.mp4")
            _process_overlay(job_id, input_path, output_path, {
                "highlight_regions": highlight_regions,
                "effect_type": effect_type,
            })

            # Upload result to R2
            full_output_key = f"{user_id}/{output_key}"
            logger.info(f"[{job_id}] Uploading to {full_output_key}")
            r2.upload_file(
                output_path,
                bucket,
                full_output_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )

            logger.info(f"[{job_id}] Overlay render complete")
            return {"status": "success", "output_key": output_key}

    except Exception as e:
        logger.error(f"[{job_id}] Overlay render failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.function(
    image=image,
    gpu="T4",
    timeout=300,  # Shorter timeout for chunks
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_overlay_chunk(
    job_id: str,
    chunk_index: int,
    total_chunks: int,
    user_id: str,
    input_key: str,  # R2 key for input video
    output_chunk_key: str,  # R2 key for chunk output
    start_frame: int,
    end_frame: int,
    fps: float,
    width: int,
    height: int,
    highlight_regions: list,
    effect_type: str,
) -> dict:
    """
    Process a single chunk of video with overlay effects.

    This function is designed to be called via Modal .map() for parallel processing.
    Each container downloads the input, seeks to its chunk, processes, and uploads.

    Args:
        job_id: Job identifier for logging
        chunk_index: Which chunk this is (0-indexed)
        total_chunks: Total number of chunks
        user_id: User folder in R2
        input_key: R2 key for input video
        output_chunk_key: R2 key for this chunk's output
        start_frame: First frame to process (inclusive)
        end_frame: Last frame to process (exclusive)
        fps: Video frame rate
        width/height: Video dimensions
        highlight_regions: Highlight regions with keyframes
        effect_type: Effect type for highlights

    Returns:
        {"status": "success", "chunk_key": "...", "frames_processed": N}
    """
    import subprocess
    import cv2
    import numpy as np

    logger.info(f"[{job_id}] Chunk {chunk_index+1}/{total_chunks}: frames {start_frame}-{end_frame}")

    try:
        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download input from R2
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[{job_id}] Chunk {chunk_index+1}: Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Open video and seek to start frame
            cap = cv2.VideoCapture(input_path)
            if not cap.isOpened():
                raise ValueError(f"Could not open video: {input_path}")

            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

            # Sort regions by start time
            sorted_regions = sorted(highlight_regions, key=lambda r: r["start_time"])

            # Start FFmpeg for this chunk (no audio - orchestrator handles audio)
            output_path = os.path.join(temp_dir, "chunk.mp4")
            ffmpeg_cmd = [
                "ffmpeg", "-y",
                "-f", "rawvideo",
                "-pix_fmt", "bgr24",
                "-s", f"{width}x{height}",
                "-r", str(fps),
                "-i", "pipe:0",
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",  # Required for compatibility
                "-preset", "fast",
                "-crf", "23",
                output_path,
            ]

            ffmpeg_proc = subprocess.Popen(
                ffmpeg_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            frames_processed = 0
            write_error = None

            try:
                for frame_idx in range(start_frame, end_frame):
                    ret, frame = cap.read()
                    if not ret:
                        break

                    current_time = frame_idx / fps

                    # Find active region for this frame
                    active_region = None
                    for region in sorted_regions:
                        if region["start_time"] <= current_time <= region["end_time"]:
                            active_region = region
                            break

                    # Render highlight if in a region
                    if active_region:
                        frame = _render_highlight(frame, active_region, current_time, effect_type)

                    # Write frame
                    try:
                        if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                            ffmpeg_proc.stdin.write(frame.tobytes())
                            ffmpeg_proc.stdin.flush()
                        else:
                            write_error = "FFmpeg stdin closed"
                            break
                    except (BrokenPipeError, OSError) as e:
                        write_error = str(e)
                        break

                    frames_processed += 1

            finally:
                cap.release()
                try:
                    if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                        ffmpeg_proc.stdin.close()
                except:
                    pass

            ffmpeg_proc.wait()

            if ffmpeg_proc.returncode != 0:
                stderr = ffmpeg_proc.stderr.read().decode() if ffmpeg_proc.stderr else ""
                raise RuntimeError(f"FFmpeg failed: {stderr[:300]}")

            if write_error:
                raise RuntimeError(f"Write error: {write_error}")

            # Upload chunk to R2
            full_output_key = f"{user_id}/{output_chunk_key}"
            logger.info(f"[{job_id}] Chunk {chunk_index+1}: Uploading to {full_output_key}")
            r2.upload_file(
                output_path,
                bucket,
                full_output_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )

            logger.info(f"[{job_id}] Chunk {chunk_index+1} complete: {frames_processed} frames")
            return {
                "status": "success",
                "chunk_key": output_chunk_key,
                "frames_processed": frames_processed,
                "chunk_index": chunk_index,
            }

    except Exception as e:
        logger.error(f"[{job_id}] Chunk {chunk_index+1} failed: {e}")
        return {"status": "error", "error": str(e), "chunk_index": chunk_index}


@app.function(
    image=image,
    # NO GPU - orchestrator only does I/O and coordination, saves ~40% cost
    timeout=600,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def render_overlay_parallel(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
    num_chunks: int = 4,
) -> dict:
    """
    Process overlay using parallel chunk processing (CPU orchestrator).

    This function runs on CPU only - it coordinates GPU workers via .map().
    Splits video into chunks, processes each in parallel on separate GPUs,
    then concatenates results.

    Cost optimization:
        - Orchestrator: CPU only (no GPU cost while waiting)
        - Workers: GPU only for actual processing
        - Saves ~40% vs GPU orchestrator

    Architecture:
        1. Orchestrator (CPU) downloads input to get video metadata
        2. Creates chunk configs with R2 keys
        3. Calls process_overlay_chunk.map() - each runs on separate GPU
        4. Orchestrator downloads chunks from R2 -> concatenates -> uploads final

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for input video
        output_key: R2 key for output video
        highlight_regions: List of regions with keyframes
        effect_type: Effect type for highlights
        num_chunks: Number of parallel GPU workers (2, 4, or 8)

    Returns:
        {"status": "success", "output_key": "...", "parallel": True, "chunks": N}
    """
    import subprocess
    import cv2

    try:
        logger.info(f"[{job_id}] Starting PARALLEL overlay render ({num_chunks} chunks)")
        logger.info(f"[{job_id}] Input: {input_key}, Output: {output_key}")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download input from R2 to get video metadata
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[{job_id}] Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Get video info
            cap = cv2.VideoCapture(input_path)
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cap.release()

            logger.info(f"[{job_id}] Video: {width}x{height} @ {fps}fps, {frame_count} frames")

            # Calculate chunk boundaries and create R2 keys for each chunk
            frames_per_chunk = frame_count // num_chunks
            chunk_configs = []

            # Generate unique chunk keys in R2 temp folder
            chunk_folder = f"temp/parallel_{job_id}"

            for i in range(num_chunks):
                start_frame = i * frames_per_chunk
                end_frame = (i + 1) * frames_per_chunk if i < num_chunks - 1 else frame_count
                # R2 key for this chunk's output (relative to user folder)
                chunk_output_key = f"{chunk_folder}/chunk_{i}.mp4"

                chunk_configs.append({
                    "job_id": job_id,
                    "chunk_index": i,
                    "total_chunks": num_chunks,
                    "user_id": user_id,
                    "input_key": input_key,  # R2 key, not local path
                    "output_chunk_key": chunk_output_key,  # R2 key for chunk output
                    "start_frame": start_frame,
                    "end_frame": end_frame,
                    "fps": fps,
                    "width": width,
                    "height": height,
                    "highlight_regions": highlight_regions,
                    "effect_type": effect_type,
                })

            logger.info(f"[{job_id}] Processing {num_chunks} chunks in parallel via Modal .map()...")

            # Process chunks in parallel using Modal .map()
            # Each call runs on a SEPARATE container - they share nothing locally
            # Workers download from R2, process, upload chunk back to R2
            chunk_results = list(process_overlay_chunk.map(
                [c["job_id"] for c in chunk_configs],
                [c["chunk_index"] for c in chunk_configs],
                [c["total_chunks"] for c in chunk_configs],
                [c["user_id"] for c in chunk_configs],
                [c["input_key"] for c in chunk_configs],
                [c["output_chunk_key"] for c in chunk_configs],
                [c["start_frame"] for c in chunk_configs],
                [c["end_frame"] for c in chunk_configs],
                [c["fps"] for c in chunk_configs],
                [c["width"] for c in chunk_configs],
                [c["height"] for c in chunk_configs],
                [c["highlight_regions"] for c in chunk_configs],
                [c["effect_type"] for c in chunk_configs],
            ))

            # Check for errors
            for result in chunk_results:
                if result.get("status") != "success":
                    raise RuntimeError(f"Chunk {result.get('chunk_index')} failed: {result.get('error')}")

            total_frames = sum(r.get("frames_processed", 0) for r in chunk_results)
            logger.info(f"[{job_id}] All chunks complete, {total_frames} frames total")

            # Download processed chunks from R2 for concatenation
            logger.info(f"[{job_id}] Downloading processed chunks from R2...")
            for i, config in enumerate(chunk_configs):
                chunk_local_path = os.path.join(temp_dir, f"chunk_{i}.mp4")
                full_chunk_key = f"{user_id}/{config['output_chunk_key']}"
                r2.download_file(bucket, full_chunk_key, chunk_local_path)
                logger.info(f"[{job_id}] Downloaded chunk {i+1}/{num_chunks}")

            # Concatenate chunks with FFmpeg
            concat_list_path = os.path.join(temp_dir, "concat.txt")
            with open(concat_list_path, "w") as f:
                for i in range(num_chunks):
                    f.write(f"file 'chunk_{i}.mp4'\n")

            output_path = os.path.join(temp_dir, "output.mp4")

            # Concatenate video chunks and add audio from original
            concat_cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_list_path,
                "-i", input_path,  # Original for audio
                "-map", "0:v",  # Video from concatenated chunks
                "-map", "1:a?",  # Audio from original (if present)
                "-c:v", "copy",  # No re-encoding needed
                "-c:a", "aac",
                "-b:a", "192k",
                "-movflags", "+faststart",  # Better streaming/loading
                "-shortest",
                output_path,
            ]

            logger.info(f"[{job_id}] Concatenating chunks with audio...")
            result = subprocess.run(concat_cmd, capture_output=True, text=True)

            if result.returncode != 0:
                raise RuntimeError(f"Concat failed: {result.stderr[:300]}")

            # Upload final result to R2
            full_output_key = f"{user_id}/{output_key}"
            logger.info(f"[{job_id}] Uploading final output to {full_output_key}")
            r2.upload_file(
                output_path,
                bucket,
                full_output_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )

            # Clean up temp chunks from R2
            logger.info(f"[{job_id}] Cleaning up temp chunks from R2...")
            for config in chunk_configs:
                try:
                    full_chunk_key = f"{user_id}/{config['output_chunk_key']}"
                    r2.delete_object(Bucket=bucket, Key=full_chunk_key)
                except Exception as e:
                    logger.warning(f"[{job_id}] Failed to delete temp chunk: {e}")

            logger.info(f"[{job_id}] Parallel overlay render complete")
            return {
                "status": "success",
                "output_key": output_key,
                "parallel": True,
                "chunks": num_chunks,
                "total_frames": total_frames,
            }

    except Exception as e:
        logger.error(f"[{job_id}] Parallel overlay render failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.function(
    image=image,
    gpu="T4",
    timeout=600,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing(
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
    Process framing export (crop, trim, speed) on GPU.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2 (e.g., "a")
        input_key: R2 key for input video (relative to user folder)
        output_key: R2 key for output video (relative to user folder)
        keyframes: Crop keyframes [{time, x, y, width, height}, ...]
        output_width: Target width (default 1080)
        output_height: Target height (default 1920)
        fps: Target frame rate (default 30)
        segment_data: Optional trim/speed data

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    try:
        logger.info(f"[{job_id}] Starting framing export for user {user_id}")
        logger.info(f"[{job_id}] Input: {input_key}, Output: {output_key}")
        logger.info(f"[{job_id}] Keyframes: {len(keyframes)}, Output: {output_width}x{output_height}")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download input from R2
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[{job_id}] Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Process framing
            output_path = os.path.join(temp_dir, "output.mp4")
            _do_framing(job_id, input_path, output_path, {
                "keyframes": keyframes,
                "output_width": output_width,
                "output_height": output_height,
                "fps": fps,
                "segment_data": segment_data,
            })

            # Upload result to R2
            full_output_key = f"{user_id}/{output_key}"
            logger.info(f"[{job_id}] Uploading to {full_output_key}")
            r2.upload_file(
                output_path,
                bucket,
                full_output_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )

            logger.info(f"[{job_id}] Framing export complete")
            return {"status": "success", "output_key": output_key}

    except Exception as e:
        logger.error(f"[{job_id}] Framing export failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


def _do_framing(job_id: str, input_path: str, output_path: str, params: dict):
    """
    Process framing export with FFmpeg.

    Handles:
    - Crop keyframes (interpolated crop region)
    - Trim (start/end times)
    - Speed changes
    - Output scaling to target resolution

    Note: This is FFmpeg-only processing. For AI upscaling, use the local backend.
    """
    import subprocess

    # Extract parameters
    keyframes = params.get("keyframes", [])
    output_width = params.get("output_width", 1080)
    output_height = params.get("output_height", 1920)
    fps = params.get("fps", 30)
    segment_data = params.get("segment_data")

    # Build filter chain
    filters = []

    # Handle trim range from segment_data
    input_args = ["-i", input_path]
    if segment_data:
        trim_range = segment_data.get("trimRange")
        if trim_range:
            start_time = trim_range.get("start", 0)
            end_time = trim_range.get("end")
            if start_time > 0:
                input_args = ["-ss", str(start_time)] + input_args
            if end_time:
                input_args = input_args + ["-to", str(end_time - start_time)]

    # Crop filter (use average of keyframes for now - full interpolation would need complex filter)
    if keyframes:
        avg_x = sum(kf["x"] for kf in keyframes) / len(keyframes)
        avg_y = sum(kf["y"] for kf in keyframes) / len(keyframes)
        avg_width = sum(kf["width"] for kf in keyframes) / len(keyframes)
        avg_height = sum(kf["height"] for kf in keyframes) / len(keyframes)
        filters.append(f"crop={int(avg_width)}:{int(avg_height)}:{int(avg_x)}:{int(avg_y)}")

    # Scale to output resolution
    filters.append(f"scale={output_width}:{output_height}")

    # Set frame rate
    filters.append(f"fps={fps}")

    # Handle speed changes from segment_data
    if segment_data:
        segments = segment_data.get("segments", [])
        # For now, use first segment's speed (full multi-segment would need concat)
        for seg in segments:
            if seg.get("speed", 1.0) != 1.0:
                speed = seg["speed"]
                # setpts for video, atempo for audio
                filters.append(f"setpts={1/speed}*PTS")
                break

    # Build FFmpeg command
    filter_str = ",".join(filters) if filters else "null"

    cmd = ["ffmpeg", "-y"]
    cmd.extend(input_args)
    cmd.extend([
        "-vf", filter_str,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",  # Required for Windows Media Player compatibility
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        output_path,
    ])

    logger.info(f"[{job_id}] Running FFmpeg: {' '.join(cmd[:15])}...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr[:500]}")

    logger.info(f"[{job_id}] Framing export complete")


def _process_overlay(job_id: str, input_path: str, output_path: str, params: dict):
    """
    Process overlay export - apply highlight overlays to video.

    Uses frame-by-frame processing with OpenCV, piped directly to FFmpeg.
    """
    import subprocess
    import cv2
    import numpy as np

    highlight_regions = params.get("highlight_regions", [])
    effect_type = params.get("effect_type", "dark_overlay")

    # If no highlights, just copy the video
    if not highlight_regions:
        logger.info(f"[{job_id}] No highlights - copying video")
        cmd = ["ffmpeg", "-y", "-i", input_path, "-c", "copy", output_path]
        subprocess.run(cmd, check=True)
        return

    # Open video
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    logger.info(f"[{job_id}] Video: {width}x{height} @ {fps}fps, {frame_count} frames")

    # Sort regions by start time
    sorted_regions = sorted(highlight_regions, key=lambda r: r["start_time"])

    # Start FFmpeg process
    # Note: -pix_fmt yuv420p is REQUIRED for broad compatibility (Windows Media Player, etc.)
    # -movflags +faststart moves moov atom to start for better streaming
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-i", "pipe:0",
        "-i", input_path,
        "-map", "0:v",
        "-map", "1:a?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",  # Required for Windows Media Player compatibility
        "-preset", "fast",
        "-crf", "23",
        "-movflags", "+faststart",  # Faster streaming/loading
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        output_path,
    ]

    logger.info(f"[{job_id}] Starting FFmpeg: {' '.join(ffmpeg_cmd[:10])}...")

    ffmpeg_proc = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    frame_idx = 0
    write_error = None

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current_time = frame_idx / fps

            # Find active region for this frame
            active_region = None
            for region in sorted_regions:
                if region["start_time"] <= current_time <= region["end_time"]:
                    active_region = region
                    break

            # Render highlight if in a region
            if active_region:
                frame = _render_highlight(
                    frame, active_region, current_time, effect_type
                )

            # Write frame to FFmpeg - check if pipe is still open
            try:
                if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                    ffmpeg_proc.stdin.write(frame.tobytes())
                    ffmpeg_proc.stdin.flush()  # Ensure data is sent
                else:
                    write_error = "FFmpeg stdin closed unexpectedly"
                    break
            except (BrokenPipeError, OSError) as e:
                write_error = f"Pipe error at frame {frame_idx}: {e}"
                break

            frame_idx += 1

            # Log progress every 100 frames
            if frame_idx % 100 == 0:
                progress = int((frame_idx / frame_count) * 100)
                logger.info(f"[{job_id}] Progress: {progress}% ({frame_idx}/{frame_count})")

    finally:
        cap.release()
        # Close stdin safely to signal EOF to FFmpeg
        try:
            if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                ffmpeg_proc.stdin.close()
        except Exception as e:
            logger.warning(f"[{job_id}] Error closing stdin: {e}")

    # Wait for FFmpeg to finish (don't use communicate() since stdin is already closed)
    ffmpeg_proc.wait()

    # Read stderr for error reporting
    stderr_text = ""
    try:
        if ffmpeg_proc.stderr:
            stderr_text = ffmpeg_proc.stderr.read().decode() if ffmpeg_proc.stderr else ""
    except Exception as e:
        logger.warning(f"[{job_id}] Error reading stderr: {e}")

    if ffmpeg_proc.returncode != 0:
        logger.error(f"[{job_id}] FFmpeg stderr: {stderr_text[:1000]}")
        raise RuntimeError(f"FFmpeg encoding failed (code {ffmpeg_proc.returncode}): {stderr_text[:500]}")

    if write_error:
        logger.error(f"[{job_id}] FFmpeg stderr: {stderr_text[:1000]}")
        raise RuntimeError(f"Frame writing failed: {write_error}")

    logger.info(f"[{job_id}] Overlay export complete: {frame_idx} frames")


def _render_highlight(frame, region: dict, current_time: float, effect_type: str):
    """
    Render highlight overlay on a single frame.

    Interpolates between keyframes and applies the specified effect.
    """
    import cv2
    import numpy as np

    keyframes = region.get("keyframes", [])
    if not keyframes:
        return frame

    # Find surrounding keyframes for interpolation
    kf_before = None
    kf_after = None

    for kf in keyframes:
        if kf["time"] <= current_time:
            kf_before = kf
        if kf["time"] >= current_time and kf_after is None:
            kf_after = kf

    if kf_before is None and kf_after is None:
        return frame

    # Use nearest keyframe if at boundary
    if kf_before is None:
        kf_before = kf_after
    if kf_after is None:
        kf_after = kf_before

    # Interpolate between keyframes
    if kf_before["time"] == kf_after["time"]:
        t = 0
    else:
        t = (current_time - kf_before["time"]) / (kf_after["time"] - kf_before["time"])

    def lerp(a, b, t):
        return a + (b - a) * t

    x = lerp(kf_before["x"], kf_after["x"], t)
    y = lerp(kf_before["y"], kf_after["y"], t)
    radiusX = lerp(kf_before["radiusX"], kf_after["radiusX"], t)
    radiusY = lerp(kf_before["radiusY"], kf_after["radiusY"], t)
    opacity = lerp(kf_before.get("opacity", 0.15), kf_after.get("opacity", 0.15), t)

    height, width = frame.shape[:2]

    # Create mask for ellipse
    mask = np.zeros((height, width), dtype=np.uint8)
    center = (int(x), int(y))
    axes = (int(radiusX), int(radiusY))
    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)

    # Apply effect
    if effect_type == "dark_overlay":
        # Dim everything outside the highlight
        darkened = (frame * (1 - opacity)).astype(np.uint8)
        frame = np.where(mask[:, :, np.newaxis] > 0, frame, darkened)
    elif effect_type == "brightness_boost":
        # Brighten inside the highlight
        brightened = np.clip(frame.astype(np.float32) * (1 + opacity), 0, 255).astype(np.uint8)
        frame = np.where(mask[:, :, np.newaxis] > 0, brightened, frame)
    # effect_type == "original" - no modification

    return frame


# ============================================================================
# YOLO Detection Functions
# ============================================================================

# YOLO class IDs
PERSON_CLASS_ID = 0

# Cached YOLO model (per-container)
_yolo_model = None


def _get_yolo_model():
    """Load YOLO model (cached per container)."""
    global _yolo_model
    if _yolo_model is None:
        from ultralytics import YOLO
        logger.info("Loading YOLOv8x model...")
        _yolo_model = YOLO("yolov8x.pt")  # Auto-downloads if needed
        logger.info("YOLO model loaded successfully")
    return _yolo_model


@app.function(
    image=yolo_image,
    gpu="T4",
    timeout=120,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def detect_players_modal(
    user_id: str,
    input_key: str,
    frame_number: int,
    confidence_threshold: float = 0.5,
) -> dict:
    """
    Detect players (persons) in a single video frame on GPU.

    Args:
        user_id: User folder in R2
        input_key: R2 key for input video
        frame_number: Frame number to analyze
        confidence_threshold: Minimum confidence for detections

    Returns:
        {
            "status": "success",
            "detections": [{"bbox": {...}, "confidence": float, "class_name": "person"}],
            "video_width": int,
            "video_height": int
        }
    """
    import cv2

    try:
        logger.info(f"[Detection] Player detection for frame {frame_number}")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download video from R2
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[Detection] Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Extract frame
            cap = cv2.VideoCapture(input_path)
            if not cap.isOpened():
                raise ValueError(f"Could not open video: {input_path}")

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            if frame_number < 0 or frame_number >= total_frames:
                raise ValueError(f"Frame {frame_number} out of range (0-{total_frames-1})")

            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ret, frame = cap.read()
            cap.release()

            if not ret or frame is None:
                raise ValueError(f"Failed to read frame {frame_number}")

            # Run YOLO detection
            model = _get_yolo_model()
            results = model(frame, verbose=False, conf=confidence_threshold)

            # Process results - filter for person class only
            detections = []
            for result in results:
                boxes = result.boxes
                if boxes is None:
                    continue

                for box in boxes:
                    class_id = int(box.cls[0])
                    if class_id != PERSON_CLASS_ID:
                        continue

                    conf = float(box.conf[0])
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    center_x = (x1 + x2) / 2
                    center_y = (y1 + y2) / 2
                    box_width = x2 - x1
                    box_height = y2 - y1

                    detections.append({
                        "bbox": {
                            "x": center_x,
                            "y": center_y,
                            "width": box_width,
                            "height": box_height
                        },
                        "confidence": conf,
                        "class_name": "person",
                        "class_id": class_id
                    })

            # Sort by confidence (highest first)
            detections.sort(key=lambda d: d["confidence"], reverse=True)

            logger.info(f"[Detection] Found {len(detections)} players")

            return {
                "status": "success",
                "frame_number": frame_number,
                "detections": detections,
                "video_width": width,
                "video_height": height
            }

    except Exception as e:
        logger.error(f"[Detection] Player detection failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


# ============================================================================
# Real-ESRGAN AI Upscaling Functions
# ============================================================================

# Cached Real-ESRGAN upsampler (per-container)
_realesrgan_model = None


def _get_realesrgan_model():
    """Load Real-ESRGAN model (cached per container)."""
    global _realesrgan_model
    if _realesrgan_model is None:
        from realesrgan import RealESRGANer
        from realesrgan.archs.srvgg_arch import SRVGGNetCompact
        import torch

        logger.info("Loading Real-ESRGAN model (realesr-general-x4v3)...")

        # Model architecture for realesr-general-x4v3
        # Note: This model uses SRVGGNetCompact, NOT RRDBNet
        # RRDBNet is used by RealESRGAN_x4plus.pth
        model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type='prelu')

        # Initialize upsampler - model will be auto-downloaded
        _realesrgan_model = RealESRGANer(
            scale=4,
            model_path="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
            dni_weight=None,
            model=model,
            tile=0,  # No tiling for GPU with enough VRAM
            tile_pad=10,
            pre_pad=0,
            half=True,  # Use FP16 for faster processing
            device='cuda' if torch.cuda.is_available() else 'cpu',
        )
        logger.info("Real-ESRGAN model loaded successfully")
    return _realesrgan_model


def _interpolate_crop(keyframes: list, time: float) -> dict:
    """Interpolate crop position at a given time."""
    if not keyframes:
        return None

    # Sort keyframes by time
    sorted_kf = sorted(keyframes, key=lambda k: k['time'])

    # Before first keyframe - use first
    if time <= sorted_kf[0]['time']:
        return sorted_kf[0].copy()

    # After last keyframe - use last
    if time >= sorted_kf[-1]['time']:
        return sorted_kf[-1].copy()

    # Find surrounding keyframes
    for i in range(len(sorted_kf) - 1):
        kf1 = sorted_kf[i]
        kf2 = sorted_kf[i + 1]

        if kf1['time'] <= time <= kf2['time']:
            # Linear interpolation
            t = (time - kf1['time']) / (kf2['time'] - kf1['time'])
            return {
                'time': time,
                'x': kf1['x'] + t * (kf2['x'] - kf1['x']),
                'y': kf1['y'] + t * (kf2['y'] - kf1['y']),
                'width': kf1['width'] + t * (kf2['width'] - kf1['width']),
                'height': kf1['height'] + t * (kf2['height'] - kf1['height']),
            }

    return sorted_kf[-1].copy()


@app.function(
    image=upscale_image,
    gpu="T4",
    timeout=1800,  # 30 minutes for longer videos
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai(
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
    Process video with AI upscaling using Real-ESRGAN on GPU.

    This function:
    1. Downloads video from R2
    2. Applies crop keyframe interpolation
    3. Upscales each frame with Real-ESRGAN
    4. Encodes to final video
    5. Uploads to R2

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for source video
        output_key: R2 key for output video
        keyframes: Crop keyframes [{time, x, y, width, height}, ...]
        output_width: Target width (default 810 for 9:16)
        output_height: Target height (default 1440)
        fps: Target frame rate
        segment_data: Optional trim/speed data

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    import cv2
    import subprocess
    import numpy as np

    try:
        logger.info(f"[{job_id}] Starting AI upscaling for user {user_id}")
        logger.info(f"[{job_id}] Input: {input_key}, Output: {output_key}")
        logger.info(f"[{job_id}] Target: {output_width}x{output_height} @ {fps}fps")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download input from R2
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[{job_id}] Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Get video properties
            cap = cv2.VideoCapture(input_path)
            if not cap.isOpened():
                raise ValueError("Could not open video file")

            original_fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            duration = total_frames / original_fps

            logger.info(f"[{job_id}] Source: {original_width}x{original_height} @ {original_fps:.2f}fps, {total_frames} frames")

            # Calculate trim range
            start_frame = 0
            end_frame = total_frames
            if segment_data:
                if 'trim_start' in segment_data:
                    start_frame = int(segment_data['trim_start'] * original_fps)
                if 'trim_end' in segment_data:
                    end_frame = min(int(segment_data['trim_end'] * original_fps), total_frames)

            frames_to_process = end_frame - start_frame
            logger.info(f"[{job_id}] Processing frames {start_frame}-{end_frame} ({frames_to_process} frames)")

            # Sort keyframes
            sorted_keyframes = sorted(keyframes, key=lambda k: k['time'])

            # Load Real-ESRGAN model
            upsampler = _get_realesrgan_model()

            # Create frames directory
            frames_dir = os.path.join(temp_dir, "frames")
            os.makedirs(frames_dir, exist_ok=True)

            # Process frames
            output_frame_idx = 0
            for frame_idx in range(start_frame, end_frame):
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
                ret, frame = cap.read()
                if not ret or frame is None:
                    logger.warning(f"[{job_id}] Could not read frame {frame_idx}")
                    continue

                # Get interpolated crop for this time
                time = frame_idx / original_fps
                crop = _interpolate_crop(sorted_keyframes, time)

                if crop:
                    # Apply crop
                    x = int(max(0, crop['x']))
                    y = int(max(0, crop['y']))
                    w = int(crop['width'])
                    h = int(crop['height'])

                    # Ensure bounds
                    x = min(x, original_width - 1)
                    y = min(y, original_height - 1)
                    w = min(w, original_width - x)
                    h = min(h, original_height - y)

                    cropped = frame[y:y+h, x:x+w]
                else:
                    cropped = frame

                # AI upscale with Real-ESRGAN
                try:
                    upscaled, _ = upsampler.enhance(cropped, outscale=4)
                except Exception as e:
                    logger.warning(f"[{job_id}] Upscale failed for frame {frame_idx}: {e}, using resize")
                    upscaled = cv2.resize(cropped, (output_width, output_height), interpolation=cv2.INTER_LANCZOS4)

                # Resize to target resolution (Real-ESRGAN outputs 4x, may need adjustment)
                if upscaled.shape[1] != output_width or upscaled.shape[0] != output_height:
                    upscaled = cv2.resize(upscaled, (output_width, output_height), interpolation=cv2.INTER_LANCZOS4)

                # Save frame
                frame_path = os.path.join(frames_dir, f"frame_{output_frame_idx:06d}.png")
                cv2.imwrite(frame_path, upscaled)

                output_frame_idx += 1

                # Log progress
                if output_frame_idx % 30 == 0:
                    progress = int(output_frame_idx / frames_to_process * 100)
                    logger.info(f"[{job_id}] Progress: {progress}% ({output_frame_idx}/{frames_to_process})")

            cap.release()

            logger.info(f"[{job_id}] Processed {output_frame_idx} frames, encoding video...")

            # Encode video with FFmpeg
            output_path = os.path.join(temp_dir, "output.mp4")

            # Check if source video has audio
            has_audio = _has_audio_stream(input_path)

            # Check for segment speed changes
            segments = segment_data.get('segments', []) if segment_data else []
            has_speed_changes = any(seg.get('speed', 1.0) != 1.0 for seg in segments)

            # Build FFmpeg command
            if has_speed_changes and segments:
                # Build complex filtergraph for segment-based speed changes
                logger.info(f"[{job_id}] Applying segment speed changes: {segments}")

                filter_parts = []
                audio_filter_parts = []
                output_labels = []
                audio_labels = []

                # Calculate the time offset in the output frame sequence
                # Frames start at 0, but segment times reference source video times
                trim_offset = segment_data.get('trim_start', 0) if segment_data else 0

                for i, seg in enumerate(segments):
                    seg_start = seg['start'] - trim_offset
                    seg_end = seg['end'] - trim_offset
                    speed = seg.get('speed', 1.0)

                    # Clamp to valid frame range (in output time)
                    seg_start = max(0, seg_start)
                    seg_end = min(output_frame_idx / fps, seg_end)

                    if seg_end <= seg_start:
                        continue

                    logger.info(f"[{job_id}] Segment {i}: {seg_start:.2f}s-{seg_end:.2f}s @ {speed}x")

                    # Video: apply setpts for speed change
                    if speed != 1.0:
                        filter_parts.append(
                            f"[0:v]trim=start={seg_start}:end={seg_end},setpts=(PTS-STARTPTS)/{speed}[v{i}]"
                        )
                    else:
                        filter_parts.append(
                            f"[0:v]trim=start={seg_start}:end={seg_end},setpts=PTS-STARTPTS[v{i}]"
                        )
                    output_labels.append(f"[v{i}]")

                    # Audio: apply atempo for speed change (from source input) - only if source has audio
                    if has_audio:
                        audio_start = seg['start']
                        audio_end = seg['end']
                        if speed != 1.0:
                            # atempo supports 0.5-2.0, chain for extreme values
                            atempo_val = max(0.5, min(2.0, speed))
                            audio_filter_parts.append(
                                f"[1:a]atrim=start={audio_start}:end={audio_end},asetpts=PTS-STARTPTS,atempo={atempo_val}[a{i}]"
                            )
                        else:
                            audio_filter_parts.append(
                                f"[1:a]atrim=start={audio_start}:end={audio_end},asetpts=PTS-STARTPTS[a{i}]"
                            )
                        audio_labels.append(f"[a{i}]")

                # Concatenate all segments
                if len(output_labels) > 0:
                    v_concat = ''.join(output_labels)

                    if has_audio and audio_filter_parts:
                        # With audio: complex filter for both video and audio
                        a_concat = ''.join(audio_labels)
                        all_filters = ';'.join(filter_parts + audio_filter_parts)
                        filter_complex = f"{all_filters};{v_concat}concat=n={len(output_labels)}:v=1:a=0[outv];{a_concat}concat=n={len(audio_labels)}:v=0:a=1[outa]"

                        cmd = [
                            "ffmpeg", "-y",
                            "-framerate", str(fps),
                            "-i", os.path.join(frames_dir, "frame_%06d.png"),
                            "-i", input_path,  # For audio
                            "-filter_complex", filter_complex,
                            "-map", "[outv]",
                            "-map", "[outa]",
                            "-c:v", "libx264",
                            "-pix_fmt", "yuv420p",
                            "-preset", "fast",
                            "-crf", "23",
                            "-c:a", "aac",
                            "-b:a", "192k",
                            "-movflags", "+faststart",
                            output_path,
                        ]
                    else:
                        # No audio: video-only filter
                        logger.info(f"[{job_id}] Source has no audio - using video-only encoding")
                        all_filters = ';'.join(filter_parts)
                        filter_complex = f"{all_filters};{v_concat}concat=n={len(output_labels)}:v=1:a=0[outv]"

                        cmd = [
                            "ffmpeg", "-y",
                            "-framerate", str(fps),
                            "-i", os.path.join(frames_dir, "frame_%06d.png"),
                            "-filter_complex", filter_complex,
                            "-map", "[outv]",
                            "-c:v", "libx264",
                            "-pix_fmt", "yuv420p",
                            "-preset", "fast",
                            "-crf", "23",
                            "-movflags", "+faststart",
                            output_path,
                        ]
                else:
                    # Fallback to simple encoding
                    cmd = [
                        "ffmpeg", "-y",
                        "-framerate", str(fps),
                        "-i", os.path.join(frames_dir, "frame_%06d.png"),
                        "-i", input_path,
                        "-map", "0:v",
                        "-map", "1:a?",
                        "-c:v", "libx264",
                        "-pix_fmt", "yuv420p",
                        "-preset", "fast",
                        "-crf", "23",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-movflags", "+faststart",
                        "-shortest",
                        output_path,
                    ]
            else:
                # No speed changes - simple encoding
                cmd = [
                    "ffmpeg", "-y",
                    "-framerate", str(fps),
                    "-i", os.path.join(frames_dir, "frame_%06d.png"),
                    "-i", input_path,  # For audio
                    "-map", "0:v",
                    "-map", "1:a?",
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-preset", "fast",
                    "-crf", "23",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-movflags", "+faststart",
                    "-shortest",
                    output_path,
                ]

            # Log the FFmpeg command for debugging
            logger.info(f"[{job_id}] FFmpeg command: {' '.join(cmd[:10])}... (truncated)")
            if "-filter_complex" in cmd:
                fc_idx = cmd.index("-filter_complex")
                logger.info(f"[{job_id}] Filter complex: {cmd[fc_idx+1][:200]}...")

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error(f"[{job_id}] FFmpeg error: {result.stderr}")
                raise RuntimeError(f"FFmpeg encoding failed: {result.stderr[:500]}")
            else:
                logger.info(f"[{job_id}] FFmpeg completed successfully")

            logger.info(f"[{job_id}] Video encoded, uploading to R2...")

            # Upload to R2
            full_output_key = f"{user_id}/{output_key}"
            r2.upload_file(output_path, bucket, full_output_key)

            logger.info(f"[{job_id}] AI upscaling complete: {output_key}")

            return {
                "status": "success",
                "output_key": output_key,
                "frames_processed": output_frame_idx,
            }

    except Exception as e:
        logger.error(f"[{job_id}] AI upscaling failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


# Rating notation mapping (matches frontend constants)
RATING_NOTATION = {
    1: "??",   # Blunder
    2: "?",    # Mistake
    3: "!?",   # Interesting
    4: "!",    # Good
    5: "!!",   # Brilliant
}

# Rating colors (hex) for overlay borders
RATING_COLORS_HEX = {
    1: "0xef4444",  # Red - Blunder
    2: "0xf59e0b",  # Amber - Mistake
    3: "0x3b82f6",  # Blue - Interesting
    4: "0x22c55e",  # Green - Good
    5: "0x86efac",  # Light green - Brilliant
}


def _escape_drawtext(text: str) -> str:
    """
    Escape text for FFmpeg drawtext filter.
    Order matters: escape backslashes first, then special chars.
    """
    # First escape backslashes
    text = text.replace('\\', '\\\\')
    # Escape single quotes (close quote, add escaped quote, reopen)
    text = text.replace("'", "'\\''")
    # Escape colons (special in FFmpeg filter syntax)
    text = text.replace(':', '\\:')
    # Escape other special FFmpeg filter chars
    text = text.replace('[', '\\[')
    text = text.replace(']', '\\]')
    text = text.replace(';', '\\;')
    return text


@app.function(
    image=image,
    # No GPU - annotated compilation is just FFmpeg encoding
    timeout=900,  # 15 minutes for longer compilations
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def create_annotated_compilation(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    clips: list,
    gallery_output_key: str = None,
) -> dict:
    """
    Create a video compilation with burned-in text annotations on Modal.

    This function:
    1. Downloads game video from R2
    2. For each clip: extracts segment with burned-in text overlay
    3. Concatenates all clips into one video
    4. Uploads result to R2

    Args:
        job_id: Unique job identifier for logging
        user_id: User folder in R2 (e.g., "a")
        input_key: R2 key for source game video (e.g., "games/abc123.mp4")
        output_key: R2 key for output compilation (e.g., "downloads/compilation.mp4")
        clips: List of clip data
        gallery_output_key: Optional secondary R2 key for gallery (e.g., "final_videos/abc.mp4")
            [
                {
                    "start_time": 150.5,
                    "end_time": 165.5,
                    "name": "Brilliant Goal",
                    "notes": "Amazing finish",
                    "rating": 5,
                    "tags": ["Goal", "Dribble"]
                },
                ...
            ]

    Returns:
        {"status": "success", "output_key": "...", "clips_processed": N} or
        {"status": "error", "error": "..."}
    """
    import subprocess

    try:
        logger.info(f"[{job_id}] Starting annotated compilation for user {user_id}")
        logger.info(f"[{job_id}] Input: {input_key}, Output: {output_key}")
        logger.info(f"[{job_id}] Clips: {len(clips)}")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download source video from R2
            input_path = os.path.join(temp_dir, "source.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[{job_id}] Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Process each clip with burned-in text
            clip_paths = []
            for idx, clip in enumerate(clips):
                clip_name = clip.get('name', 'clip')
                rating = clip.get('rating', 3)
                tags = clip.get('tags', [])
                notes = clip.get('notes', '')
                start_time = clip['start_time']
                end_time = clip['end_time']
                duration = end_time - start_time

                logger.info(f"[{job_id}] Processing clip {idx+1}/{len(clips)}: {clip_name}")

                # Build display name from rating notation + name or tags
                rating_notation = RATING_NOTATION.get(rating, "!?")
                rating_color = RATING_COLORS_HEX.get(rating, "0x22c55e")

                if clip_name:
                    display_name = clip_name
                elif tags:
                    # Generate name from rating + first two tags
                    rating_words = {5: "Brilliant", 4: "Good", 3: "Interesting", 2: "Mistake", 1: "Blunder"}
                    rating_word = rating_words.get(rating, "")
                    if len(tags) >= 2:
                        display_name = f"{rating_word} {tags[0]} and {tags[1]}"
                    elif len(tags) == 1:
                        display_name = f"{rating_word} {tags[0]}"
                    else:
                        display_name = rating_word
                else:
                    display_name = f"Clip {idx + 1}"

                # Build filter for burned-in overlay (matches frontend style)
                box_height = 80 if notes else 50
                border_thickness = 4

                # Escape text for FFmpeg
                title_text = f"{rating_notation}  {display_name}"
                escaped_title = _escape_drawtext(title_text)

                filter_parts = []
                # Draw colored border first (slightly larger box)
                filter_parts.append(
                    f"drawbox=x=(iw*0.1-{border_thickness}):y=(10-{border_thickness}):w=(iw*0.8+{border_thickness*2}):h=({box_height}+{border_thickness*2}):color={rating_color}:t=fill"
                )
                # Draw white fill on top
                filter_parts.append(
                    f"drawbox=x=(iw*0.1):y=10:w=(iw*0.8):h={box_height}:color=white@0.95:t=fill"
                )
                # Title text
                filter_parts.append(
                    f"drawtext=text='{escaped_title}':fontsize=24:fontcolor=black:x=(w-text_w)/2:y=20"
                )
                # Notes if present
                if notes:
                    escaped_notes = _escape_drawtext(notes[:100])
                    filter_parts.append(
                        f"drawtext=text='{escaped_notes}':fontsize=16:fontcolor=0x333333:x=(w-text_w)/2:y=50"
                    )

                filter_str = ','.join(filter_parts)

                # Extract and encode clip
                clip_path = os.path.join(temp_dir, f"clip_{idx:04d}.mp4")
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(start_time),
                    "-i", input_path,
                    "-t", str(duration),
                    "-vf", filter_str,
                    "-c:v", "libx264",
                    "-preset", "fast",
                    "-crf", "23",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    clip_path,
                ]

                result = subprocess.run(cmd, capture_output=True, text=True)
                if result.returncode != 0:
                    logger.error(f"[{job_id}] FFmpeg error for clip {idx}: {result.stderr[:300]}")
                    continue  # Skip failed clips

                clip_paths.append(clip_path)
                logger.info(f"[{job_id}] Clip {idx+1} created successfully")

            if not clip_paths:
                raise RuntimeError("No clips were successfully processed")

            logger.info(f"[{job_id}] Concatenating {len(clip_paths)} clips...")

            # Create concat file
            concat_list = os.path.join(temp_dir, "concat.txt")
            with open(concat_list, "w") as f:
                for path in clip_paths:
                    f.write(f"file '{path}'\n")

            # Concatenate clips
            output_path = os.path.join(temp_dir, "output.mp4")
            concat_cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_list,
                "-c", "copy",
                "-movflags", "+faststart",
                output_path,
            ]

            result = subprocess.run(concat_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                raise RuntimeError(f"Concatenation failed: {result.stderr[:300]}")

            # Upload to R2 (primary download location)
            full_output_key = f"{user_id}/{output_key}"
            logger.info(f"[{job_id}] Uploading to {full_output_key}")
            r2.upload_file(
                output_path,
                bucket,
                full_output_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )

            # Also upload to gallery if key provided
            gallery_filename = None
            if gallery_output_key:
                full_gallery_key = f"{user_id}/{gallery_output_key}"
                logger.info(f"[{job_id}] Uploading to gallery: {full_gallery_key}")
                r2.upload_file(
                    output_path,
                    bucket,
                    full_gallery_key,
                    ExtraArgs={"ContentType": "video/mp4"},
                )
                gallery_filename = gallery_output_key.split('/')[-1]

            logger.info(f"[{job_id}] Annotated compilation complete: {len(clip_paths)} clips")
            return {
                "status": "success",
                "output_key": output_key,
                "gallery_filename": gallery_filename,
                "clips_processed": len(clip_paths),
            }

    except Exception as e:
        logger.error(f"[{job_id}] Annotated compilation failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.function(
    image=image,
    # No GPU - clip extraction is just FFmpeg codec copy
    timeout=300,  # 5 minutes max
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def extract_clip_modal(
    user_id: str,
    input_key: str,
    output_key: str,
    start_time: float,
    end_time: float,
    copy_codec: bool = True,
) -> dict:
    """
    Extract a clip from a video file on Modal (CPU-only, uses FFmpeg).

    Args:
        user_id: User folder in R2 (e.g., "a")
        input_key: R2 key for source video (e.g., "games/abc123.mp4")
        output_key: R2 key for output clip (e.g., "clips/def456.mp4")
        start_time: Start time in seconds
        end_time: End time in seconds
        copy_codec: If True, copy codecs (faster); if False, re-encode

    Returns:
        {"status": "success", "output_key": "...", "duration": float} or
        {"status": "error", "error": "..."}
    """
    import subprocess

    try:
        logger.info(f"[ClipExtract] Starting for user {user_id}")
        logger.info(f"[ClipExtract] Input: {input_key}, Output: {output_key}")
        logger.info(f"[ClipExtract] Time range: {start_time:.2f}s - {end_time:.2f}s")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download source video from R2
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[ClipExtract] Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Extract clip with FFmpeg
            output_path = os.path.join(temp_dir, "output.mp4")
            duration = end_time - start_time

            cmd = [
                "ffmpeg", "-y",
                "-ss", str(start_time),
                "-i", input_path,
                "-t", str(duration),
            ]

            if copy_codec:
                cmd.extend(["-c", "copy"])
            else:
                # Re-encode with good quality settings
                cmd.extend([
                    "-c:v", "libx264",
                    "-preset", "fast",
                    "-crf", "23",
                    "-c:a", "aac",
                    "-b:a", "192k",
                ])

            # Add faststart for streaming
            cmd.extend(["-movflags", "+faststart"])
            cmd.append(output_path)

            logger.info(f"[ClipExtract] Running FFmpeg: {' '.join(cmd[:10])}...")
            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                logger.error(f"[ClipExtract] FFmpeg error: {result.stderr}")
                raise RuntimeError(f"FFmpeg clip extraction failed: {result.stderr[:500]}")

            # Upload clip to R2
            full_output_key = f"{user_id}/{output_key}"
            logger.info(f"[ClipExtract] Uploading to {full_output_key}")
            r2.upload_file(
                output_path,
                bucket,
                full_output_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )

            logger.info(f"[ClipExtract] Complete: {output_key}")
            return {
                "status": "success",
                "output_key": output_key,
                "duration": duration,
            }

    except Exception as e:
        logger.error(f"[ClipExtract] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


# Local testing entrypoint
@app.local_entrypoint()
def main():
    """Test the function locally."""
    print("Modal video processing functions ready.")
    print()
    print("Available functions:")
    print("  - render_overlay: Apply highlight overlays to video")
    print("  - render_overlay_parallel: Parallel chunk processing")
    print("  - process_framing: Crop, trim, and speed adjustments (FFmpeg)")
    print("  - process_framing_ai: Crop with Real-ESRGAN AI upscaling")
    print("  - detect_players_modal: YOLO player detection")
    print("  - extract_clip_modal: Extract clip from video (FFmpeg)")
    print("  - create_annotated_compilation: Create video with burned-in text annotations")
    print()
    print("Deploy with: modal deploy video_processing.py")
    print()
    print("Call from Python:")
    print("  import modal")
    print("  fn = modal.Function.from_name('reel-ballers-video', 'render_overlay')")
    print("  result = fn.remote(job_id=..., user_id=..., ...)")
