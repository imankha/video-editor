@echo off
REM ============================================================================
REM Backend Startup Script for Windows
REM ============================================================================
REM This script automatically:
REM   1. Creates virtual environment if needed
REM   2. Activates virtual environment
REM   3. Installs/updates dependencies
REM   4. Starts the FastAPI backend server
REM ============================================================================

echo.
echo ============================================================================
echo   VIDEO EDITOR - BACKEND STARTUP
echo ============================================================================
echo.

REM Check if virtual environment exists
if not exist "venv\" (
    echo [1/4] Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment
        echo Make sure Python 3.11+ is installed
        pause
        exit /b 1
    )
    echo     Virtual environment created successfully!
) else (
    echo [1/4] Virtual environment already exists
)

echo.
echo [2/4] Activating virtual environment...
call venv\Scripts\activate.bat
if errorlevel 1 (
    echo ERROR: Failed to activate virtual environment
    pause
    exit /b 1
)
echo     Virtual environment activated!

echo.
echo [3/4] Installing/updating dependencies...
echo     This may take a few minutes on first run...
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)
echo     Dependencies installed!

echo.
echo [4/4] Starting FastAPI backend server...
echo.
echo ============================================================================
echo   Backend will be available at: http://localhost:8000
echo   API Documentation: http://localhost:8000/docs
echo   Press CTRL+C to stop the server
echo ============================================================================
echo.

python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
