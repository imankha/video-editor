@echo off
REM ============================================================================
REM Video Editor - Development Environment Launcher
REM ============================================================================
REM This script starts both the backend and frontend servers in separate windows
REM Run this from the project root directory
REM ============================================================================

echo.
echo ============================================================================
echo   VIDEO EDITOR - DEVELOPMENT ENVIRONMENT LAUNCHER
echo ============================================================================
echo.
echo Starting backend and frontend servers in separate windows...
echo.
echo Backend: http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Close each window to stop the respective server
echo ============================================================================
echo.

REM Start backend in a new window
start "Video Editor - Backend" cmd /k "cd src\backend && start.bat"

REM Wait a moment before starting frontend
timeout /t 2 /nobreak >nul

REM Start frontend in a new window
start "Video Editor - Frontend" cmd /k "cd src\frontend && start.bat"

echo.
echo Both servers are starting in separate windows!
echo.
echo - Backend window: "Video Editor - Backend"
echo - Frontend window: "Video Editor - Frontend"
echo.
echo Once both servers are running, open your browser to:
echo http://localhost:5173
echo.
pause
