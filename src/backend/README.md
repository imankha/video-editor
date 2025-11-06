# Video Editor Backend

FastAPI backend for the video editor application with FFmpeg-powered video processing.

## Prerequisites

- Python 3.11 or higher
- FFmpeg installed on your system

### Installing FFmpeg

**Windows:**
1. Download from [ffmpeg.org](https://ffmpeg.org/download.html)
2. Extract to a folder (e.g., `C:\ffmpeg`)
3. Add to PATH: `C:\ffmpeg\bin`
4. Verify: `ffmpeg -version`

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

## Quick Setup

### Windows (PowerShell)

```powershell
# Navigate to backend directory
cd src/backend

# Run setup script
.\setup.ps1

# Start the server
python -m uvicorn app.main:app --reload
```

### Linux/macOS

```bash
# Navigate to backend directory
cd src/backend

# Make setup script executable
chmod +x setup.sh

# Run setup script
./setup.sh

# Start the server
source .venv/bin/activate
python -m uvicorn app.main:app --reload
```

## Manual Setup

If the setup scripts don't work, follow these steps:

### 1. Create Virtual Environment

**Windows:**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

**Linux/macOS:**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Install Dependencies

```bash
# Upgrade pip
python -m pip install --upgrade pip

# Install requirements
pip install -r requirements.txt
```

### 3. Verify Installation

```bash
python -c "import fastapi; import uvicorn; import multipart; print('Success!')"
```

## Running the Server

```bash
# Make sure venv is activated
python -m uvicorn app.main:app --reload
```

The server will start at: `http://localhost:8000`

API documentation available at: `http://localhost:8000/docs`

## API Endpoints

### Health Check
- `GET /` - API info
- `GET /api/status` - Health check
- `GET /api/hello` - Test endpoint

### Video Processing
- `POST /api/export/crop` - Export video with crop applied
  - Form data: `video` (file), `keyframes_json` (string)
  - Returns: Cropped video file

## Troubleshooting

### "python-multipart" not found

If you see:
```
RuntimeError: Form data requires "python-multipart" to be installed.
```

**Solution:**
```bash
# Make sure you're in the virtual environment
# Windows:
.\.venv\Scripts\pip.exe install python-multipart --force-reinstall

# Linux/macOS:
pip install python-multipart --force-reinstall
```

### FFmpeg not found

If you see FFmpeg errors during export:
1. Verify FFmpeg is installed: `ffmpeg -version`
2. Make sure FFmpeg is in your PATH
3. Restart your terminal/PowerShell after installing FFmpeg

### Port already in use

If port 8000 is already in use:
```bash
# Use a different port
python -m uvicorn app.main:app --reload --port 8001
```

Then update the frontend API URL in `src/frontend/src/components/ExportButton.jsx`:
```javascript
'http://localhost:8001/api/export/crop'
```

## Development

### Project Structure

```
backend/
├── app/
│   └── main.py          # FastAPI application
├── requirements.txt     # Python dependencies
├── setup.ps1           # Windows setup script
├── setup.sh            # Linux/macOS setup script
└── README.md           # This file
```

### Adding Dependencies

```bash
# Install new package
pip install package-name

# Update requirements.txt
pip freeze > requirements.txt
```

## Technology Stack

- **FastAPI** 0.108.0 - Modern Python web framework
- **Uvicorn** 0.25.0 - ASGI server
- **FFmpeg-python** 0.2.0 - FFmpeg bindings
- **Pydantic** 2.5.0 - Data validation
- **aiofiles** 23.2.1 - Async file operations
