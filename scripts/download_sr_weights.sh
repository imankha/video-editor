#!/bin/bash
# Download weights for different super-resolution models
# Run this script from the video-editor root directory

set -e

WEIGHTS_DIR="weights"
mkdir -p "$WEIGHTS_DIR"

echo "==========================================="
echo "Downloading Super-Resolution Model Weights"
echo "==========================================="

# Real-ESRGAN x4plus (baseline) - Already available
if [ ! -f "$WEIGHTS_DIR/RealESRGAN_x4plus.pth" ]; then
    echo "Downloading RealESRGAN_x4plus..."
    wget -q -O "$WEIGHTS_DIR/RealESRGAN_x4plus.pth" \
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
    echo "  Downloaded RealESRGAN_x4plus.pth"
else
    echo "  RealESRGAN_x4plus.pth already exists"
fi

# Real-ESRGAN x4plus anime 6B
if [ ! -f "$WEIGHTS_DIR/RealESRGAN_x4plus_anime_6B.pth" ]; then
    echo "Downloading RealESRGAN_x4plus_anime_6B..."
    wget -q -O "$WEIGHTS_DIR/RealESRGAN_x4plus_anime_6B.pth" \
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
    echo "  Downloaded RealESRGAN_x4plus_anime_6B.pth"
else
    echo "  RealESRGAN_x4plus_anime_6B.pth already exists"
fi

# Real-ESRGAN General v3
if [ ! -f "$WEIGHTS_DIR/realesr-general-x4v3.pth" ]; then
    echo "Downloading realesr-general-x4v3..."
    wget -q -O "$WEIGHTS_DIR/realesr-general-x4v3.pth" \
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth"
    echo "  Downloaded realesr-general-x4v3.pth"
else
    echo "  realesr-general-x4v3.pth already exists"
fi

# SwinIR x4 GAN (transformer-based)
if [ ! -f "$WEIGHTS_DIR/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_GAN.pth" ]; then
    echo "Downloading SwinIR-M x4 GAN..."
    wget -q -O "$WEIGHTS_DIR/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_GAN.pth" \
        "https://github.com/JingyunLiang/SwinIR/releases/download/v0.0/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_GAN.pth"
    echo "  Downloaded SwinIR-M x4 GAN weights"
else
    echo "  SwinIR-M x4 GAN weights already exist"
fi

# SwinIR x4 PSNR-optimized
if [ ! -f "$WEIGHTS_DIR/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_PSNR.pth" ]; then
    echo "Downloading SwinIR-M x4 PSNR..."
    wget -q -O "$WEIGHTS_DIR/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_PSNR.pth" \
        "https://github.com/JingyunLiang/SwinIR/releases/download/v0.0/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_PSNR.pth"
    echo "  Downloaded SwinIR-M x4 PSNR weights"
else
    echo "  SwinIR-M x4 PSNR weights already exist"
fi

echo ""
echo "==========================================="
echo "HAT Model Weights (Manual Download Required)"
echo "==========================================="
echo "HAT (Hybrid Attention Transformer) requires manual download:"
echo "  1. Visit: https://github.com/XPixelGroup/HAT/releases"
echo "  2. Download HAT_SRx4_ImageNet-pretrain.pth"
echo "  3. Place in $WEIGHTS_DIR/"
echo ""
echo "You also need to add the HAT architecture:"
echo "  1. Clone: git clone https://github.com/XPixelGroup/HAT"
echo "  2. Copy: HAT/hat/archs/hat_arch.py to src/backend/app/archs/"
echo ""

echo "==========================================="
echo "Summary"
echo "==========================================="
ls -lh "$WEIGHTS_DIR"/*.pth 2>/dev/null | awk '{print "  " $NF ": " $5}' || echo "No weights found"
echo ""
echo "Total downloaded models:"
echo "  - Real-ESRGAN x4plus (baseline)"
echo "  - Real-ESRGAN x4plus anime 6B"
echo "  - Real-ESRGAN General v3"
echo "  - SwinIR-M x4 GAN (recommended for testing)"
echo "  - SwinIR-M x4 PSNR"
echo ""
echo "Ready for model comparison testing!"
