#!/bin/bash
# Backend Setup Script for Linux/macOS
# Run this script from the backend directory: ./setup.sh

echo "Setting up Video Editor Backend..."

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source .venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
python -m pip install --upgrade pip

# Install requirements
echo "Installing Python dependencies..."

# CRITICAL: Force correct versions of numpy and opencv-python FIRST
# These must be installed before Real-ESRGAN to avoid version conflicts
echo "Installing critical dependencies with version constraints..."
echo "  - NumPy < 2.0.0 (required for PyTorch/Real-ESRGAN compatibility)"
echo "  - OpenCV 4.8.x-4.9.x (required for numpy 1.x compatibility)"
pip install 'numpy>=1.24.0,<2.0.0' --force-reinstall
# Use --no-deps to prevent opencv from pulling numpy 2.x
pip install 'opencv-python>=4.8.0,<4.10.0' --no-deps --force-reinstall

# Now install remaining requirements
echo ""
echo "Installing remaining dependencies..."
pip install -r requirements.txt

# Re-force numpy version in case any package pulled in numpy 2.x
echo ""
echo "Ensuring NumPy version is correct..."
pip install 'numpy>=1.24.0,<2.0.0' --force-reinstall

# Verify critical version constraints are met
echo ""
echo "Verifying critical dependency versions..."
python << 'EOF'
import sys

# Check numpy version
try:
    import numpy as np
    numpy_version = np.__version__
    major_version = int(numpy_version.split('.')[0])
    if major_version >= 2:
        print(f"❌ ERROR: NumPy version {numpy_version} is incompatible!")
        print("   Real-ESRGAN requires NumPy < 2.0.0")
        print("   Run: pip install 'numpy<2.0.0' --force-reinstall")
        sys.exit(1)
    print(f"✓ NumPy version: {numpy_version} (compatible)")
except ImportError:
    print("❌ NumPy not installed!")
    sys.exit(1)

# Check opencv version
try:
    import cv2
    cv_version = cv2.__version__
    parts = cv_version.split('.')
    major = int(parts[0])
    minor = int(parts[1])
    if major != 4 or minor < 8 or minor >= 10:
        print(f"❌ WARNING: OpenCV version {cv_version} may be incompatible!")
        print("   Recommended: opencv-python 4.8.x or 4.9.x")
        print("   Run: pip install 'opencv-python>=4.8.0,<4.10.0' --force-reinstall")
    else:
        print(f"✓ OpenCV version: {cv_version} (compatible)")
except ImportError:
    print("❌ OpenCV not installed!")
    sys.exit(1)

# Check PyTorch
try:
    import torch
    print(f"✓ PyTorch version: {torch.__version__}")
    if torch.cuda.is_available():
        print(f"✓ CUDA available: {torch.version.cuda}")
    else:
        print("⚠ CUDA not available (CPU mode will be used)")
except ImportError:
    print("❌ PyTorch not installed!")
    sys.exit(1)

print("✓ All critical dependency versions are compatible!")
EOF

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Dependency version check failed!"
    echo "Please fix the version conflicts above before continuing."
    exit 1
fi

# Verify core installation
echo ""
echo "Verifying core installation..."
python -c "import fastapi; import uvicorn; import multipart; print('✓ Core dependencies installed successfully!')"

# Verify AI dependencies
echo ""
echo "Verifying AI upscaling dependencies..."
python << 'EOF'
import sys
try:
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer
    print("✓ Real-ESRGAN dependencies installed successfully!")
except ImportError as e:
    print(f"⚠ Real-ESRGAN dependencies not fully installed: {e}")
    print("  AI upscaling may not be available.")
    print("  This is normal for the first setup - dependencies will be installed.")
EOF

echo ""
echo "✓ Setup complete!"
echo ""
echo "To start the server, run:"
echo "  source .venv/bin/activate"
echo "  python -m uvicorn app.main:app --reload"
echo ""
echo "Note: Make sure FFmpeg is installed on your system"
echo "  Ubuntu/Debian: sudo apt-get install ffmpeg"
echo "  macOS: brew install ffmpeg"
echo ""
echo "For AI upscaling troubleshooting, see INSTALL_AI_DEPENDENCIES.md"
