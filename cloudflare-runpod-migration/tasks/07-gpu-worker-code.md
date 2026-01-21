# Task 07: GPU Worker Code

## Overview
Create the RunPod serverless handler (Docker container) that processes video exports using GPU acceleration.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 05-06 complete (RunPod endpoint created)
- R2 storage working (Tasks 01-04)
- R2 credentials available from Task 02

## Testability
**After this task**: Container deployed to RunPod. Can test job submission manually via curl. Backend integration comes next.

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
    │   ├── overlay.py          # Overlay export (ported from backend)
    │   ├── framing.py          # Framing export (ported from backend)
    │   └── annotate.py         # Annotate export (ported from backend)
    ├── services/
    │   ├── __init__.py
    │   ├── r2_client.py        # R2 upload/download
    │   └── ffmpeg.py           # FFmpeg wrapper
    └── utils/
        ├── __init__.py
        └── keyframe.py         # Keyframe interpolation
```

---

## Key Files

### Dockerfile

```dockerfile
FROM nvidia/cuda:12.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN ln -s /usr/bin/python3.10 /usr/bin/python

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "-u", "handler.py"]
```

### handler.py (Main Entry)

```python
import runpod
import os
import tempfile
from services.r2_client import R2Client
from processors.overlay import process_overlay
from processors.framing import process_framing
from processors.annotate import process_annotate

def handler(job):
    """
    RunPod handler - receives job, processes video, uploads result.

    Input:
    {
        "job_id": "uuid",
        "user_id": "user-namespace",
        "type": "overlay" | "framing" | "annotate",
        "input_key": "working_videos/working_1_abc.mp4",
        "output_key": "final_videos/export_xyz.mp4",
        "params": { ... export parameters ... }
    }
    """
    job_input = job["input"]
    job_id = job_input["job_id"]
    user_id = job_input["user_id"]
    job_type = job_input["type"]
    input_key = job_input["input_key"]
    output_key = job_input["output_key"]
    params = job_input.get("params", {})

    r2 = R2Client(user_id)

    with tempfile.TemporaryDirectory() as temp_dir:
        # Download input from R2
        input_path = os.path.join(temp_dir, "input.mp4")
        r2.download(input_key, input_path)

        # Process based on type
        output_path = os.path.join(temp_dir, "output.mp4")

        if job_type == "overlay":
            process_overlay(input_path, output_path, params)
        elif job_type == "framing":
            process_framing(input_path, output_path, params)
        elif job_type == "annotate":
            process_annotate(input_path, output_path, params)
        else:
            raise ValueError(f"Unknown job type: {job_type}")

        # Upload result to R2
        r2.upload(output_path, output_key)

        return {
            "status": "success",
            "output_key": output_key
        }

runpod.serverless.start({"handler": handler})
```

### services/r2_client.py

```python
import boto3
from botocore.config import Config
import os

class R2Client:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.bucket = os.environ["R2_BUCKET_NAME"]
        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4"),
            region_name="auto"
        )

    def _key(self, path: str) -> str:
        return f"{self.user_id}/{path}"

    def download(self, path: str, local_path: str):
        self.client.download_file(self.bucket, self._key(path), local_path)

    def upload(self, local_path: str, path: str):
        self.client.upload_file(
            local_path, self.bucket, self._key(path),
            ExtraArgs={"ContentType": "video/mp4"}
        )
```

---

## Environment Variables for RunPod

Set in RunPod endpoint settings:

```
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=reel-ballers-users
```

---

## Build and Deploy

```bash
cd gpu-worker

# Build
docker build -t your-dockerhub/reel-ballers-gpu:latest .

# Test locally (requires NVIDIA Docker)
docker run --gpus all \
  -e R2_ENDPOINT=... \
  -e R2_ACCESS_KEY_ID=... \
  -e R2_SECRET_ACCESS_KEY=... \
  -e R2_BUCKET_NAME=reel-ballers-users \
  your-dockerhub/reel-ballers-gpu:latest

# Push to Docker Hub
docker push your-dockerhub/reel-ballers-gpu:latest

# Update RunPod endpoint to use this image
```

---

## Testing

```bash
# Submit a test job to RunPod
curl -X POST "https://api.runpod.ai/v2/{endpoint_id}/run" \
  -H "Authorization: Bearer {api_key}" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "job_id": "test-123",
      "user_id": "a",
      "type": "framing",
      "input_key": "raw_clips/test.mp4",
      "output_key": "final_videos/test_output.mp4",
      "params": {
        "crop_keyframes": [{"frame": 0, "x": 100, "y": 100, "width": 1080, "height": 1920}]
      }
    }
  }'
```

---

## Porting Notes

The processors are ported from existing backend code:

| GPU Worker | Backend Source |
|------------|----------------|
| `processors/overlay.py` | `routers/export/overlay.py` |
| `processors/framing.py` | `routers/export/framing.py` |
| `processors/annotate.py` | `routers/annotate.py` (export_game function) |

Key changes from backend:
- R2 for storage instead of local filesystem
- No database access - all data passed via job params
- Progress callbacks removed (will add in Task 08)

---

## Handoff Notes

**For Task 08 (Backend RunPod Integration):**
- GPU worker is deployed and tested
- Accepts job via RunPod API
- Downloads from R2, processes, uploads to R2
- Next: Backend submits jobs to this endpoint
