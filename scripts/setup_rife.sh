#!/bin/bash
# Setup RIFE (Real-time Intermediate Flow Estimation) for high-quality slow motion
# Run this script from the video-editor root directory: ./scripts/setup_rife.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RIFE_DIR="$PROJECT_ROOT/src/backend/app/ai_upscaler/rife"
WEIGHTS_DIR="$PROJECT_ROOT/weights"

echo "==========================================="
echo "RIFE Setup for High-Quality Slow Motion"
echo "==========================================="
echo ""
echo "This script will set up RIFE frame interpolation."
echo "RIFE provides significantly better quality than FFmpeg's"
echo "minterpolate for slow motion effects."
echo ""

# Check for CUDA
echo "Checking GPU capabilities..."
if command -v nvidia-smi &> /dev/null; then
    echo "  NVIDIA GPU detected:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1 | sed 's/^/    /'
    HAS_CUDA=true
else
    echo "  No NVIDIA GPU detected"
    HAS_CUDA=false
fi

# Check for Vulkan
if command -v vulkaninfo &> /dev/null; then
    VULKAN_DEVICE=$(vulkaninfo --summary 2>/dev/null | grep "deviceName" | head -1 | cut -d'=' -f2 | xargs)
    if [ -n "$VULKAN_DEVICE" ]; then
        echo "  Vulkan GPU detected: $VULKAN_DEVICE"
        HAS_VULKAN=true
    else
        HAS_VULKAN=false
    fi
else
    echo "  Vulkan not detected"
    HAS_VULKAN=false
fi
echo ""

# Prompt for installation type
echo "==========================================="
echo "Select RIFE Installation Type"
echo "==========================================="
echo ""
echo "1) RIFE CUDA (Best quality, requires NVIDIA GPU)"
echo "   - Uses PyTorch with CUDA acceleration"
echo "   - Highest quality frame interpolation"
echo "   - Requires ~2GB GPU memory"
echo ""
echo "2) RIFE ncnn (Good quality, cross-platform GPU)"
echo "   - Uses Vulkan for GPU acceleration"
echo "   - Works on NVIDIA, AMD, and Intel GPUs"
echo "   - Lighter weight, standalone binary"
echo ""
echo "3) Both (Recommended if you have NVIDIA GPU)"
echo ""
echo "4) Skip (Use FFmpeg minterpolate fallback)"
echo ""

read -p "Enter choice [1-4]: " choice

case $choice in
    1)
        INSTALL_CUDA=true
        INSTALL_NCNN=false
        ;;
    2)
        INSTALL_CUDA=false
        INSTALL_NCNN=true
        ;;
    3)
        INSTALL_CUDA=true
        INSTALL_NCNN=true
        ;;
    4)
        echo ""
        echo "Skipping RIFE installation."
        echo "The system will use FFmpeg minterpolate for slow motion."
        echo "You can run this script again to install RIFE later."
        exit 0
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

echo ""
mkdir -p "$WEIGHTS_DIR"

# Install RIFE CUDA
if [ "$INSTALL_CUDA" = true ]; then
    echo "==========================================="
    echo "Installing RIFE CUDA"
    echo "==========================================="

    if [ "$HAS_CUDA" = false ]; then
        echo "WARNING: NVIDIA GPU not detected. RIFE CUDA may not work."
        read -p "Continue anyway? [y/N]: " confirm
        if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
            INSTALL_CUDA=false
        fi
    fi

    if [ "$INSTALL_CUDA" = true ]; then
        # Clone RIFE repository
        if [ -d "$RIFE_DIR" ]; then
            echo "RIFE directory already exists. Updating..."
            cd "$RIFE_DIR"
            git pull origin main || git pull origin master || true
        else
            echo "Cloning RIFE repository..."
            git clone https://github.com/hzwer/ECCV2022-RIFE.git "$RIFE_DIR"
        fi

        # Download RIFE model weights
        echo ""
        echo "Downloading RIFE model weights..."
        RIFE_WEIGHTS_DIR="$RIFE_DIR/train_log"
        mkdir -p "$RIFE_WEIGHTS_DIR"

        # Download flownet.pkl (main model)
        if [ ! -f "$RIFE_WEIGHTS_DIR/flownet.pkl" ]; then
            echo "  Downloading flownet.pkl..."
            # RIFE v4.6 weights
            wget -q --show-progress -O "$RIFE_WEIGHTS_DIR/flownet.pkl" \
                "https://github.com/hzwer/Practical-RIFE/releases/download/v4.6/flownet.pkl" || \
            wget -q --show-progress -O "$RIFE_WEIGHTS_DIR/flownet.pkl" \
                "https://drive.google.com/uc?export=download&id=1APIzVeI-4ZZCEuIRE1m6WYfSCaOsi_7_"
            echo "  Downloaded flownet.pkl"
        else
            echo "  flownet.pkl already exists"
        fi

        # Verify PyTorch CUDA
        echo ""
        echo "Verifying PyTorch CUDA installation..."
        cd "$PROJECT_ROOT/src/backend"
        if [ -d ".venv" ]; then
            source .venv/bin/activate
        fi

        python << 'EOF'
import sys
try:
    import torch
    print(f"  PyTorch version: {torch.__version__}")
    if torch.cuda.is_available():
        print(f"  CUDA available: {torch.cuda.get_device_name(0)}")
        print("  RIFE CUDA is ready!")
    else:
        print("  WARNING: CUDA not available in PyTorch")
        print("  Install PyTorch with CUDA:")
        print("    pip install torch --index-url https://download.pytorch.org/whl/cu121")
except ImportError:
    print("  ERROR: PyTorch not installed")
    sys.exit(1)
EOF

        echo ""
        echo "RIFE CUDA installation complete!"
    fi
fi

# Install RIFE ncnn
if [ "$INSTALL_NCNN" = true ]; then
    echo ""
    echo "==========================================="
    echo "Installing RIFE ncnn (Vulkan)"
    echo "==========================================="

    # Detect OS and architecture
    OS=$(uname -s)
    ARCH=$(uname -m)

    NCNN_VERSION="20240816"  # Latest stable release
    NCNN_BIN_DIR="$PROJECT_ROOT/bin"
    mkdir -p "$NCNN_BIN_DIR"

    case "$OS" in
        Linux)
            if [ "$ARCH" = "x86_64" ]; then
                NCNN_URL="https://github.com/nihui/rife-ncnn-vulkan/releases/download/$NCNN_VERSION/rife-ncnn-vulkan-$NCNN_VERSION-ubuntu.zip"
            else
                echo "Unsupported Linux architecture: $ARCH"
                echo "Please download manually from: https://github.com/nihui/rife-ncnn-vulkan/releases"
                INSTALL_NCNN=false
            fi
            ;;
        Darwin)
            NCNN_URL="https://github.com/nihui/rife-ncnn-vulkan/releases/download/$NCNN_VERSION/rife-ncnn-vulkan-$NCNN_VERSION-macos.zip"
            ;;
        *)
            echo "Unsupported OS: $OS"
            echo "Please download manually from: https://github.com/nihui/rife-ncnn-vulkan/releases"
            INSTALL_NCNN=false
            ;;
    esac

    if [ "$INSTALL_NCNN" = true ]; then
        echo "Downloading rife-ncnn-vulkan..."
        NCNN_ZIP="/tmp/rife-ncnn-vulkan.zip"
        wget -q --show-progress -O "$NCNN_ZIP" "$NCNN_URL"

        echo "Extracting..."
        unzip -q -o "$NCNN_ZIP" -d "/tmp/rife-ncnn"

        # Find and copy the binary
        NCNN_BINARY=$(find /tmp/rife-ncnn -name "rife-ncnn-vulkan" -type f | head -1)
        if [ -n "$NCNN_BINARY" ]; then
            cp "$NCNN_BINARY" "$NCNN_BIN_DIR/"
            chmod +x "$NCNN_BIN_DIR/rife-ncnn-vulkan"

            # Copy models directory if present
            NCNN_MODELS=$(dirname "$NCNN_BINARY")/models
            if [ -d "$NCNN_MODELS" ]; then
                cp -r "$NCNN_MODELS" "$NCNN_BIN_DIR/"
            fi

            echo "  Installed to: $NCNN_BIN_DIR/rife-ncnn-vulkan"
        else
            echo "ERROR: Could not find rife-ncnn-vulkan binary in archive"
            INSTALL_NCNN=false
        fi

        # Clean up
        rm -rf /tmp/rife-ncnn "$NCNN_ZIP"

        if [ "$INSTALL_NCNN" = true ]; then
            # Add to PATH suggestion
            echo ""
            echo "To use rife-ncnn-vulkan, add to your PATH:"
            echo "  export PATH=\"$NCNN_BIN_DIR:\$PATH\""
            echo ""
            echo "Or create a symlink:"
            echo "  sudo ln -s $NCNN_BIN_DIR/rife-ncnn-vulkan /usr/local/bin/"

            # Test the binary
            echo ""
            echo "Testing rife-ncnn-vulkan..."
            if "$NCNN_BIN_DIR/rife-ncnn-vulkan" -h > /dev/null 2>&1; then
                echo "  rife-ncnn-vulkan is working!"
            else
                echo "  WARNING: rife-ncnn-vulkan may not work on this system"
                echo "  Make sure Vulkan drivers are installed"
            fi
        fi
    fi
fi

echo ""
echo "==========================================="
echo "RIFE Setup Summary"
echo "==========================================="

if [ "$INSTALL_CUDA" = true ]; then
    echo "  RIFE CUDA: Installed at $RIFE_DIR"
fi

if [ "$INSTALL_NCNN" = true ]; then
    echo "  RIFE ncnn: Installed at $NCNN_BIN_DIR/rife-ncnn-vulkan"
fi

echo ""
echo "The video editor will automatically detect and use the best"
echo "available interpolation method:"
echo "  1. RIFE CUDA (best quality)"
echo "  2. RIFE ncnn (good quality)"
echo "  3. FFmpeg minterpolate (fallback)"
echo ""
echo "Setup complete!"
