# Player Highlighter - Quick Start

Get the development environment running in ~10 minutes.

---

## Prerequisites

- **Node.js** 18+ with npm
- **Python** 3.11+
- **FFmpeg** installed and in PATH

### Install FFmpeg

**Windows**: Download from https://ffmpeg.org/download.html and add to PATH

**macOS**: `brew install ffmpeg`

**Linux**: `sudo apt install ffmpeg`

Verify: `ffmpeg -version`

---

## Setup

### 1. Clone and Install Frontend

```bash
cd src/frontend
npm install
```

### 2. Install Backend

```bash
cd src/backend

# Create virtual environment
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (macOS/Linux)
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

---

## Run Development Servers

### Terminal 1: Frontend

```bash
cd src/frontend
npm run dev
```

Opens at http://localhost:5173

### Terminal 2: Backend

```bash
cd src/backend
.venv\Scripts\activate       # Windows
source .venv/bin/activate    # macOS/Linux

uvicorn app.main:app --reload
```

Runs at http://localhost:8000

---

## Verify Setup

1. Open http://localhost:5173
2. Upload a video file (MP4, MOV, or WebM)
3. Try the crop overlay (drag handles)
4. Try trimming (click segment buttons)
5. Try adjusting speed (segment speed controls)
6. Export and verify output

---

## Project Structure

```
video-editor/
├── src/
│   ├── frontend/                # React app
│   │   ├── src/
│   │   │   ├── App.jsx          # Main component
│   │   │   ├── modes/
│   │   │   │   ├── framing/     # Crop/trim/speed
│   │   │   │   └── overlay/     # Highlight effects
│   │   │   ├── components/      # Shared UI
│   │   │   ├── hooks/           # State management
│   │   │   └── utils/           # Utilities
│   │   └── package.json
│   │
│   └── backend/                 # FastAPI server
│       └── app/
│           ├── main.py          # Entry point
│           ├── routers/         # API endpoints
│           ├── ai_upscaler/     # ML models
│           └── interpolation.py # Crop math
│
├── docs/                        # Documentation
│   ├── 00-PROJECT-OVERVIEW.md   # Start here
│   ├── ACTIVE/                  # Current phase specs
│   ├── COMPLETED/               # Reference docs
│   └── REFERENCE/               # Supplementary
│
└── cloudflare_runpod_deploy_package/  # Deployment configs
```

---

## Development Workflow

### Editor Mode Switching

The app has two modes:
- **Framing Mode**: Crop, trim, and speed adjust
- **Overlay Mode**: Add highlight effects

Switch modes using the toggle in the header.

### Making Changes

1. Frontend changes hot-reload automatically (Vite HMR)
2. Backend changes reload automatically (`--reload` flag)
3. Run tests: `npm test` (frontend) or `pytest` (backend)

---

## Common Issues

### "FFmpeg not found"

- Verify installation: `ffmpeg -version`
- Restart terminal after installation
- On Windows, ensure FFmpeg is in PATH

### "Backend connection failed"

- Check backend is running on port 8000
- Check CORS settings in `app/main.py`
- Try: http://localhost:8000/health

### "Video won't load"

- Check browser console for errors
- Verify file is valid video (MP4, MOV, WebM)
- Try a smaller/shorter test video

---

## Useful Commands

### Frontend

```bash
npm run dev          # Development server
npm run build        # Production build
npm run test         # Run tests
npm run lint         # Lint code
```

### Backend

```bash
uvicorn app.main:app --reload    # Dev server
pytest                           # Run tests
black app/                       # Format code
```

---

## Next Steps

1. Read [00-PROJECT-OVERVIEW.md](00-PROJECT-OVERVIEW.md) for the big picture
2. Check [ACTIVE/](ACTIVE/) for current development specs
3. See [TECHNICAL-REFERENCE.md](TECHNICAL-REFERENCE.md) for architecture details
