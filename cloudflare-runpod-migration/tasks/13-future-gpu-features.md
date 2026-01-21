# Task 13: Future GPU Features

## Overview
Planned GPU-powered features to add after the core export pipeline is working. These features differentiate the product with quality that browser-based inference can't match.

## Owner
**Claude** - Code generation when ready to implement

## Prerequisites
- Task 08 complete (GPU worker infrastructure working)
- Core export pipeline tested and stable

## Time Estimate
Variable per feature

---

## Planned Features

### 1. Video Upscaling (4x Super Resolution)

**Purpose**: Upscale low-resolution game footage to crisp 4K quality.

**Models**:
| Model | Quality | Speed | VRAM |
|-------|---------|-------|------|
| RealESRGAN_x4plus | Best | Slow | 4GB |
| SwinIR_4x_GAN | Good | Medium | 3GB |
| ESRGAN_4x | Decent | Fast | 2GB |

**API Spec**:
```python
# Input
{
    "task": "upscale",
    "input_url": "https://r2.../input.mp4",
    "output_url": "https://r2.../output.mp4",
    "params": {
        "model": "RealESRGAN_x4plus",
        "scale": 4,
        "denoise_strength": 0.5,  # 0-1, higher = more denoising
        "face_enhance": false      # Use GFPGAN for faces
    }
}

# Output
{
    "status": "completed",
    "output_url": "https://r2.../output.mp4",
    "stats": {
        "input_resolution": "720x480",
        "output_resolution": "2880x1920",
        "frames_processed": 900,
        "processing_time_sec": 45.2
    }
}
```

**Implementation Notes**:
- Process frame-by-frame through model
- Reassemble with FFmpeg at original framerate
- Consider chunking for long videos (memory management)

**Cost Estimate**: ~$0.30 per minute of video (RTX 4000 Ada)

---

### 2. Object/Player Tracking (YOLO)

**Purpose**: Automatically detect and track players/ball for smart cropping.

**Models**:
| Model | Accuracy | Speed | Use Case |
|-------|----------|-------|----------|
| YOLOv8n | Good | Very Fast | Real-time |
| YOLOv8m | Better | Fast | Recommended |
| YOLOv8x | Best | Slower | High accuracy |

**API Spec**:
```python
# Input
{
    "task": "track",
    "input_url": "https://r2.../input.mp4",
    "params": {
        "model": "yolov8m",
        "classes": ["person", "sports ball"],
        "confidence_threshold": 0.5,
        "iou_threshold": 0.45,
        "track_algorithm": "botsort"  # or "bytetrack"
    }
}

# Output
{
    "status": "completed",
    "tracks": [
        {
            "track_id": 1,
            "class": "person",
            "frames": [
                {"frame": 0, "bbox": [100, 50, 200, 300], "confidence": 0.92},
                {"frame": 1, "bbox": [102, 51, 202, 301], "confidence": 0.91},
                // ... more frames
            ]
        },
        {
            "track_id": 2,
            "class": "sports ball",
            "frames": [...]
        }
    ],
    "stats": {
        "total_frames": 900,
        "unique_tracks": 15,
        "processing_time_sec": 12.5
    }
}
```

**Use Cases**:
- Auto-generate crop keyframes following a player
- Create highlight detection (player near ball = action)
- Generate "follow cam" effect automatically

**Cost Estimate**: ~$0.10 per minute of video

---

### 3. Smart Auto-Crop

**Purpose**: Automatically crop video to follow the action.

**Approach**:
1. Run object tracking (Task 2)
2. Identify "subject" (main player, ball, etc.)
3. Generate smooth crop keyframes that follow subject
4. Apply crop with padding for natural movement

**API Spec**:
```python
# Input
{
    "task": "auto_crop",
    "input_url": "https://r2.../input.mp4",
    "output_url": "https://r2.../output.mp4",
    "params": {
        "target_aspect": "9:16",  # Vertical for social
        "subject": "auto",        # or specific track_id
        "smoothing": 0.8,         # 0-1, higher = smoother camera
        "padding": 0.2,           # Extra space around subject (20%)
        "anticipation": 0.5       # Look ahead for movement (seconds)
    }
}

# Output
{
    "status": "completed",
    "output_url": "https://r2.../output.mp4",
    "crop_keyframes": [
        {"frame": 0, "x": 100, "y": 0, "width": 607, "height": 1080},
        {"frame": 30, "x": 150, "y": 0, "width": 607, "height": 1080},
        // ... generated keyframes
    ]
}
```

**Smoothing Algorithm**:
```python
def smooth_crop_path(raw_positions, smoothing=0.8):
    """Apply exponential smoothing to crop positions"""
    smoothed = [raw_positions[0]]
    for i in range(1, len(raw_positions)):
        smoothed.append(
            smoothing * smoothed[-1] + (1 - smoothing) * raw_positions[i]
        )
    return smoothed
```

---

### 4. Scene Detection

**Purpose**: Automatically detect cuts/transitions for clip segmentation.

**API Spec**:
```python
# Input
{
    "task": "detect_scenes",
    "input_url": "https://r2.../input.mp4",
    "params": {
        "threshold": 30,      # Sensitivity (lower = more scenes)
        "min_scene_length": 1.0  # Minimum seconds per scene
    }
}

# Output
{
    "status": "completed",
    "scenes": [
        {"start_frame": 0, "end_frame": 150, "start_time": 0.0, "end_time": 5.0},
        {"start_frame": 151, "end_frame": 400, "start_time": 5.03, "end_time": 13.33},
        // ...
    ],
    "stats": {
        "total_scenes": 12,
        "avg_scene_length": 8.5
    }
}
```

**Use Case**: Help users quickly segment long game footage into clips.

---

### 5. Action Detection (Future)

**Purpose**: Detect specific sports actions (goal, save, foul, etc.)

**Approach**:
- Fine-tuned model on sports action dataset
- Or use LLM vision model for classification

This is more research-oriented and would come later.

---

## Docker Image Updates

When adding new features, update `gpu-worker/Dockerfile`:

```dockerfile
FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

# ... existing setup ...

# Add new model dependencies
RUN pip install \
    realesrgan \
    basicsr \
    ultralytics \
    scenedetect

# Pre-download model weights for fast cold start
RUN python -c "from realesrgan import RealESRGANer; RealESRGANer(scale=4, model_path='weights/RealESRGAN_x4plus.pth')" || true
RUN python -c "from ultralytics import YOLO; YOLO('yolov8m.pt')" || true

# Copy weights baked into image
COPY weights/ /app/weights/
ENV WEIGHTS_DIR=/app/weights
```

---

## Weights Management

Model weights should be:
1. **Baked into Docker image** for fast cold starts
2. **Stored in `WEIGHTS_DIR`** environment variable location

| Model | Size | Download |
|-------|------|----------|
| RealESRGAN_x4plus | 64MB | [GitHub](https://github.com/xinntao/Real-ESRGAN) |
| YOLOv8m | 52MB | Auto-downloads via ultralytics |
| GFPGAN (face) | 348MB | [GitHub](https://github.com/TencentARC/GFPGAN) |

---

## Cost Summary

| Feature | GPU Time (30s video) | Cost |
|---------|---------------------|------|
| Export (current) | ~15s | $0.005 |
| Upscale 4x | ~60s | $0.019 |
| Track | ~20s | $0.006 |
| Auto-crop | ~25s | $0.008 |
| Scene detect | ~5s | $0.002 |

Prices based on RTX 4000 Ada @ $0.00031/sec

---

## Implementation Priority

1. **Track** - Enables smart cropping, most user value
2. **Auto-crop** - Uses tracking, big time saver
3. **Upscale** - Quality differentiator
4. **Scene detect** - Nice to have

---

## Handoff Notes

These features build on the core GPU worker infrastructure. When ready to implement:

1. Add new processor file (e.g., `processors/upscale.py`)
2. Update `handler.py` to route new task types
3. Update Docker image with new dependencies
4. Test locally, then deploy to RunPod
5. Add frontend UI for new features
