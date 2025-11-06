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
& $venvPip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install requirements!" -ForegroundColor Red
    exit 1
}

# Verify installation
Write-Host "`nVerifying installation..." -ForegroundColor Yellow
& $venvPython -c "import fastapi; import uvicorn; import multipart; print('✓ All dependencies installed successfully!')"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Verification failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n✓ Setup complete!" -ForegroundColor Green
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
