# GPU Architecture Plan

## Overview

All GPU workloads run on RunPod serverless. Quality is the differentiator - no compromises with browser-based inference.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (Cloudflare Pages)             │
│                                                             │
│   User uploads video → Request GPU job → Poll for result    │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  API (Cloudflare Workers)                    │
│                                                             │
│   /debit  → Check wallet → Trigger RunPod → Return job ID   │
│   /status → Poll RunPod job status                          │
│   /webhook → RunPod completion callback                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    RunPod Serverless                         │
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │  Upscale    │  │   Track     │  │   Export    │        │
│   │  (4x SR)    │  │  (YOLO)     │  │  (FFmpeg)   │        │
│   └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│   Input: R2 presigned URL                                   │
│   Output: R2 presigned URL                                  │
└─────────────────────────────────────────────────────────────┘
```

## RunPod Endpoints

### 1. Upscale Endpoint
```python
# Input
{
  "task": "upscale",
  "input_url": "https://r2.../input.mp4",
  "output_url": "https://r2.../output.mp4",  # presigned PUT
  "params": {
    "model": "RealESRGAN_x4plus",  # or SwinIR_4x_GAN
    "scale": 4
  }
}

# Output
{
  "status": "completed",
  "output_url": "https://r2.../output.mp4",
  "stats": {
    "frames": 1200,
    "duration_sec": 45.2,
    "model": "RealESRGAN_x4plus"
  }
}
```

### 2. Track Endpoint
```python
# Input
{
  "task": "track",
  "input_url": "https://r2.../input.mp4",
  "params": {
    "model": "yolov8",
    "classes": ["person"],
    "confidence": 0.5
  }
}

# Output
{
  "status": "completed",
  "tracks": [
    {
      "id": 1,
      "frames": [
        {"frame": 0, "bbox": [x, y, w, h], "confidence": 0.92},
        ...
      ]
    }
  ]
}
```

### 3. Export Endpoint
```python
# Input
{
  "task": "export",
  "input_url": "https://r2.../input.mp4",
  "output_url": "https://r2.../output.mp4",
  "params": {
    "crop": {"x": 100, "y": 50, "w": 1080, "h": 1920},
    "upscale": true,
    "upscale_model": "RealESRGAN_x4plus",
    "format": "mp4",
    "quality": "high"
  }
}
```

## Docker Image (Future - Not Yet Implemented)

When implementing RunPod, create `deploy/runpod/Dockerfile`:

```dockerfile
FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

# Install dependencies
RUN pip install \
    runpod \
    opencv-python-headless \
    basicsr \
    realesrgan \
    ultralytics \
    ffmpeg-python

# Copy model weights (baked into image for fast cold start)
COPY weights/ /app/weights/

# Set weights directory for model_manager.py
ENV WEIGHTS_DIR=/app/weights

# Copy handler
COPY handler.py /app/handler.py

CMD ["python", "/app/handler.py"]
```

**Note**: The `WEIGHTS_DIR` env var is already supported in `model_manager.py`.

## Cost Model

| GPU | Cost/sec | Use Case |
|-----|----------|----------|
| RTX 3090 | $0.00031 | Development/testing |
| RTX 4090 | $0.00044 | Standard processing |
| A40 | $0.00025 | Production (best value) |

**Example costs:**
- 1 min video upscale (~30 sec processing): ~$0.008
- 5 min video full export (~3 min processing): ~$0.045

## File Flow

```
1. Frontend uploads to R2 (presigned PUT)
2. Frontend calls /debit with R2 input URL
3. Worker debits wallet, triggers RunPod with presigned URLs
4. RunPod downloads from R2, processes, uploads result to R2
5. RunPod calls webhook OR frontend polls /status
6. Frontend downloads result from R2 (presigned GET)
```

## Migration Path

### Phase 1: Current State
- Local Python backend with CUDA
- Works for development and single-user

### Phase 2: RunPod Integration
1. Create RunPod serverless template
2. Build and push Docker image with models
3. Add `/debit` endpoint to trigger jobs
4. Add `/status` endpoint for polling
5. Add R2 upload/download to frontend

### Phase 3: Remove Local Backend
1. Frontend talks directly to Cloudflare Workers
2. All GPU work goes to RunPod
3. Local backend only needed for development

## Folder Structure

**Current:**
```
video-editor/
├── src/
│   ├── frontend/           # React app
│   ├── backend/            # Local dev (weights in src/backend/weights/)
│   └── landing/            # Marketing site
│
├── deploy/
│   └── cloudflare/         # Workers + Pages config
│
└── docs/plans/             # All planning docs
    ├── deployment.md
    ├── gpu-architecture.md
    ├── landingpage.md
    └── tasks.md
```

**Future (when RunPod is implemented):**
```
deploy/
└── runpod/                 # TO BE CREATED
    ├── handler.py          # Serverless handler
    ├── Dockerfile          # With WEIGHTS_DIR=/app/weights
    └── requirements.txt
```

## Weights Configuration

Model weights path is configurable via `WEIGHTS_DIR` environment variable:

| Environment | WEIGHTS_DIR | Location |
|-------------|-------------|----------|
| Local dev | (default) | `src/backend/weights/` |
| RunPod | `/app/weights` | Baked into Docker image |
