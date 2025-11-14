@echo off
REM ============================================================================
REM Frontend Startup Script for Windows
REM ============================================================================
REM This script automatically:
REM   1. Checks if dependencies are installed
REM   2. Installs/updates npm dependencies if needed
REM   3. Starts the Vite development server
REM ============================================================================

echo.
echo ============================================================================
echo   VIDEO EDITOR - FRONTEND STARTUP
echo ============================================================================
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo [1/2] Installing npm dependencies...
    echo     This may take a few minutes on first run...
    call npm install
    if errorlevel 1 (
        echo ERROR: Failed to install npm dependencies
        echo Make sure Node.js 18+ is installed
        pause
        exit /b 1
    )
    echo     Dependencies installed successfully!
) else (
    echo [1/2] Dependencies already installed
    echo     Run 'npm install' manually if you need to update
)

echo.
echo [2/2] Starting Vite development server...
echo.
echo ============================================================================
echo   Frontend will be available at: http://localhost:5173
echo   Press CTRL+C to stop the server
echo ============================================================================
echo.

call npm run dev
