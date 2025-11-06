@echo off
REM Start the Video Editor Backend Server
REM Run this from the backend directory: start.bat

echo Starting Video Editor Backend...
echo.
echo Server will be available at: http://localhost:8000
echo API docs available at: http://localhost:8000/docs
echo.
echo Press Ctrl+C to stop the server
echo.

.venv\Scripts\python.exe -m uvicorn app.main:app --reload
