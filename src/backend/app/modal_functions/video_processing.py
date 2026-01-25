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
    .apt_install("ffmpeg")
    .pip_install(
        "boto3",
        "opencv-python-headless",  # Headless for server use
        "numpy",
    )
)

# Minimum video duration (seconds) to use parallel processing
# Below this threshold, overhead of splitting isn't worth it
PARALLEL_THRESHOLD_SECONDS = 8.0
NUM_PARALLEL_CHUNKS = 4  # Number of parallel workers

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
    gpu="T4",
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
    num_chunks: int = NUM_PARALLEL_CHUNKS,
) -> dict:
    """
    Process overlay using parallel chunk processing.

    Splits video into chunks, processes each in parallel using Modal .map(),
    then concatenates results. Provides ~3-4x speedup for longer videos.

    Architecture:
        1. Orchestrator downloads input to get video metadata
        2. Creates chunk configs with R2 keys (not local paths)
        3. Chunk workers: each downloads from R2 -> processes -> uploads to R2
        4. Orchestrator downloads chunks from R2 -> concatenates -> uploads final

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        input_key: R2 key for input video
        output_key: R2 key for output video
        highlight_regions: List of regions with keyframes
        effect_type: Effect type for highlights
        num_chunks: Number of parallel chunks (default 4)

    Returns:
        {"status": "success", "output_key": "...", "parallel": True}
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
        "-preset", "fast",
        "-crf", "23",
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


# Local testing entrypoint
@app.local_entrypoint()
def main():
    """Test the function locally."""
    print("Modal video processing functions ready.")
    print()
    print("Available functions:")
    print("  - render_overlay: Apply highlight overlays to video")
    print("  - process_framing: Crop, trim, and speed adjustments")
    print()
    print("Deploy with: modal deploy video_processing.py")
    print()
    print("Call from Python:")
    print("  import modal")
    print("  fn = modal.Function.from_name('reel-ballers-video', 'render_overlay')")
    print("  result = fn.remote(job_id=..., user_id=..., ...)")
