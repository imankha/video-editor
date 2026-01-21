# Task 19: Future GPU Features

## Overview
Planned GPU-powered features to add after the core export pipeline is working. These features differentiate the product with quality that browser-based inference can't match.

## Owner
**Claude** - Code generation when ready to implement

## Prerequisites
- Phase 2 complete (GPU worker infrastructure working)
- Core export pipeline tested and stable

## Status
`FUTURE` - Implement when core features are stable

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

**Implementation**:
- Process frame-by-frame through model
- Reassemble with FFmpeg at original framerate
- Consider chunking for long videos

**Cost**: ~$0.30 per minute of video

---

### 2. Object/Player Tracking (YOLO)

**Purpose**: Automatically detect and track players/ball for smart cropping.

**Models**:
| Model | Accuracy | Speed | Use Case |
|-------|----------|-------|----------|
| YOLOv8n | Good | Very Fast | Real-time |
| YOLOv8m | Better | Fast | Recommended |
| YOLOv8x | Best | Slower | High accuracy |

**Use Cases**:
- Auto-generate crop keyframes following a player
- Create highlight detection (player near ball = action)
- Generate "follow cam" effect automatically

**Cost**: ~$0.10 per minute of video

---

### 3. Smart Auto-Crop

**Purpose**: Automatically crop video to follow the action.

**Approach**:
1. Run object tracking
2. Identify "subject" (main player, ball, etc.)
3. Generate smooth crop keyframes that follow subject
4. Apply crop with padding for natural movement

**Parameters**:
- Target aspect ratio (9:16 for vertical)
- Smoothing factor (higher = smoother camera)
- Padding (extra space around subject)
- Anticipation (look ahead for movement)

---

### 4. Scene Detection

**Purpose**: Automatically detect cuts/transitions for clip segmentation.

**Use Case**: Help users quickly segment long game footage into clips.

**Cost**: ~$0.02 per minute of video

---

### 5. Action Detection (Future)

**Purpose**: Detect specific sports actions (goal, save, foul, etc.)

**Approach**:
- Fine-tuned model on sports action dataset
- Or use LLM vision model for classification

This is more research-oriented and would come later.

---

## Implementation Priority

1. **Track** - Enables smart cropping, most user value
2. **Auto-crop** - Uses tracking, big time saver
3. **Upscale** - Quality differentiator
4. **Scene detect** - Nice to have

---

## Docker Image Updates

When adding features, update `gpu-worker/Dockerfile`:

```dockerfile
FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

# Add dependencies
RUN pip install \
    realesrgan \
    basicsr \
    ultralytics \
    scenedetect

# Pre-download model weights
RUN python -c "from ultralytics import YOLO; YOLO('yolov8m.pt')"

# Bake weights into image
COPY weights/ /app/weights/
```

---

## Weights Management

Model weights should be:
1. **Baked into Docker image** for fast cold starts
2. **Stored in `WEIGHTS_DIR`** environment variable location

| Model | Size | Source |
|-------|------|--------|
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

## Handoff Notes

These features build on the core GPU worker infrastructure. When ready to implement:

1. Add new processor file (e.g., `processors/upscale.py`)
2. Update `handler.py` to route new task types
3. Update Docker image with new dependencies
4. Test locally, then deploy to RunPod
5. Add frontend UI for new features
