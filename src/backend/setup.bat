@echo off
REM Backend Setup Script for Windows (Batch)
REM Run this from the backend directory: setup.bat

echo Setting up Video Editor Backend...
echo.

REM Check if virtual environment exists
if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo Failed to create virtual environment!
        pause
        exit /b 1
    )
)

REM Upgrade pip
echo.
echo Upgrading pip...
.venv\Scripts\python.exe -m pip install --upgrade pip

REM Install requirements
echo.
echo Installing Python dependencies...
.venv\Scripts\pip.exe install -r requirements.txt
if errorlevel 1 (
    echo Failed to install requirements!
    pause
    exit /b 1
)

REM Verify installation
echo.
echo Verifying installation...
.venv\Scripts\python.exe -c "import fastapi; import uvicorn; import multipart; print('All dependencies installed successfully!')"
if errorlevel 1 (
    echo Verification failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo Setup complete!
echo ========================================
echo.
echo To start the server, run:
echo   .venv\Scripts\python.exe -m uvicorn app.main:app --reload
echo.
echo Or use the provided start.bat script:
echo   start.bat
echo.
echo Note: Make sure FFmpeg is installed on your system
echo Download from: https://ffmpeg.org/download.html
echo.
pause
