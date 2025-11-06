# Video Editor - Quick Start Guide

**Last Updated**: November 6, 2025

This guide will get you up and running with the video editor in ~30 minutes.

---

## Tech Stack Summary

- **Frontend**: React 18 + Tailwind CSS + Vite
- **Backend**: FastAPI (Python 3.11+)
- **Video Processing**: FFmpeg + OpenCV + moviepy
- **Communication**: REST API + WebSocket

---

## Prerequisites

Make sure you have installed:
- **Node.js** 18+ and npm
- **Python** 3.11+
- **FFmpeg** (system installation)

### Install FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html and add to PATH

Verify installation:
```bash
ffmpeg -version
```

---

## Step 1: Initialize Frontend (React + Vite + Tailwind)

```bash
# Create frontend project
npm create vite@latest frontend -- --template react
cd frontend

# Install core dependencies
npm install

# Install additional dependencies
npm install tailwindcss autoprefixer postcss
npm install axios socket.io-client uuid date-fns react-dropzone clsx

# Install dev dependencies
npm install -D @types/react vitest @testing-library/react

# Initialize Tailwind CSS
npx tailwindcss init -p
```

### Configure Tailwind

Edit `tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Edit `src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Create Environment Variables

Create `.env`:
```bash
VITE_API_URL=http://localhost:8000
```

### Test Frontend

```bash
npm run dev
```

Visit http://localhost:5173 - you should see the Vite + React welcome page.

---

## Step 2: Initialize Backend (FastAPI + Python)

```bash
# Go back to project root
cd ..

# Create backend directory
mkdir backend
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
source venv/bin/activate  # On macOS/Linux
# or
venv\Scripts\activate     # On Windows

# Create requirements.txt
cat > requirements.txt << 'EOF'
# Core
fastapi==0.108.0
uvicorn[standard]==0.25.0
python-multipart==0.0.6
pydantic==2.5.0
pydantic-settings==2.1.0

# Video processing
opencv-python==4.9.0
numpy==1.26.0
moviepy==1.0.3
ffmpeg-python==0.2.0
pillow==10.1.0

# WebSocket
websockets==12.0
python-socketio==5.10.0

# File handling
aiofiles==23.2.1

# Dev dependencies
pytest==7.4.0
pytest-asyncio==0.21.0
black==23.12.0
ruff==0.1.0
EOF

# Install dependencies
pip install -r requirements.txt
```

### Create Project Structure

```bash
# Create directory structure
mkdir -p app/api/v1/endpoints
mkdir -p app/core
mkdir -p app/services
mkdir -p app/models
mkdir -p app/utils
mkdir -p storage/{uploads,temp,exports}
mkdir tests

# Create __init__.py files
touch app/__init__.py
touch app/api/__init__.py
touch app/api/v1/__init__.py
touch app/api/v1/endpoints/__init__.py
touch app/core/__init__.py
touch app/services/__init__.py
touch app/models/__init__.py
touch app/utils/__init__.py
```

### Create Basic FastAPI App

Create `app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Video Editor API",
    version="0.1.0",
    description="Backend API for video editing application"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative port
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {
        "message": "Video Editor API",
        "version": "0.1.0",
        "status": "running"
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
```

### Create Configuration

Create `app/core/config.py`:
```python
from pydantic_settings import BaseSettings
from pathlib import Path

class Settings(BaseSettings):
    # API Settings
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Video Editor API"

    # File Storage
    STORAGE_PATH: Path = Path("storage")
    UPLOAD_PATH: Path = STORAGE_PATH / "uploads"
    TEMP_PATH: Path = STORAGE_PATH / "temp"
    EXPORT_PATH: Path = STORAGE_PATH / "exports"

    # File Upload Limits
    MAX_UPLOAD_SIZE: int = 5 * 1024 * 1024 * 1024  # 5GB

    # CORS
    BACKEND_CORS_ORIGINS: list = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    class Config:
        case_sensitive = True

settings = Settings()

# Ensure storage directories exist
settings.UPLOAD_PATH.mkdir(parents=True, exist_ok=True)
settings.TEMP_PATH.mkdir(parents=True, exist_ok=True)
settings.EXPORT_PATH.mkdir(parents=True, exist_ok=True)
```

### Test Backend

```bash
# From backend directory
python -m app.main

# or
uvicorn app.main:app --reload
```

Visit http://localhost:8000 - you should see the API info JSON.
Visit http://localhost:8000/docs - you should see the interactive API documentation (Swagger UI).

---

## Step 3: Create API Client (Frontend)

Create `frontend/src/services/apiClient.js`:
```javascript
import axios from 'axios';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    // Add auth token here if needed
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default apiClient;
```

Create `frontend/src/services/videoService.js`:
```javascript
import apiClient from './apiClient';

export const videoService = {
  // Upload video
  async uploadVideo(file, onProgress) {
    const formData = new FormData();
    formData.append('file', file);

    return apiClient.post('/api/v1/videos/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total
        );
        onProgress?.(percentCompleted);
      },
    });
  },

  // Get video metadata
  async getVideoMetadata(videoId) {
    return apiClient.get(`/api/v1/videos/${videoId}`);
  },

  // Get video stream URL
  getVideoStreamUrl(videoId) {
    return `${apiClient.defaults.baseURL}/api/v1/videos/${videoId}/stream`;
  },
};
```

---

## Step 4: Test Frontend-Backend Communication

Create a simple test component in `frontend/src/App.jsx`:
```jsx
import { useState, useEffect } from 'react';
import apiClient from './services/apiClient';

function App() {
  const [apiStatus, setApiStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Test API connection
    apiClient.get('/health')
      .then(response => {
        setApiStatus(response.data);
        setLoading(false);
      })
      .catch(error => {
        console.error('API connection failed:', error);
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Video Editor</h1>

        {loading && <p>Connecting to API...</p>}

        {!loading && apiStatus && (
          <div className="bg-green-800 px-6 py-3 rounded">
            <p>✅ API Connected</p>
            <p className="text-sm">Status: {apiStatus.status}</p>
          </div>
        )}

        {!loading && !apiStatus && (
          <div className="bg-red-800 px-6 py-3 rounded">
            <p>❌ API Connection Failed</p>
            <p className="text-sm">Make sure backend is running on port 8000</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
```

### Run Both Servers

**Terminal 1 (Backend):**
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm run dev
```

Visit http://localhost:5173 - you should see "✅ API Connected" if everything is working!

---

## Step 5: Implement First Feature (Video Upload)

### Backend: Video Upload Endpoint

Create `app/api/v1/endpoints/videos.py`:
```python
from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path
import uuid
import shutil
from app.core.config import settings

router = APIRouter()

@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file"""

    # Validate file type
    allowed_types = ["video/mp4", "video/quicktime", "video/webm"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {allowed_types}"
        )

    # Generate unique filename
    file_id = str(uuid.uuid4())
    file_extension = Path(file.filename).suffix
    file_path = settings.UPLOAD_PATH / f"{file_id}{file_extension}"

    # Save file
    try:
        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    return {
        "id": file_id,
        "filename": file.filename,
        "path": str(file_path),
        "size": file_path.stat().st_size,
    }

@router.get("/{video_id}")
async def get_video_metadata(video_id: str):
    """Get video metadata"""
    # TODO: Implement metadata extraction using FFmpeg
    return {
        "id": video_id,
        "status": "uploaded"
    }
```

Update `app/api/v1/api.py`:
```python
from fastapi import APIRouter
from app.api.v1.endpoints import videos

api_router = APIRouter()

api_router.include_router(videos.router, prefix="/videos", tags=["videos"])
```

Update `app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.api import api_router
from app.core.config import settings

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
async def root():
    return {"message": settings.PROJECT_NAME, "version": "0.1.0"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
```

### Frontend: File Upload Component

Create `frontend/src/components/FileUpload.jsx`:
```jsx
import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

function FileUpload({ onUpload }) {
  const onDrop = useCallback((acceptedFiles) => {
    if (acceptedFiles.length > 0) {
      onUpload(acceptedFiles[0]);
    }
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.mov', '.webm']
    },
    maxFiles: 1
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition ${
        isDragActive
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-gray-600 hover:border-gray-500'
      }`}
    >
      <input {...getInputProps()} />
      <div className="text-gray-400">
        {isDragActive ? (
          <p className="text-lg">Drop video here...</p>
        ) : (
          <div>
            <p className="text-lg mb-2">Drag & drop video here</p>
            <p className="text-sm">or click to browse</p>
            <p className="text-xs mt-2">Supports: MP4, MOV, WebM</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default FileUpload;
```

Update `frontend/src/App.jsx`:
```jsx
import { useState } from 'react';
import FileUpload from './components/FileUpload';
import { videoService } from './services/videoService';

function App() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoId, setVideoId] = useState(null);

  const handleUpload = async (file) => {
    setUploading(true);
    setProgress(0);

    try {
      const response = await videoService.uploadVideo(file, setProgress);
      setVideoId(response.data.id);
      console.log('Upload successful:', response.data);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Video Editor</h1>

        <FileUpload onUpload={handleUpload} />

        {uploading && (
          <div className="mt-4">
            <div className="bg-gray-800 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-center mt-2">{progress}%</p>
          </div>
        )}

        {videoId && (
          <div className="mt-4 p-4 bg-green-800 rounded">
            <p>✅ Video uploaded successfully!</p>
            <p className="text-sm">ID: {videoId}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
```

---

## Step 6: Test Video Upload

1. **Start backend**: `uvicorn app.main:app --reload` (from backend directory)
2. **Start frontend**: `npm run dev` (from frontend directory)
3. **Open browser**: http://localhost:5173
4. **Drag and drop** a video file or click to browse
5. **Watch progress** bar fill up
6. **See success** message when complete

Check `backend/storage/uploads/` - your video file should be there!

---

## Next Steps

Now that you have the basic setup working:

1. **Continue with Phase 1** - See `IMPLEMENTATION_PLAN.md` Phase 1 section
2. **Implement video player** - HTML5 video element streaming from backend
3. **Add timeline scrubber** - Frame-accurate seeking
4. **Build metadata extraction** - Use FFmpeg to get video properties

Refer to the detailed implementation plan for each phase.

---

## Troubleshooting

### Frontend can't connect to backend
- Check backend is running on port 8000
- Check CORS settings in `app/main.py`
- Check `VITE_API_URL` in frontend `.env`

### Video upload fails
- Check file size limit in backend config
- Check `storage/uploads` directory exists and is writable
- Check browser console for error messages

### FFmpeg not found
- Verify FFmpeg is installed: `ffmpeg -version`
- Make sure it's in your system PATH
- On Windows, you may need to restart terminal after installation

---

## Useful Commands

**Frontend:**
```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run test         # Run tests
```

**Backend:**
```bash
uvicorn app.main:app --reload     # Start dev server
pytest                            # Run tests
black app/                        # Format code
ruff check app/                   # Lint code
```

**Both:**
```bash
# Run both in parallel (install concurrently first)
npm install -g concurrently
concurrently "cd frontend && npm run dev" "cd backend && uvicorn app.main:app --reload"
```

---

## Resources

- **FastAPI Docs**: https://fastapi.tiangolo.com/
- **React Docs**: https://react.dev/
- **Tailwind CSS**: https://tailwindcss.com/docs
- **Vite**: https://vitejs.dev/
- **FFmpeg Python**: https://github.com/kkroening/ffmpeg-python
- **OpenCV Python**: https://docs.opencv.org/4.x/d6/d00/tutorial_py_root.html

---

**Ready to build!** 🚀

Follow the implementation plan and build phase by phase. Good luck!
