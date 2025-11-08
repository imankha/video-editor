# Multi-GPU AI Upscaling Guide

## Overview

The video editor now supports **multi-GPU parallel processing** for AI upscaling, which can dramatically speed up video processing when multiple GPUs are available.

## How It Works

### Automatic GPU Detection

When the AI upscaler initializes, it automatically:

1. **Detects all available CUDA GPUs** using `torch.cuda.device_count()`
2. **Lists each GPU** with its name and capabilities
3. **Creates separate Real-ESRGAN model instances** for each GPU
4. **Distributes frames** across GPUs using round-robin assignment

### Frame Distribution

Frames are distributed across GPUs in a round-robin fashion:

```
GPU 0: frames 0, 4, 8, 12, ...
GPU 1: frames 1, 5, 9, 13, ...
GPU 2: frames 2, 6, 10, 14, ...
GPU 3: frames 3, 7, 11, 15, ...
```

This ensures even workload distribution and maximum GPU utilization.

### Parallel Processing

The system uses Python's `ThreadPoolExecutor` to process multiple frames simultaneously:

- **Number of worker threads** = Number of available GPUs
- Each worker thread processes frames on its assigned GPU
- Frames are processed in parallel across all GPUs
- Results are collected in a thread-safe manner
- Progress tracking is synchronized using thread locks

## Performance Improvements

### Expected Speedup

With multi-GPU processing, you can expect:

| GPUs | Theoretical Speedup | Typical Speedup |
|------|---------------------|-----------------|
| 1 GPU | 1.0x (baseline) | 1.0x |
| 2 GPUs | 2.0x | 1.8-1.9x |
| 3 GPUs | 3.0x | 2.6-2.8x |
| 4 GPUs | 4.0x | 3.4-3.7x |

*Note: Actual speedup may be slightly less than theoretical due to I/O overhead and synchronization costs.*

### Example Processing Times

For a 150-frame video at 4K resolution:

| Configuration | Processing Time | Speedup |
|---------------|----------------|---------|
| Single GPU (RTX 3090) | ~5-10 minutes | 1.0x |
| 2x RTX 3090 | ~2.5-5 minutes | 1.9x |
| 4x RTX 3090 | ~1.5-3 minutes | 3.5x |

## System Requirements

### Hardware Requirements

- **Multiple CUDA-capable GPUs** (NVIDIA only)
- **Sufficient VRAM per GPU**: 6-8GB minimum for 4K upscaling
- **PCIe bandwidth**: PCIe 3.0 x8 or better recommended

### Software Requirements

- **PyTorch with CUDA support**: Version 2.0.0 or later
- **CUDA Toolkit**: 11.8 or later
- **GPU drivers**: Latest NVIDIA drivers recommended

## Configuration

### Enabling/Disabling Multi-GPU

Multi-GPU processing is **enabled by default**. To disable it:

```python
upscaler = AIVideoUpscaler(
    model_name='RealESRGAN_x4plus',
    device='cuda',
    enable_multi_gpu=False  # Disable multi-GPU, use only GPU 0
)
```

### GPU Selection

The system automatically uses all detected GPUs. To use specific GPUs, set the `CUDA_VISIBLE_DEVICES` environment variable before starting the backend:

```bash
# Use only GPUs 0 and 2
export CUDA_VISIBLE_DEVICES=0,2
python app/main.py

# Use only GPU 1
export CUDA_VISIBLE_DEVICES=1
python app/main.py
```

## Monitoring

### Log Output

When multi-GPU is enabled, you'll see detailed logging:

```
============================================================
GPU DETECTION
============================================================
CUDA available: Yes
CUDA version: 11.8
Number of GPUs detected: 4
  GPU 0: NVIDIA GeForce RTX 3090
  GPU 1: NVIDIA GeForce RTX 3090
  GPU 2: NVIDIA GeForce RTX 3090
  GPU 3: NVIDIA GeForce RTX 3090
✓ Multi-GPU mode ENABLED - will use all 4 GPUs in parallel
============================================================
```

### Processing Logs

During processing, you'll see which GPU is handling each frame:

```
GPU 0: Processed frame 0 @ 0.00s
GPU 1: Processed frame 30 @ 1.00s
GPU 2: Processed frame 60 @ 2.00s
GPU 3: Processed frame 90 @ 3.00s
```

### GPU Utilization

You can monitor GPU utilization in real-time using:

```bash
# Watch GPU usage
watch -n 1 nvidia-smi

# Or use detailed monitoring
nvidia-smi dmon -s u
```

## Troubleshooting

### Common Issues

#### 1. "Only 1 GPU detected" when you have multiple GPUs

**Cause**: GPUs may not be visible to PyTorch

**Solution**:
```bash
# Check if all GPUs are visible
nvidia-smi

# Verify PyTorch can see them
python -c "import torch; print(f'GPUs: {torch.cuda.device_count()}')"

# If PyTorch doesn't see all GPUs, reinstall with CUDA support
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

#### 2. "CUDA out of memory" errors

**Cause**: Insufficient VRAM on one or more GPUs

**Solutions**:
- Reduce the number of GPUs used via `CUDA_VISIBLE_DEVICES`
- Use GPUs with more VRAM
- Process smaller videos or reduce target resolution
- Enable tiled processing (for lower VRAM usage)

#### 3. Slower performance with multi-GPU

**Cause**: I/O bottleneck or unbalanced GPU capabilities

**Solutions**:
- Ensure video file is on a fast SSD (not HDD)
- Verify all GPUs are similar models/performance
- Check PCIe bandwidth with `nvidia-smi topo -m`
- Disable multi-GPU if GPUs are very different (`enable_multi_gpu=False`)

#### 4. Frames processed out of order

**Note**: This is **normal behavior**. The system processes frames in parallel and saves them as they complete. The final video is reassembled correctly using the frame numbering system (`frame_000000.png`, `frame_000001.png`, etc.).

### Memory Management

The system automatically manages GPU memory:

- **Periodic cleanup**: GPU cache is cleared after all frames are processed
- **Per-GPU cleanup**: Each GPU's memory is individually managed
- **Thread-safe operations**: Memory operations are synchronized to prevent conflicts

### Error Handling

If a frame fails to process:
- The error is logged with the frame number and GPU ID
- Processing continues for other frames
- A final error report lists all failed frames
- The export will fail if any frames couldn't be processed

## Best Practices

### 1. Use Matched GPUs

For best performance, use GPUs of the same model:
- ✅ Good: 4x RTX 3090
- ⚠️ Okay: 2x RTX 3090 + 2x RTX 3080
- ❌ Poor: 1x RTX 3090 + 1x GTX 1080 (very different performance)

### 2. Ensure Adequate Cooling

Multi-GPU processing generates significant heat:
- Monitor GPU temperatures during processing
- Ensure adequate case airflow
- Consider GPU spacing for better cooling

### 3. Power Supply

Ensure your PSU can handle all GPUs under load:
- Each RTX 3090 can draw 350W
- 4x RTX 3090 = 1400W + system overhead = ~1600W total
- Recommended: 1600W+ PSU for 4x high-end GPUs

### 4. Storage Performance

Use fast storage for best results:
- ✅ Best: NVMe SSD (PCIe 4.0)
- ✅ Good: NVMe SSD (PCIe 3.0)
- ⚠️ Okay: SATA SSD
- ❌ Poor: HDD (will bottleneck multi-GPU performance)

## Technical Details

### Architecture

```
AIVideoUpscaler
├── __init__()
│   ├── Detect GPUs (torch.cuda.device_count())
│   ├── Create upsampler instances (one per GPU)
│   └── Initialize threading locks
│
├── process_video_with_upscale()
│   ├── Prepare frame tasks with GPU assignments
│   ├── Create ThreadPoolExecutor(max_workers=num_gpus)
│   ├── Submit tasks to executor
│   ├── Collect results with thread-safe progress tracking
│   └── Save frames in correct order
│
└── process_single_frame()
    ├── Extract and crop frame
    ├── Get upsampler for assigned GPU
    ├── AI upscale on specific GPU
    └── Return enhanced frame
```

### Thread Safety

- **Progress tracking**: Protected by `self.progress_lock`
- **Frame saving**: Sequential writes (no conflicts)
- **GPU memory**: Per-GPU context isolation
- **Model instances**: Separate instances per GPU (no shared state)

### Memory Usage

Per-GPU memory usage (approximate):

| Component | VRAM Usage |
|-----------|------------|
| Real-ESRGAN model | ~1.5 GB |
| Input frame (4K) | ~25 MB |
| Output frame (4K) | ~25 MB |
| Processing overhead | ~0.5 GB |
| **Total per GPU** | **~2-3 GB** |

For full-frame processing (no tiling), add:
- **4K processing buffer**: ~4-6 GB

**Total recommended VRAM per GPU**: **6-8 GB minimum**

## Future Improvements

Potential enhancements for even better performance:

1. **Batch processing**: Process multiple frames per GPU call
2. **Frame prefetching**: Pre-load frames into memory to hide I/O latency
3. **Dynamic load balancing**: Adjust workload based on GPU performance
4. **GPU affinity tuning**: Optimize CPU thread to GPU assignment
5. **Mixed precision optimizations**: Further FP16/INT8 optimizations

## Conclusion

Multi-GPU support provides significant speedups for AI video upscaling. With proper hardware and configuration, processing times can be reduced by up to 3-4x when using 4 GPUs, making 4K AI upscaling much more practical for production workflows.
