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

### Windows (Simplest - Batch File)

```cmd
# Navigate to backend directory
cd src\backend

# Run setup script (works without admin rights)
setup.bat

# Start the server
start.bat
```

### Windows (PowerShell)

```powershell
# Navigate to backend directory
cd src/backend

# Run setup script
.\setup.ps1

# Start the server (use direct path to avoid conflicts)
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

**If you get PowerShell execution policy errors:**
```powershell
# Run PowerShell as Administrator and execute:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
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

**For AI upscaling (recommended):**

```bash
# Upgrade pip
python -m pip install --upgrade pip

# Install PyTorch with CUDA support first (for GPU acceleration)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# Then install other requirements
pip install -r requirements.txt
```

**For basic video editing only (no AI upscaling):**

```bash
# Upgrade pip
python -m pip install --upgrade pip

# Install only basic requirements
pip install fastapi uvicorn python-multipart pydantic ffmpeg-python aiofiles
```

**Note:** For detailed AI setup, GPU troubleshooting, and other CUDA versions, see [INSTALL_AI_DEPENDENCIES.md](INSTALL_AI_DEPENDENCIES.md).

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

- `POST /api/export/upscale` - Export video with AI upscaling and de-zoom
  - Form data: `video` (file), `keyframes_json` (string), `target_fps` (int, default: 30)
  - Uses Real-ESRGAN AI model for high-quality upscaling
  - Automatically detects aspect ratio and upscales to 4K (16:9) or 1080x1920 (9:16)
  - Returns: AI-upscaled video file
  - **Note:** Requires AI dependencies to be installed (see [INSTALL_AI_DEPENDENCIES.md](INSTALL_AI_DEPENDENCIES.md))

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

### Installing to Global Python Instead of Venv

If you see errors like:
```
ERROR: Could not install packages due to an OSError: [WinError 2] The system cannot find the file specified: 'C:\\Python311\\Scripts\\...'
```

This means you're installing to the global Python instead of your virtual environment.

**Solution:**
```powershell
# Always use the venv's pip directly
.\.venv\Scripts\pip.exe install -r requirements.txt

# Or use setup.bat which handles this automatically
setup.bat
```

**Verify you're using the right Python:**
```powershell
# Check which Python is being used
.\.venv\Scripts\python.exe -c "import sys; print(sys.executable)"
# Should show path containing .venv
```

### FFmpeg not found

If you see FFmpeg errors during export:
1. Verify FFmpeg is installed: `ffmpeg -version`
2. Make sure FFmpeg is in your PATH
3. Restart your terminal/PowerShell after installing FFmpeg

### AI Upscaling Issues

**"Real-ESRGAN not available" warning:**

This means the AI upscaling dependencies are not installed. The system will fall back to basic OpenCV upscaling (lower quality).

**Solution:**
```bash
cd src/backend
pip install -r requirements.txt
```

For detailed GPU setup and troubleshooting, see [INSTALL_AI_DEPENDENCIES.md](INSTALL_AI_DEPENDENCIES.md).

**"Numpy is not available" or NumPy compatibility error:**

This means NumPy 2.x is installed, but AI packages require NumPy 1.x.

**Solution:**
```bash
pip install 'numpy<2.0.0' --force-reinstall
# Restart the backend
```

**"Using device: cpu" when you have a GPU:**

This means PyTorch doesn't detect your CUDA-enabled GPU.

**Solution:**
```bash
# Check GPU is detected
nvidia-smi

# Reinstall PyTorch with CUDA support
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118 --force-reinstall
```

See [INSTALL_AI_DEPENDENCIES.md](INSTALL_AI_DEPENDENCIES.md) for detailed instructions.

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
