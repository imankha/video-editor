# AI Upscaling Feature

## Overview

The AI Upscaling feature enhances video exports by:
1. **De-zooming**: Removing digital zoom/crop effects by extracting the actual cropped regions
2. **AI Enhancement**: Upscaling each frame using Real-ESRGAN deep learning model
3. **Smart Resolution**: Automatically targeting optimal resolutions based on aspect ratio

## How It Works

### De-Zoom Process

When you apply crop keyframes to a video, you're essentially creating a digital zoom effect. The "de-zoom" step extracts just the cropped portion of each frame at its native resolution, removing any digital scaling.

**Example:**
- Original video: 1920x1080
- Crop keyframe at 2s: x=480, y=270, width=960, height=540 (cropped to center 25%)
- De-zoom result: Extract just that 960x540 region

This ensures the AI upscaling works with the actual cropped content rather than digitally zoomed pixels.

### AI Upscaling

After de-zooming, each frame is upscaled using Real-ESRGAN, a state-of-the-art AI model that:
- Adds realistic detail and texture
- Reduces artifacts and noise
- Intelligently enhances edges and features
- Processes in 512x512 tiles for memory efficiency

### Target Resolutions

The system automatically detects aspect ratio and sets appropriate targets:

| Aspect Ratio | Detection Range | Target Resolution | Use Case |
|--------------|----------------|-------------------|----------|
| 16:9 | 1.7 - 1.8 | 3840x2160 (4K) | Horizontal videos |
| 9:16 | 0.55 - 0.6 | 1080x1920 | Vertical/mobile videos |
| Other | Any | Proportional to closest standard | Custom ratios |

## API Endpoints

### POST `/api/export/upscale`

Export video with AI upscaling and de-zoom.

**Request:**
```
Content-Type: multipart/form-data

video: [video file]
keyframes_json: JSON string of crop keyframes
target_fps: (optional) output framerate, default 30
```

**Keyframes JSON Format:**
```json
[
  {
    "time": 0.0,
    "x": 0,
    "y": 0,
    "width": 1920,
    "height": 1080
  },
  {
    "time": 5.0,
    "x": 480,
    "y": 270,
    "width": 960,
    "height": 540
  }
]
```

**Response:**
- Content-Type: `video/mp4`
- File: AI-upscaled video

## Frontend Integration

The ExportButton component now includes an AI upscale option:

```jsx
<div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
  <label className="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      checked={useAIUpscale}
      onChange={(e) => setUseAIUpscale(e.target.checked)}
    />
    <div>
      <div className="text-sm font-medium">AI Upscale Export</div>
      <div className="text-xs text-gray-400">
        De-zoom and upscale to 4K (16:9) or 1080x1920 (9:16)
      </div>
    </div>
  </label>
</div>
```

When checked, the export button uses `/api/export/upscale` instead of `/api/export/crop`.

## Architecture

### Backend Components

**`app/ai_upscaler.py`** - Main upscaling service
- `AIVideoUpscaler` class
- Model initialization and management
- Frame extraction with crop
- Interpolation between keyframes
- AI enhancement
- Video reassembly

**`app/main.py`** - API endpoint
- `/api/export/upscale` endpoint
- Request handling
- Progress logging
- Error handling

### Processing Pipeline

```
1. Upload video + keyframes
   ↓
2. Initialize Real-ESRGAN model
   ↓
3. For each frame:
   - Calculate crop at current time (interpolate keyframes)
   - Extract cropped region (de-zoom)
   - AI upscale to target resolution
   - Save enhanced frame
   ↓
4. Reassemble frames with FFmpeg
   ↓
5. Return upscaled video
```

## Dependencies

The AI upscaling feature requires:

```
torch>=2.0.0              # PyTorch for deep learning
torchvision>=0.15.0       # Computer vision utilities
opencv-python>=4.8.0      # Image/video processing
numpy>=1.24.0             # Numerical computing
basicsr>=1.4.2            # Basic SR framework
realesrgan>=0.3.0         # Real-ESRGAN model
wget>=3.2                 # Download model weights
tqdm>=4.65.0              # Progress bars
```

### Installation

```bash
cd src/backend
pip install -r requirements.txt
```

**Note:** GPU (CUDA) support is highly recommended for reasonable processing speeds. The code will automatically fall back to CPU if CUDA is not available, but processing will be significantly slower.

## Model Weights

On first use, the system will automatically download the Real-ESRGAN model weights (~67MB):
- Model: RealESRGAN_x4plus
- Source: https://github.com/xinntao/Real-ESRGAN
- Location: `weights/RealESRGAN_x4plus.pth`

## Performance Considerations

### GPU vs CPU
- **GPU (CUDA)**: ~2-5 fps processing speed
- **CPU**: ~0.1-0.5 fps processing speed

### Memory Usage
- Model uses tiling (512x512 chunks) to stay within GPU memory limits
- Typical GPU memory: 4-8GB
- CPU fallback available for systems without CUDA

### Processing Time Estimates

For a 30-second video at 30fps (900 frames):
- **With GPU**: ~3-7 minutes
- **With CPU**: ~30-60 minutes

## Example Usage

### Simple Case (Single Crop)

```python
keyframes = [
    {
        "time": 0.0,
        "x": 240,
        "y": 135,
        "width": 1440,
        "height": 810
    }
]
```

This extracts a 1440x810 region from the center and upscales to 4K.

### Animated Crop

```python
keyframes = [
    {
        "time": 0.0,
        "x": 0,
        "y": 0,
        "width": 1920,
        "height": 1080
    },
    {
        "time": 5.0,
        "x": 480,
        "y": 270,
        "width": 960,
        "height": 540
    }
]
```

This creates a zoom-in effect from full frame to 50% crop over 5 seconds, then de-zooms and upscales each frame to 4K.

## Troubleshooting

### CUDA Out of Memory
If you get CUDA OOM errors:
1. The model uses 512x512 tiling by default
2. Reduce tile size in `ai_upscaler.py` (line ~75)
3. Or use CPU mode (slower but no memory limits)

### Model Download Fails
If automatic download fails:
1. Manually download from: https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth
2. Place in `src/backend/weights/` directory

### Processing Too Slow
For faster processing:
- Use GPU with CUDA support
- Reduce `target_fps` (e.g., 24 instead of 30)
- Process shorter video segments

## Future Enhancements

Potential improvements:
- [ ] Multiple AI models (RealESRGAN_x2plus, anime models)
- [ ] Real-time progress updates via WebSocket
- [ ] Batch processing multiple videos
- [ ] Custom resolution targets
- [ ] Hardware acceleration (NVENC for encoding)
- [ ] Frame interpolation for slow-motion
- [ ] Quality presets (fast/balanced/best)

## Credits

This feature uses:
- **Real-ESRGAN**: https://github.com/xinntao/Real-ESRGAN
- **BasicSR**: https://github.com/XPixelGroup/BasicSR
- **FFmpeg**: https://ffmpeg.org/
