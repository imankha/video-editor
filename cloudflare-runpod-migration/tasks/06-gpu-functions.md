# Task 06: Modal GPU Functions

## Overview
Create Modal functions for GPU video processing. No Docker required - just Python with decorators.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 05 complete (Modal account and CLI authenticated)
- R2 storage working (Tasks 01-04)

## Testability
**After this task**: Can run `modal run` to test video processing locally before deploying.

---

## Architecture Context

```
FastAPI (Fly.io)                    Modal GPU Function
┌─────────────────┐                ┌─────────────────┐
│ 1. Receive      │                │                 │
│    export       │───────────────►│ 3. Download     │
│    request      │  function.call │    from R2      │
│                 │                │                 │
│ 2. Call Modal   │                │ 4. FFmpeg       │
│    function     │                │    process      │
│                 │                │                 │
│ 5. Return       │◄───────────────│ 5. Upload to    │
│    result       │  Returns URL   │    R2           │
└─────────────────┘                └─────────────────┘
         │                                  │
         └──────────────┬──────────────────┘
                        ▼
               ┌─────────────────┐
               │   R2 Storage    │
               │ (input/output)  │
               └─────────────────┘
```

---

## Directory Structure

```
video-editor/
└── modal_functions/
    ├── __init__.py
    ├── video_processing.py    # Main Modal app with GPU functions
    └── processors/
        ├── __init__.py
        ├── framing.py         # Crop, trim, speed changes
        ├── overlay.py         # Text/image overlays
        └── annotate.py        # Game annotation export
```

---

## Key Files

### modal_functions/video_processing.py

```python
"""
Modal GPU functions for video processing.

No Docker needed - Modal handles the environment.
"""
import modal
import os
import tempfile
import logging

# Define the Modal app
app = modal.App("reel-ballers-video")

# Define the image with FFmpeg
image = modal.Image.debian_slim(python_version="3.11").apt_install("ffmpeg").pip_install(
    "boto3",
    "ffmpeg-python",
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.function(
    image=image,
    gpu="T4",  # Or "A10G" for faster processing
    timeout=300,  # 5 minutes max
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_video(
    job_id: str,
    user_id: str,
    job_type: str,
    input_key: str,
    output_key: str,
    params: dict,
) -> dict:
    """
    Process video on GPU and upload result to R2.

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    import boto3
    from botocore.config import Config

    try:
        logger.info(f"[{job_id}] Starting {job_type} job for user {user_id}")

        # Initialize R2 client
        r2 = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT_URL"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4"),
            region_name="auto"
        )
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download input from R2
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[{job_id}] Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Process based on type
            output_path = os.path.join(temp_dir, "output.mp4")

            if job_type == "framing":
                _process_framing(input_path, output_path, params)
            elif job_type == "overlay":
                _process_overlay(input_path, output_path, params)
            elif job_type == "annotate":
                _process_annotate(input_path, output_path, params)
            else:
                raise ValueError(f"Unknown job type: {job_type}")

            # Upload result to R2
            full_output_key = f"{user_id}/{output_key}"
            logger.info(f"[{job_id}] Uploading to {full_output_key}")
            r2.upload_file(
                output_path,
                bucket,
                full_output_key,
                ExtraArgs={"ContentType": "video/mp4"}
            )

            logger.info(f"[{job_id}] Job complete")
            return {"status": "success", "output_key": output_key}

    except Exception as e:
        logger.error(f"[{job_id}] Job failed: {e}")
        return {"status": "error", "error": str(e)}


def _process_framing(input_path: str, output_path: str, params: dict):
    """Process framing export with FFmpeg."""
    import subprocess

    output_width = params.get("output_width", 1080)
    output_height = params.get("output_height", 1920)
    fps = params.get("fps", 30)

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-vf", f"scale={output_width}:{output_height}",
        "-r", str(fps),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        output_path
    ]

    logger.info(f"Running FFmpeg: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr}")


def _process_overlay(input_path: str, output_path: str, params: dict):
    """Process overlay export with FFmpeg."""
    import subprocess
    # Similar to framing, add overlay logic
    # For now, just copy
    cmd = ["ffmpeg", "-y", "-i", input_path, "-c", "copy", output_path]
    subprocess.run(cmd, check=True)


def _process_annotate(input_path: str, output_path: str, params: dict):
    """Process annotate export with FFmpeg."""
    import subprocess
    # Similar to framing, add annotation logic
    # For now, just copy
    cmd = ["ffmpeg", "-y", "-i", input_path, "-c", "copy", output_path]
    subprocess.run(cmd, check=True)


# Local testing entrypoint
@app.local_entrypoint()
def main():
    """Test the function locally."""
    result = process_video.remote(
        job_id="test-123",
        user_id="a",
        job_type="framing",
        input_key="working_videos/test.mp4",
        output_key="final_videos/test_output.mp4",
        params={"output_width": 1080, "output_height": 1920, "fps": 30}
    )
    print(f"Result: {result}")
```

---

## Setup Modal Secrets

Before deploying, add R2 credentials as a Modal secret:

```bash
modal secret create r2-credentials \
  R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com \
  R2_ACCESS_KEY_ID=your_key \
  R2_SECRET_ACCESS_KEY=your_secret \
  R2_BUCKET_NAME=reel-ballers-users
```

---

## Deploy and Test

### Deploy to Modal

```bash
cd modal_functions
modal deploy video_processing.py
```

This creates a deployed function accessible via the Modal Python client.

### Test Locally (without GPU)

```bash
# Run the local entrypoint (uses Modal's cloud GPU)
modal run video_processing.py
```

### Test from Python

```python
from modal_functions.video_processing import process_video

# Call the function (runs on Modal's GPU)
result = process_video.remote(
    job_id="test-456",
    user_id="a",
    job_type="framing",
    input_key="working_videos/test.mp4",
    output_key="final_videos/test_output.mp4",
    params={"output_width": 1080, "output_height": 1920}
)
print(result)
# {"status": "success", "output_key": "final_videos/test_output.mp4"}
```

---

## Porting from Backend

The processors are ported from existing FastAPI code:

| Modal Function | Backend Source | Key Logic |
|----------------|----------------|-----------|
| `_process_framing` | `routers/export/framing.py` | Crop interpolation, speed changes |
| `_process_overlay` | `routers/export/overlay.py` | Text/image compositing |
| `_process_annotate` | `routers/annotate.py` | Clip extraction, compilation |

### Key Differences from Backend

1. **No database access** - All data passed via function params
2. **R2 for all I/O** - Download input, upload output
3. **Stateless** - Each call is independent
4. **Direct returns** - No polling needed, function returns when complete

---

## Deliverables

| Item | Description |
|------|-------------|
| modal_functions/ directory | Python package with Modal functions |
| video_processing.py | Main Modal app with GPU functions |
| Modal secret created | r2-credentials with R2 access |
| Functions deployed | `modal deploy` successful |
| Manual test passed | `modal run` completes successfully |

---

## Why Modal is Simpler

| Aspect | RunPod (Docker) | Modal (Python) |
|--------|-----------------|----------------|
| Setup | Dockerfile, build, push, configure | Just Python |
| Dependencies | requirements.txt in container | `.pip_install()` in code |
| Testing | Build container, run locally | `modal run` |
| Deployment | Push to registry, update endpoint | `modal deploy` |
| Calling | HTTP API + polling | `function.remote()` |

---

## Next Step
Task 07 - Backend Modal Integration (FastAPI calls Modal functions)
