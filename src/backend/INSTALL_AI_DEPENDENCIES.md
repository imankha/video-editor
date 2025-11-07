# AI Upscaling Dependencies Installation Guide

This guide explains how to install the AI upscaling dependencies for the video editor backend.

## Prerequisites

- Python 3.11 or higher
- pip package manager
- For GPU acceleration: NVIDIA GPU with CUDA support

## Quick Installation

**Important:** PyTorch must be installed separately with the correct CUDA version before installing other dependencies.

### Step 1: Install PyTorch with CUDA Support

**For GPU (CUDA 11.8):**
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

**For GPU (CUDA 12.1):**
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

**For CPU only:**
```bash
pip install torch torchvision
```

**Why install PyTorch separately?** Installing PyTorch from the CUDA-specific index prevents pip from auto-installing unnecessary dependencies like torchaudio, which isn't used by the video editor.

### Step 2: Install Remaining Dependencies

```bash
cd src/backend
pip install -r requirements.txt
```

This will install:
- NumPy (compatible version)
- OpenCV
- Pillow (image processing)
- Real-ESRGAN and its dependencies (facexlib, gfpgan)
- Other required packages

## Verifying Installation

### Check PyTorch Installation

```bash
python -c "import torch; print(f'PyTorch: {torch.__version__}'); print(f'CUDA available: {torch.cuda.is_available()}')"
```

Expected output (GPU):
```
PyTorch: 2.x.x
CUDA available: True
```

Expected output (CPU):
```
PyTorch: 2.x.x
CUDA available: False
```

### Check Real-ESRGAN Installation

```bash
python -c "from realesrgan import RealESRGANer; print('Real-ESRGAN: OK')"
```

Expected output:
```
Real-ESRGAN: OK
```

## GPU Support

### Checking GPU Availability

```bash
# Check if NVIDIA GPU is detected
nvidia-smi

# Check CUDA version
nvcc --version
```

### Troubleshooting GPU Issues

If GPU is not detected:

1. **Check NVIDIA drivers are installed:**
   ```bash
   nvidia-smi
   ```
   If this fails, install NVIDIA drivers for your GPU.

2. **Install CUDA toolkit:**
   - Download from: https://developer.nvidia.com/cuda-downloads
   - Or use your system's package manager

3. **Install PyTorch with matching CUDA version:**
   ```bash
   # Check your CUDA version first
   nvidia-smi

   # Then install matching PyTorch version
   # For CUDA 11.8:
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

   # For CUDA 12.1:
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
   ```

## Common Issues

### Issue: "Numpy is not available" or NumPy/OpenCV version conflict

**Cause:** Version incompatibility between NumPy, OpenCV, and PyTorch.
- NumPy 2.x is incompatible with PyTorch/Real-ESRGAN (need NumPy 1.x)
- OpenCV 4.12+ requires NumPy 2.x but we need NumPy 1.x
- Solution: Use OpenCV 4.8-4.9 which works with NumPy 1.x

**Error messages you might see:**
```
A module that was compiled using NumPy 1.x cannot be run in NumPy 2.2.6 as it may crash.
```
```
Error: Numpy is not available
```
```
opencv-python 4.12.0.88 requires numpy<2.3.0,>=2; but you have numpy 1.26.4
```

**Solution:** Install compatible versions:
```bash
pip install 'numpy>=1.24.0,<2.0.0' --force-reinstall
pip install 'opencv-python>=4.8.0,<4.10.0' --force-reinstall
# Or just reinstall from requirements.txt which has correct versions
pip install -r requirements.txt --force-reinstall
# Restart the backend
```

### Issue: "No module named 'torchvision.transforms.functional_tensor'"

**Cause:** Version incompatibility between torchvision and basicsr/realesrgan.

**Solution:** Install Real-ESRGAN from source (already included in requirements.txt):
```bash
pip install git+https://github.com/xinntao/Real-ESRGAN.git
```

### Issue: "CUDA out of memory"

**Cause:** GPU doesn't have enough VRAM for full-frame processing.

**Current behavior:** The system uses full-frame processing (no tiling) on GPU for maximum quality. This requires more VRAM but produces the best results.

**Solution options:**

1. **If you have 8GB+ VRAM:** Should work fine as-is

2. **If you have 4-6GB VRAM:** You may need to enable tiling. Edit `ai_upscaler.py` around line 100:
   ```python
   # Change from:
   if self.device.type == 'cuda':
       tile_size = 0  # No tiling

   # To:
   if self.device.type == 'cuda':
       tile_size = 512  # Use 512x512 tiles
       tile_pad = 10
   ```

3. **If you have <4GB VRAM:** Use smaller tiles:
   ```python
   tile_size = 256  # or even 128 for very low memory
   tile_pad = 10
   ```

Note: Using tiling reduces VRAM requirements but may introduce subtle seams at tile boundaries.

### Issue: "Using device: cpu" when GPU is available

**Possible causes:**

1. **PyTorch not installed with CUDA support:**
   ```bash
   # Reinstall with CUDA support
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118 --force-reinstall
   ```

2. **CUDA version mismatch:**
   - Check your CUDA version: `nvidia-smi`
   - Install matching PyTorch version (see GPU Support section)

3. **CUDA not in PATH:**
   - Add CUDA to your system PATH
   - Linux/Mac: Add to `.bashrc` or `.zshrc`:
     ```bash
     export PATH=/usr/local/cuda/bin:$PATH
     export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
     ```

## Testing the Installation

After installation, start the backend and check the logs:

```bash
cd src/backend
python -m uvicorn app.main:app --reload
```

Look for these log messages:

**Success (GPU):**
```
INFO:app.ai_upscaler:Using device: cuda
INFO:app.ai_upscaler:GPU: NVIDIA GeForce RTX 3090
INFO:app.ai_upscaler:CUDA version: 11.8
INFO:app.ai_upscaler:✓ Real-ESRGAN model loaded successfully!
```

**Success (CPU):**
```
INFO:app.ai_upscaler:Using device: cpu
INFO:app.ai_upscaler:✓ Real-ESRGAN model loaded successfully!
```

**Failure:**
```
ERROR:app.ai_upscaler:❌ CRITICAL: Real-ESRGAN dependencies not installed!
```

## Performance & Quality Notes

### Quality Settings

The AI upscaler is optimized for **maximum quality**:

- **GPU Mode (Recommended):**
  - Uses full-frame processing (no tiling) for best quality
  - No visible seams or artifacts from tile boundaries
  - Requires NVIDIA GPU with at least 6-8GB VRAM
  - Processing speed: ~2-10 seconds per frame depending on resolution
  - If you get "CUDA out of memory" errors, see troubleshooting below

- **CPU Mode:**
  - Uses tiled processing (512x512 tiles) to manage memory
  - May have subtle seams at tile boundaries
  - Much slower: ~30-60 seconds per frame
  - Only recommended if GPU is not available

### Quality vs Speed Tradeoffs

The current settings prioritize quality over speed:
- No fallback to lower-quality methods - Real-ESRGAN or fail
- Full-frame processing on GPU (no tiling)
- Highest quality interpolation (LANCZOS4) for final resize

For 4K output (3840x2160):
- GPU: ~5-10 minutes for a 150-frame video
- CPU: ~1-2 hours for a 150-frame video

## Additional Resources

- [PyTorch Installation Guide](https://pytorch.org/get-started/locally/)
- [CUDA Toolkit Download](https://developer.nvidia.com/cuda-downloads)
- [Real-ESRGAN GitHub](https://github.com/xinntao/Real-ESRGAN)
