# Backend Setup Script for Windows
# Run this script from the backend directory: .\setup.ps1

Write-Host "Setting up Video Editor Backend..." -ForegroundColor Cyan

# Check if virtual environment exists
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv .venv
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& .\.venv\Scripts\Activate.ps1

# Upgrade pip
Write-Host "Upgrading pip..." -ForegroundColor Yellow
python -m pip install --upgrade pip

# Install requirements
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt

# Verify installation
Write-Host "`nVerifying installation..." -ForegroundColor Yellow
python -c "import fastapi; import uvicorn; import multipart; print('✓ All dependencies installed successfully!')"

Write-Host "`n✓ Setup complete!" -ForegroundColor Green
Write-Host "`nTo start the server, run:" -ForegroundColor Cyan
Write-Host "  python -m uvicorn app.main:app --reload" -ForegroundColor White

Write-Host "`nNote: Make sure FFmpeg is installed on your system" -ForegroundColor Yellow
Write-Host "Download from: https://ffmpeg.org/download.html" -ForegroundColor Gray
