# Download weights for different super-resolution models
# Run this script from the video-editor root directory
# PowerShell version for Windows

$ErrorActionPreference = "Stop"

$WEIGHTS_DIR = "weights"
if (!(Test-Path $WEIGHTS_DIR)) {
    New-Item -ItemType Directory -Path $WEIGHTS_DIR | Out-Null
}

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Downloading Super-Resolution Model Weights" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan

# Real-ESRGAN x4plus (baseline)
$file = "$WEIGHTS_DIR\RealESRGAN_x4plus.pth"
if (!(Test-Path $file)) {
    Write-Host "Downloading RealESRGAN_x4plus..."
    $url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
    Invoke-WebRequest -Uri $url -OutFile $file
    Write-Host "  Downloaded RealESRGAN_x4plus.pth" -ForegroundColor Green
} else {
    Write-Host "  RealESRGAN_x4plus.pth already exists" -ForegroundColor Yellow
}

# Real-ESRGAN x4plus anime 6B
$file = "$WEIGHTS_DIR\RealESRGAN_x4plus_anime_6B.pth"
if (!(Test-Path $file)) {
    Write-Host "Downloading RealESRGAN_x4plus_anime_6B..."
    $url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
    Invoke-WebRequest -Uri $url -OutFile $file
    Write-Host "  Downloaded RealESRGAN_x4plus_anime_6B.pth" -ForegroundColor Green
} else {
    Write-Host "  RealESRGAN_x4plus_anime_6B.pth already exists" -ForegroundColor Yellow
}

# Real-ESRGAN General v3
$file = "$WEIGHTS_DIR\realesr-general-x4v3.pth"
if (!(Test-Path $file)) {
    Write-Host "Downloading realesr-general-x4v3..."
    $url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth"
    Invoke-WebRequest -Uri $url -OutFile $file
    Write-Host "  Downloaded realesr-general-x4v3.pth" -ForegroundColor Green
} else {
    Write-Host "  realesr-general-x4v3.pth already exists" -ForegroundColor Yellow
}

# SwinIR x4 GAN (transformer-based)
$file = "$WEIGHTS_DIR\003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_GAN.pth"
if (!(Test-Path $file)) {
    Write-Host "Downloading SwinIR-M x4 GAN..."
    $url = "https://github.com/JingyunLiang/SwinIR/releases/download/v0.0/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_GAN.pth"
    Invoke-WebRequest -Uri $url -OutFile $file
    Write-Host "  Downloaded SwinIR-M x4 GAN weights" -ForegroundColor Green
} else {
    Write-Host "  SwinIR-M x4 GAN weights already exist" -ForegroundColor Yellow
}

# SwinIR x4 PSNR-optimized
$file = "$WEIGHTS_DIR\003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_PSNR.pth"
if (!(Test-Path $file)) {
    Write-Host "Downloading SwinIR-M x4 PSNR..."
    $url = "https://github.com/JingyunLiang/SwinIR/releases/download/v0.0/003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_PSNR.pth"
    Invoke-WebRequest -Uri $url -OutFile $file
    Write-Host "  Downloaded SwinIR-M x4 PSNR weights" -ForegroundColor Green
} else {
    Write-Host "  SwinIR-M x4 PSNR weights already exist" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "HAT Model Weights (Manual Download Required)" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "HAT (Hybrid Attention Transformer) requires manual download:"
Write-Host "  1. Visit: https://github.com/XPixelGroup/HAT/releases"
Write-Host "  2. Download HAT_SRx4_ImageNet-pretrain.pth"
Write-Host "  3. Place in $WEIGHTS_DIR\"
Write-Host ""
Write-Host "You also need to add the HAT architecture:"
Write-Host "  1. Clone: git clone https://github.com/XPixelGroup/HAT"
Write-Host "  2. Copy: HAT\hat\archs\hat_arch.py to src\backend\app\archs\"
Write-Host ""

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan

Get-ChildItem "$WEIGHTS_DIR\*.pth" | ForEach-Object {
    $sizeMB = [math]::Round($_.Length / 1MB, 1)
    Write-Host "  $($_.Name): $sizeMB MB"
}

Write-Host ""
Write-Host "Total downloaded models:"
Write-Host "  - Real-ESRGAN x4plus (baseline)"
Write-Host "  - Real-ESRGAN x4plus anime 6B"
Write-Host "  - Real-ESRGAN General v3"
Write-Host "  - SwinIR-M x4 GAN (recommended for testing)"
Write-Host "  - SwinIR-M x4 PSNR"
Write-Host ""
Write-Host "Ready for model comparison testing!" -ForegroundColor Green
