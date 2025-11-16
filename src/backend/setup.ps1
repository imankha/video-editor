# Backend Setup Script for Windows
# Run this script from the backend directory: .\setup.ps1
# If you get execution policy errors, run PowerShell as Admin and execute:
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

Write-Host "Setting up Video Editor Backend..." -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Check if virtual environment exists
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to create virtual environment!" -ForegroundColor Red
        exit 1
    }
}

# Use direct paths to venv executables (more reliable than activation)
$venvPython = Join-Path $scriptDir ".venv\Scripts\python.exe"
$venvPip = Join-Path $scriptDir ".venv\Scripts\pip.exe"

Write-Host "Using Python: $venvPython" -ForegroundColor Gray

# Verify venv python exists
if (-not (Test-Path $venvPython)) {
    Write-Host "Virtual environment Python not found!" -ForegroundColor Red
    Write-Host "Expected at: $venvPython" -ForegroundColor Red
    exit 1
}

# Upgrade pip
Write-Host "`nUpgrading pip..." -ForegroundColor Yellow
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: Pip upgrade failed, continuing anyway..." -ForegroundColor Yellow
}

# Install requirements
Write-Host "`nInstalling Python dependencies..." -ForegroundColor Yellow

# CRITICAL: Force correct versions of numpy and opencv-python FIRST
# These must be installed before Real-ESRGAN to avoid version conflicts
Write-Host "`nInstalling critical dependencies with version constraints..." -ForegroundColor Cyan
Write-Host "  - NumPy < 2.0.0 (required for PyTorch/Real-ESRGAN compatibility)" -ForegroundColor Gray
Write-Host "  - OpenCV 4.8.x-4.9.x (required for numpy 1.x compatibility)" -ForegroundColor Gray

# Install numpy first
& $venvPip install "numpy>=1.24.0,<2.0.0" --force-reinstall
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: NumPy installation had issues, continuing..." -ForegroundColor Yellow
}

# Install opencv with --no-deps to prevent it from pulling numpy 2.x
& $venvPip install "opencv-python>=4.8.0,<4.10.0" --no-deps --force-reinstall
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: OpenCV installation had issues, continuing..." -ForegroundColor Yellow
}

# Now install remaining requirements
Write-Host "`nInstalling remaining dependencies..." -ForegroundColor Yellow
& $venvPip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install requirements!" -ForegroundColor Red
    exit 1
}

# Re-force numpy version in case it was overwritten
Write-Host "`nEnsuring NumPy version is correct..." -ForegroundColor Yellow
& $venvPip install "numpy>=1.24.0,<2.0.0" --force-reinstall
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: NumPy reinstall had issues" -ForegroundColor Yellow
}

# Verify critical version constraints are met
Write-Host "`nVerifying critical dependency versions..." -ForegroundColor Cyan

$verifyScript = @"
import sys

# Check numpy version
try:
    import numpy as np
    numpy_version = np.__version__
    major_version = int(numpy_version.split('.')[0])
    if major_version >= 2:
        print('ERROR: NumPy version ' + numpy_version + ' is incompatible!')
        print('   Real-ESRGAN requires NumPy < 2.0.0')
        print('   Run: pip install numpy<2.0.0 --force-reinstall')
        sys.exit(1)
    print('OK NumPy version: ' + numpy_version + ' (compatible)')
except ImportError:
    print('ERROR: NumPy not installed!')
    sys.exit(1)

# Check opencv version
try:
    import cv2
    cv_version = cv2.__version__
    parts = cv_version.split('.')
    major = int(parts[0])
    minor = int(parts[1])
    if major != 4 or minor < 8 or minor >= 10:
        print('WARNING: OpenCV version ' + cv_version + ' may be incompatible!')
        print('   Recommended: opencv-python 4.8.x or 4.9.x')
    else:
        print('OK OpenCV version: ' + cv_version + ' (compatible)')
except ImportError:
    print('ERROR: OpenCV not installed!')
    sys.exit(1)

# Check PyTorch
try:
    import torch
    print('OK PyTorch version: ' + torch.__version__)
    if torch.cuda.is_available():
        print('OK CUDA available: ' + torch.version.cuda)
    else:
        print('WARNING: CUDA not available (CPU mode will be used)')
except ImportError:
    print('ERROR: PyTorch not installed!')
    sys.exit(1)

print('OK All critical dependency versions are compatible!')
"@

& $venvPython -c $verifyScript
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nDependency version check failed!" -ForegroundColor Red
    Write-Host "Please fix the version conflicts above before continuing." -ForegroundColor Red
    exit 1
}

# Verify core installation
Write-Host "`nVerifying core installation..." -ForegroundColor Yellow
& $venvPython -c "import fastapi; import uvicorn; import multipart; print('OK Core dependencies installed successfully!')"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Core verification failed!" -ForegroundColor Red
    exit 1
}

# Verify AI dependencies
Write-Host "`nVerifying AI upscaling dependencies..." -ForegroundColor Yellow
$aiVerifyScript = @"
import sys
try:
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from realesrgan import RealESRGANer
    print('OK Real-ESRGAN dependencies installed successfully!')
except ImportError as e:
    print('WARNING: Real-ESRGAN dependencies not fully installed: ' + str(e))
    print('  AI upscaling may not be available.')
    print('  This is normal for first setup - dependencies will be installed.')
"@

& $venvPython -c $aiVerifyScript

Write-Host "`nSetup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the server, run ONE of these commands:" -ForegroundColor Cyan
Write-Host ""
Write-Host "Option 1 (Direct path - most reliable):" -ForegroundColor White
Write-Host "  .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload" -ForegroundColor Gray
Write-Host ""
Write-Host "Option 2 (With activation):" -ForegroundColor White
Write-Host "  .\.venv\Scripts\Activate.ps1" -ForegroundColor Gray
Write-Host "  python -m uvicorn app.main:app --reload" -ForegroundColor Gray
Write-Host ""
Write-Host "Note: Make sure FFmpeg is installed on your system" -ForegroundColor Yellow
Write-Host "Download from: https://ffmpeg.org/download.html" -ForegroundColor Gray
Write-Host "Or use: winget install FFmpeg" -ForegroundColor Gray
Write-Host ""
Write-Host "For AI upscaling troubleshooting, see INSTALL_AI_DEPENDENCIES.md" -ForegroundColor Cyan
