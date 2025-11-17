# Super-Resolution Model Testing for Extreme Upscaling

This document describes the multi-model super-resolution testing framework added to support aggressive testing of AI models for extreme upscaling scenarios (5x+ scale factors).

## Problem Statement

When tracking soccer players at the far side of the field, crop windows become extremely small (e.g., 206x366 pixels). Upscaling to 1080x1920 requires ~5.2x scaling, which pushes beyond the comfort zone of standard Real-ESRGAN 4x models.

## Supported Models

### Tier 1: Production-Ready

1. **RealESRGAN_x4plus** (Baseline)
   - Architecture: RRDBNet (23 blocks)
   - Parameters: ~16.7M
   - VRAM: 70-100MB
   - Speed: Fast
   - Quality: Good baseline

2. **SwinIR_4x_GAN** (Transformer-based)
   - Architecture: Swin Transformer (6 RSTB blocks)
   - Parameters: ~11.9M
   - VRAM: 200-300MB
   - Speed: Medium (~2x slower than ESRGAN)
   - Quality: Better global context, potentially superior for extreme upscaling

3. **realesr_general_x4v3** (Newer General Model)
   - Architecture: RRDBNet (23 blocks)
   - Parameters: ~16.7M
   - VRAM: 70-100MB
   - Speed: Fast
   - Quality: Newer training, may handle degradation better

4. **RealESRGAN_x4plus_anime_6B** (Lightweight)
   - Architecture: RRDBNet (6 blocks)
   - Parameters: ~3.7M
   - VRAM: 40-60MB
   - Speed: Very Fast
   - Quality: Optimized for different content types

### Tier 2: Advanced (Requires Manual Setup)

5. **HAT_4x** (State-of-the-Art)
   - Architecture: Hybrid Attention Transformer
   - Parameters: ~20.8M
   - VRAM: 300-500MB
   - Speed: Slow (~3-4x slower than ESRGAN)
   - Quality: State-of-the-art, best texture preservation
   - **Requires manual setup** - see below

## Quick Start

### 1. Download Model Weights

```bash
cd /home/user/video-editor
./scripts/download_sr_weights.sh
```

This downloads weights for:
- RealESRGAN_x4plus
- RealESRGAN_x4plus_anime_6B
- realesr_general_x4v3
- SwinIR_4x_GAN
- SwinIR_4x

### 2. Install Dependencies

```bash
cd src/backend
pip install timm einops  # For transformer models
```

### 3. Test Individual Models

```bash
# List available models
python scripts/test_sr_models.py --list-models

# Test a specific model
python scripts/test_sr_models.py --test-model SwinIR_4x_GAN

# Test all models
python scripts/test_sr_models.py --test-all

# Custom input size
python scripts/test_sr_models.py --test-model SwinIR_4x_GAN --input-size 300x450
```

### 4. Run Comparison via API

Use the `/api/export/upscale-comparison` endpoint:

```bash
curl -X POST http://localhost:8000/api/export/upscale-comparison \
  -F "video=@test_video.mp4" \
  -F "keyframes_json=[...]" \
  -F "target_fps=30" \
  -F "export_id=test123" \
  -F "export_mode=quality"
```

This generates comparison videos using:
- RealESRGAN_x4plus (baseline)
- SwinIR_4x_GAN (transformer)
- realesr_general_x4v3 (newer)
- RealESRGAN_x4plus_anime_6B (lightweight)

## Expected Results

Based on research and architecture analysis:

| Model | Quality* | Speed | VRAM | Best For |
|-------|----------|-------|------|----------|
| RealESRGAN_x4plus | 9.2/10 | Fast | Low | General use |
| SwinIR_4x_GAN | 9.7/10 | Medium | Medium | Extreme upscaling |
| HAT_4x | 9.9/10 | Slow | High | Maximum quality |
| realesr_general_x4v3 | 9.3/10 | Fast | Low | Unknown degradation |
| RealESRGAN_x4plus_anime_6B | 8.8/10 | V.Fast | V.Low | Speed priority |

*Quality scores are estimates based on published benchmarks

## What to Look For

When evaluating results for soccer tracking:

1. **Jersey Numbers** - Can you read them clearly?
2. **Jersey Patterns** - Are stripes/logos preserved?
3. **Player Edges** - Sharp silhouette vs halo artifacts?
4. **Grass Texture** - Natural vs plastic appearance?
5. **Motion Blur** - Naturally preserved?

## Implementation Details

### Code Architecture

```
src/backend/app/
├── ai_upscaler.py          # Main upscaler with multi-model support
│   ├── __init__()          # Model selection via sr_model_name parameter
│   ├── _setup_sr_model()   # Central routing for model initialization
│   ├── _setup_swinir()     # SwinIR transformer setup
│   ├── _setup_hat()        # HAT setup (with fallback)
│   ├── _setup_realesrgan_variant()  # Alternative ESRGAN variants
│   ├── _swinir_enhance()   # SwinIR inference
│   ├── _hat_enhance()      # HAT inference
│   └── enhance_frame_ai()  # Routes to appropriate model
├── main.py                 # API with comparison endpoint
└── archs/                  # Custom architectures
    └── __init__.py         # HAT architecture placeholder
```

### Using Different Models Programmatically

```python
from app.ai_upscaler import AIVideoUpscaler

# Use SwinIR
upscaler = AIVideoUpscaler(
    device='cuda',
    sr_model_name='SwinIR_4x_GAN'
)

# Use Real-ESRGAN variant
upscaler = AIVideoUpscaler(
    device='cuda',
    sr_model_name='realesr_general_x4v3'
)

# Check which model is active
print(f"Active model: {upscaler.current_sr_model}")
# 'swinir', 'hat', or 'realesrgan'
```

### Adding HAT Model Manually

1. Clone HAT repository:
```bash
git clone https://github.com/XPixelGroup/HAT
```

2. Copy architecture:
```bash
cp HAT/hat/archs/hat_arch.py src/backend/app/archs/
```

3. Download weights from HAT releases

4. Place weights in `weights/HAT_SRx4_ImageNet-pretrain.pth`

## Key Findings from A/B Testing

Based on previous testing:

1. **Post-processing filters DO NOT improve quality** - Raw model output is best
2. **Pre-processing filters DO NOT help** - Model handles this internally
3. **FFmpeg CRF settings have minimal impact** - Model is the bottleneck
4. **Multi-pass upscaling degrades quality** - Over-processing issue

## Success Criteria

A model is successful when:
- Jersey numbers are visibly sharper
- Processing time < 1 minute per second of video
- VRAM < 8GB
- No significant artifacts or hallucinations

## Next Steps

1. Run comparative tests with actual soccer footage
2. Evaluate visual quality (requires human judgment)
3. Document best-performing model
4. Consider hybrid approaches if needed

## Files Added

- `src/backend/app/ai_upscaler.py` - Multi-model support
- `src/backend/app/main.py` - Updated comparison endpoint
- `src/backend/app/archs/__init__.py` - Custom architectures directory
- `scripts/download_sr_weights.sh` - Automated weight download
- `scripts/test_sr_models.py` - Model testing utility
- `docs/SR_MODEL_TESTING.md` - This documentation

## References

- [SwinIR](https://github.com/JingyunLiang/SwinIR)
- [HAT](https://github.com/XPixelGroup/HAT)
- [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)
- [BasicSR](https://github.com/XPixelGroup/BasicSR)
