# AI Upscaling Dependencies Installation Guide

This guide helps you install and troubleshoot the Real-ESRGAN AI upscaling dependencies for the Video Editor.

## Quick Fix for Common Errors

If you see the error:
```
Real-ESRGAN model failed to load
```

Run these commands in order:

```bash
cd src/backend
source .venv/bin/activate  # If using virtual environment

# Fix version conflicts
pip install 'numpy>=1.24.0,<2.0.0' --force-reinstall
pip install 'opencv-python>=4.8.0,<4.10.0' --force-reinstall

# Reinstall all dependencies
pip install -r requirements.txt

# Restart the backend
python -m uvicorn app.main:app --reload
```

## Version Requirements

The AI upscaling feature has strict version requirements:

| Package | Required Version | Why |
|---------|-----------------|-----|
| **NumPy** | >= 1.24.0, < 2.0.0 | NumPy 2.0+ breaks PyTorch/Real-ESRGAN compatibility |
| **OpenCV** | >= 4.8.0, < 4.10.0 | OpenCV 4.10+ requires NumPy 2.0 |
| **PyTorch** | >= 2.0.0, < 2.5.0 | CUDA 11.8 support, Real-ESRGAN compatibility |
| **torchvision** | >= 0.15.0, < 0.20.0 | Must match PyTorch version |

## Fresh Installation

For a clean installation:

```bash
cd src/backend

# Remove old virtual environment (if exists)
rm -rf .venv

# Run setup script
./setup.sh
```

The setup script will:
1. Create a new virtual environment
2. Install NumPy and OpenCV with correct versions FIRST
3. Install remaining dependencies
4. Verify all version constraints are met

## Manual Verification

Check your installed versions:

```bash
python << 'EOF'
import numpy as np
import cv2
import torch

print(f"NumPy: {np.__version__} (must be < 2.0.0)")
print(f"OpenCV: {cv2.__version__} (must be 4.8.x or 4.9.x)")
print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA version: {torch.version.cuda}")
EOF
```

Expected output:
```
NumPy: 1.26.4 (must be < 2.0.0)
OpenCV: 4.9.0.80 (must be 4.8.x or 4.9.x)
PyTorch: 2.4.1
CUDA available: True
CUDA version: 11.8
```

## Troubleshooting

### Error: "NumPy 2.0 breaks Real-ESRGAN"

**Symptoms:**
- `AttributeError: module 'numpy' has no attribute 'float'`
- `TypeError: cannot unpack non-iterable NoneType object`
- Model fails to initialize

**Fix:**
```bash
pip install 'numpy>=1.24.0,<2.0.0' --force-reinstall
pip install 'opencv-python>=4.8.0,<4.10.0' --force-reinstall
```

### Error: "BasicSR import failed"

**Symptoms:**
- `ImportError: cannot import name 'RRDBNet'`
- `ModuleNotFoundError: No module named 'basicsr'`

**Fix:**
```bash
pip install git+https://github.com/XPixelGroup/BasicSR.git --force-reinstall
```

### Error: "Real-ESRGAN not found"

**Symptoms:**
- `ModuleNotFoundError: No module named 'realesrgan'`

**Fix:**
```bash
pip install git+https://github.com/xinntao/Real-ESRGAN.git --force-reinstall
```

### Error: "CUDA not available"

**Symptoms:**
- Very slow processing (using CPU instead of GPU)
- `CUDA requested but not available`

**Fix:**
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118 --force-reinstall
```

Verify CUDA installation:
```bash
nvidia-smi  # Should show your GPU
python -c "import torch; print(torch.cuda.is_available())"  # Should print True
```

### Error: "Model weights not found"

**Symptoms:**
- `FileNotFoundError: weights/RealESRGAN_x4plus.pth`

**Fix:**
The model weights will be downloaded automatically on first use. Ensure you have internet access. To download manually:

```bash
mkdir -p src/backend/weights
wget -O src/backend/weights/RealESRGAN_x4plus.pth \
  https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth
```

## System Requirements

### Minimum Requirements
- Python 3.8+
- 8GB RAM
- NVIDIA GPU with 4GB+ VRAM (for CUDA acceleration)
- FFmpeg installed

### Recommended Requirements
- Python 3.10+
- 16GB RAM
- NVIDIA GPU with 8GB+ VRAM
- SSD storage for faster I/O

### Installing FFmpeg

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html

## Complete Reinstall

If all else fails, do a complete reinstall:

```bash
cd src/backend

# Remove everything
rm -rf .venv
rm -rf weights

# Fresh install
./setup.sh

# Restart backend
source .venv/bin/activate
python -m uvicorn app.main:app --reload
```

## Getting Help

If you continue to experience issues:

1. Check the backend logs for detailed error messages
2. Run the version verification script above
3. Ensure your GPU drivers are up to date
4. Report issues at the project repository with:
   - Python version (`python --version`)
   - OS version (`uname -a` or Windows version)
   - GPU model (`nvidia-smi`)
   - Complete error traceback from logs
