# AI Upscaling Dependencies Installation Guide

This guide explains how to install the AI upscaling dependencies for the video editor backend.

## Prerequisites

- Python 3.11 or higher
- pip package manager
- For GPU acceleration: NVIDIA GPU with CUDA support

## Quick Installation

### Option 1: Install from requirements.txt (Recommended)

```bash
cd src/backend
pip install -r requirements.txt
```

### Option 2: Manual Installation

#### Step 1: Install PyTorch

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

#### Step 2: Install AI Upscaling Dependencies

```bash
pip install opencv-python numpy pillow wget tqdm
pip install facexlib gfpgan
pip install git+https://github.com/xinntao/Real-ESRGAN.git
```

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

### Issue: "No module named 'torchvision.transforms.functional_tensor'"

**Cause:** Version incompatibility between torchvision and basicsr/realesrgan.

**Solution:** Install Real-ESRGAN from source (already included in requirements.txt):
```bash
pip install git+https://github.com/xinntao/Real-ESRGAN.git
```

### Issue: "CUDA out of memory"

**Cause:** GPU doesn't have enough memory for the current tile size.

**Solution:** The code already uses tiling (512x512) to reduce memory usage. If you still get errors, you can reduce the tile size in `ai_upscaler.py`:
```python
# Change line ~101 from:
tile=512,
# To:
tile=256,  # or even 128 for very low memory GPUs
```

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

## Performance Notes

- **GPU (CUDA):**
  - Fast processing (~2-5 seconds per frame)
  - Requires NVIDIA GPU with at least 4GB VRAM
  - Recommended for production use

- **CPU:**
  - Slower processing (~10-30 seconds per frame)
  - Works on any system
  - Suitable for testing or low-volume processing

## Additional Resources

- [PyTorch Installation Guide](https://pytorch.org/get-started/locally/)
- [CUDA Toolkit Download](https://developer.nvidia.com/cuda-downloads)
- [Real-ESRGAN GitHub](https://github.com/xinntao/Real-ESRGAN)
