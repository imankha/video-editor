# Task 08: GPU Worker Code

## Overview
Create the RunPod serverless handler that processes video exports using GPU acceleration.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 04 complete (R2 credentials available)
- Task 07 complete (RunPod endpoint created)
- Understanding of existing video processing code in `src/backend/app/`

## Time Estimate
2-3 hours

---

## Directory Structure

```
video-editor/
└── gpu-worker/
    ├── Dockerfile
    ├── handler.py              # RunPod entry point
    ├── requirements.txt
    ├── processors/
    │   ├── __init__.py
    │   ├── overlay.py          # Overlay export (from backend)
    │   ├── framing.py          # Framing export (from backend)
    │   └── annotate.py         # Annotate export (from backend)
    ├── services/
    │   ├── __init__.py
    │   ├── r2_client.py        # R2 upload/download
    │   ├── callback.py         # Progress callbacks to Workers
    │   └── ffmpeg.py           # FFmpeg wrapper
    └── utils/
        ├── __init__.py
        └── keyframe.py         # Keyframe interpolation
```

---

## Dockerfile

```dockerfile
# gpu-worker/Dockerfile
FROM nvidia/cuda:12.1-cudnn8-runtime-ubuntu22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# Set Python
RUN ln -s /usr/bin/python3.10 /usr/bin/python

# Install Python dependencies
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# RunPod entry point
CMD ["python", "-u", "handler.py"]
```

---

## requirements.txt

```
runpod>=1.6.0
boto3>=1.34.0
opencv-python-headless>=4.9.0
numpy>=1.26.0
requests>=2.31.0
Pillow>=10.2.0
```

---

## handler.py (Main Entry Point)

```python
"""
RunPod Serverless Handler for Video Export Processing

This handler receives jobs from the Cloudflare Worker and processes
video exports using GPU-accelerated FFmpeg encoding.
"""

import runpod
import os
import tempfile
import traceback
from typing import Dict, Any

from services.r2_client import R2Client
from services.callback import CallbackClient
from processors.overlay import process_overlay
from processors.framing import process_framing
from processors.annotate import process_annotate


def handler(job: Dict[str, Any]) -> Dict[str, Any]:
    """
    Main handler function called by RunPod.

    Expected input:
    {
        "job_id": "uuid",
        "type": "overlay" | "framing" | "annotate",
        "input_video_key": "input/job_id/video.mp4",
        "params": { ... },
        "callback_url": "https://workers.dev/api/jobs/{id}/do"
    }
    """
    job_input = job["input"]
    job_id = job_input["job_id"]
    job_type = job_input["type"]
    input_key = job_input["input_video_key"]
    params = job_input.get("params", {})
    callback_url = job_input.get("callback_url")

    # Initialize clients
    r2 = R2Client()
    callback = CallbackClient(callback_url) if callback_url else None

    # Create temp directory for this job
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            # Report start
            if callback:
                callback.progress(0, "Starting export...")

            # Download input video from R2
            if callback:
                callback.progress(5, "Downloading video...")
            input_path = os.path.join(temp_dir, "input.mp4")
            r2.download(input_key, input_path)

            # Process based on type
            output_path = os.path.join(temp_dir, "output.mp4")

            if job_type == "overlay":
                process_overlay(
                    input_path=input_path,
                    output_path=output_path,
                    params=params,
                    progress_callback=lambda p, m: callback.progress(10 + int(p * 0.8), m) if callback else None
                )
            elif job_type == "framing":
                process_framing(
                    input_path=input_path,
                    output_path=output_path,
                    params=params,
                    progress_callback=lambda p, m: callback.progress(10 + int(p * 0.8), m) if callback else None
                )
            elif job_type == "annotate":
                process_annotate(
                    input_path=input_path,
                    output_path=output_path,
                    params=params,
                    progress_callback=lambda p, m: callback.progress(10 + int(p * 0.8), m) if callback else None
                )
            else:
                raise ValueError(f"Unknown job type: {job_type}")

            # Upload result to R2
            if callback:
                callback.progress(95, "Uploading result...")
            output_key = f"output/{job_id}/video.mp4"
            r2.upload(output_path, output_key)

            # Report completion
            if callback:
                callback.complete(output_key)

            return {
                "status": "success",
                "output_video_key": output_key
            }

        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            print(f"Job {job_id} failed: {error_msg}")
            print(traceback.format_exc())

            if callback:
                callback.error(error_msg, should_retry=True)

            return {
                "status": "error",
                "error": error_msg
            }


# Start RunPod serverless worker
runpod.serverless.start({"handler": handler})
```

---

## services/r2_client.py

```python
"""
R2 Storage Client using S3-compatible API
"""

import os
import boto3
from botocore.config import Config


class R2Client:
    def __init__(self):
        self.bucket_name = os.environ.get("R2_BUCKET_NAME", "reel-ballers-videos")

        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ.get("R2_ENDPOINT"),
            aws_access_key_id=os.environ.get("R2_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY"),
            config=Config(signature_version="s3v4"),
            region_name="auto"
        )

    def download(self, key: str, local_path: str):
        """Download file from R2 to local path"""
        print(f"Downloading {key} to {local_path}")
        self.client.download_file(self.bucket_name, key, local_path)
        print(f"Downloaded {os.path.getsize(local_path)} bytes")

    def upload(self, local_path: str, key: str, content_type: str = "video/mp4"):
        """Upload local file to R2"""
        print(f"Uploading {local_path} to {key}")
        self.client.upload_file(
            local_path,
            self.bucket_name,
            key,
            ExtraArgs={"ContentType": content_type}
        )
        print(f"Uploaded {os.path.getsize(local_path)} bytes")

    def delete(self, key: str):
        """Delete file from R2"""
        self.client.delete_object(Bucket=self.bucket_name, Key=key)
```

---

## services/callback.py

```python
"""
Callback client for sending progress updates to Cloudflare Workers
"""

import requests
from typing import Optional


class CallbackClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def progress(self, percent: int, message: str = ""):
        """Send progress update"""
        try:
            requests.post(
                f"{self.base_url}/progress",
                json={"progress": percent, "message": message},
                timeout=5
            )
        except Exception as e:
            print(f"Callback error (progress): {e}")

    def complete(self, output_video_key: str):
        """Send completion notification"""
        try:
            requests.post(
                f"{self.base_url}/complete",
                json={"output_video_key": output_video_key},
                timeout=5
            )
        except Exception as e:
            print(f"Callback error (complete): {e}")

    def error(self, error_message: str, should_retry: bool = False):
        """Send error notification"""
        try:
            requests.post(
                f"{self.base_url}/error",
                json={"error": error_message, "should_retry": should_retry},
                timeout=5
            )
        except Exception as e:
            print(f"Callback error (error): {e}")
```

---

## processors/overlay.py

```python
"""
Overlay Export Processor

Ported from: src/backend/app/routers/export/overlay.py
"""

import cv2
import numpy as np
import subprocess
import tempfile
import os
from typing import Callable, Optional, List, Dict, Any

from utils.keyframe import KeyframeInterpolator


def process_overlay(
    input_path: str,
    output_path: str,
    params: Dict[str, Any],
    progress_callback: Optional[Callable[[int, str], None]] = None
):
    """
    Process overlay export with highlight regions and effects.

    params:
    - highlight_regions: List of highlight region dicts
    - effect_type: "blur" | "spotlight" | etc.
    - crop_keyframes: Optional crop keyframes for framing
    """
    highlight_regions = params.get("highlight_regions", [])
    effect_type = params.get("effect_type", "blur")
    crop_keyframes = params.get("crop_keyframes")

    # Open video
    cap = cv2.VideoCapture(input_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if progress_callback:
        progress_callback(0, f"Processing {total_frames} frames...")

    # Setup crop interpolator if needed
    crop_interpolator = None
    if crop_keyframes:
        crop_interpolator = KeyframeInterpolator(crop_keyframes)

    # Create temp file for raw frames
    with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as temp_raw:
        temp_raw_path = temp_raw.name

    try:
        # Process frames
        frame_idx = 0
        with open(temp_raw_path, "wb") as raw_out:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                # Apply highlight effect
                frame = apply_highlight_effect(
                    frame, frame_idx, highlight_regions, effect_type
                )

                # Apply crop if needed
                if crop_interpolator:
                    crop = crop_interpolator.interpolate(frame_idx)
                    frame = apply_crop(frame, crop, params.get("output_width", 1080),
                                      params.get("output_height", 1920))

                # Write raw frame
                raw_out.write(frame.tobytes())

                frame_idx += 1
                if frame_idx % 30 == 0 and progress_callback:
                    pct = int((frame_idx / total_frames) * 100)
                    progress_callback(pct, f"Processed {frame_idx}/{total_frames} frames")

        cap.release()

        # Encode with FFmpeg using GPU
        if progress_callback:
            progress_callback(90, "Encoding video...")

        encode_with_ffmpeg(
            temp_raw_path, output_path,
            width=crop_interpolator and params.get("output_width", 1080) or width,
            height=crop_interpolator and params.get("output_height", 1920) or height,
            fps=fps,
            input_path=input_path  # For audio
        )

    finally:
        if os.path.exists(temp_raw_path):
            os.unlink(temp_raw_path)


def apply_highlight_effect(
    frame: np.ndarray,
    frame_idx: int,
    regions: List[Dict],
    effect_type: str
) -> np.ndarray:
    """Apply highlight/spotlight effect to frame"""
    # Find active regions for this frame
    active_regions = [
        r for r in regions
        if r["start_frame"] <= frame_idx <= r["end_frame"]
    ]

    if not active_regions:
        return frame

    if effect_type == "blur":
        # Create blurred background
        blurred = cv2.GaussianBlur(frame, (51, 51), 0)
        mask = np.zeros(frame.shape[:2], dtype=np.float32)

        for region in active_regions:
            # Draw ellipse on mask
            center = (int(region["x"]), int(region["y"]))
            axes = (int(region["radius_x"]), int(region["radius_y"]))
            cv2.ellipse(mask, center, axes, 0, 0, 360, region.get("opacity", 1.0), -1)

        # Feather the mask
        mask = cv2.GaussianBlur(mask, (21, 21), 0)
        mask = np.stack([mask] * 3, axis=-1)

        # Blend
        frame = (frame * mask + blurred * (1 - mask)).astype(np.uint8)

    elif effect_type == "spotlight":
        # Darken background
        darkened = (frame * 0.3).astype(np.uint8)
        mask = np.zeros(frame.shape[:2], dtype=np.float32)

        for region in active_regions:
            center = (int(region["x"]), int(region["y"]))
            axes = (int(region["radius_x"]), int(region["radius_y"]))
            cv2.ellipse(mask, center, axes, 0, 0, 360, region.get("opacity", 1.0), -1)

        mask = cv2.GaussianBlur(mask, (21, 21), 0)
        mask = np.stack([mask] * 3, axis=-1)

        frame = (frame * mask + darkened * (1 - mask)).astype(np.uint8)

    return frame


def apply_crop(frame: np.ndarray, crop: Dict, output_width: int, output_height: int) -> np.ndarray:
    """Apply crop and resize to output dimensions"""
    x, y, w, h = int(crop["x"]), int(crop["y"]), int(crop["width"]), int(crop["height"])

    # Clamp to frame bounds
    x = max(0, min(x, frame.shape[1] - w))
    y = max(0, min(y, frame.shape[0] - h))

    cropped = frame[y:y+h, x:x+w]
    resized = cv2.resize(cropped, (output_width, output_height), interpolation=cv2.INTER_LANCZOS4)

    return resized


def encode_with_ffmpeg(
    raw_path: str,
    output_path: str,
    width: int,
    height: int,
    fps: float,
    input_path: str = None  # Original video for audio
):
    """Encode raw frames with FFmpeg using GPU acceleration"""
    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-i", raw_path,
    ]

    # Add audio from original if available
    if input_path:
        cmd.extend(["-i", input_path, "-map", "0:v", "-map", "1:a?"])

    # GPU encoding (NVENC)
    cmd.extend([
        "-c:v", "h264_nvenc",
        "-preset", "p4",  # Balanced speed/quality
        "-cq", "23",      # Quality level
        "-c:a", "aac",
        "-b:a", "128k",
        output_path
    ])

    print(f"Running FFmpeg: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"FFmpeg stderr: {result.stderr}")
        raise RuntimeError(f"FFmpeg failed: {result.stderr}")
```

---

## utils/keyframe.py

```python
"""
Keyframe Interpolation Utilities

Ported from: src/frontend/src/utils/keyframeInterpolation.js
"""

from typing import List, Dict, Any


class KeyframeInterpolator:
    def __init__(self, keyframes: List[Dict[str, Any]]):
        """
        Initialize with sorted keyframes.
        Each keyframe: { frame: int, x: float, y: float, width: float, height: float }
        """
        self.keyframes = sorted(keyframes, key=lambda k: k["frame"])

    def interpolate(self, frame: int) -> Dict[str, float]:
        """
        Get interpolated values at the given frame.
        Uses linear interpolation between keyframes.
        """
        if not self.keyframes:
            raise ValueError("No keyframes available")

        # Before first keyframe
        if frame <= self.keyframes[0]["frame"]:
            return self._extract_values(self.keyframes[0])

        # After last keyframe
        if frame >= self.keyframes[-1]["frame"]:
            return self._extract_values(self.keyframes[-1])

        # Find surrounding keyframes
        for i in range(len(self.keyframes) - 1):
            kf1 = self.keyframes[i]
            kf2 = self.keyframes[i + 1]

            if kf1["frame"] <= frame <= kf2["frame"]:
                # Linear interpolation
                t = (frame - kf1["frame"]) / (kf2["frame"] - kf1["frame"])
                return self._lerp(kf1, kf2, t)

        # Fallback (shouldn't reach here)
        return self._extract_values(self.keyframes[-1])

    def _extract_values(self, kf: Dict) -> Dict[str, float]:
        return {
            "x": kf["x"],
            "y": kf["y"],
            "width": kf["width"],
            "height": kf["height"]
        }

    def _lerp(self, kf1: Dict, kf2: Dict, t: float) -> Dict[str, float]:
        return {
            "x": kf1["x"] + (kf2["x"] - kf1["x"]) * t,
            "y": kf1["y"] + (kf2["y"] - kf1["y"]) * t,
            "width": kf1["width"] + (kf2["width"] - kf1["width"]) * t,
            "height": kf1["height"] + (kf2["height"] - kf1["height"]) * t
        }
```

---

## Environment Variables for RunPod

Set these in your RunPod endpoint configuration:

```
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=reel-ballers-videos
```

---

## Building and Deploying

```bash
cd gpu-worker

# Build Docker image
docker build -t your-dockerhub/reel-ballers-gpu:latest .

# Test locally (requires NVIDIA Docker)
docker run --gpus all \
  -e R2_ENDPOINT=... \
  -e R2_ACCESS_KEY_ID=... \
  -e R2_SECRET_ACCESS_KEY=... \
  -e R2_BUCKET_NAME=reel-ballers-videos \
  your-dockerhub/reel-ballers-gpu:latest

# Push to Docker Hub
docker push your-dockerhub/reel-ballers-gpu:latest

# Update RunPod endpoint to use this image
```

---

## Handoff Notes

**For Task 09 (Backend Migration):**
- GPU worker handles all processing
- Backend just needs to submit jobs to Workers API

**For Task 10 (Frontend Migration):**
- No changes needed for GPU worker
- Frontend talks to Workers, not GPU directly

**Porting Notes:**
- `processors/overlay.py` is ported from `src/backend/app/routers/export/overlay.py`
- `processors/framing.py` needs similar porting from `framing.py`
- Key difference: R2 for storage instead of local filesystem

**Known Issue: OpenCV Frame Count**
The existing code uses OpenCV for frame extraction, which has reliability issues with certain video formats (frame counts don't match container metadata). Consider using FFmpeg for frame extraction:
```bash
# Extract all frames
ffmpeg -i input.mp4 -vsync 0 frames/frame_%06d.png

# Then process frames from disk
```
This is more reliable but uses more disk I/O. See `docs/plans/tasks.md` Task 4 for details.
