# Video Editor

A browser-based video editing application with advanced crop keyframing and speed control features.

## Project Status

This project is in active development using AI-assisted development with Claude Code. Development follows a risk-first, phase-based approach to build features incrementally.

## Project Vision

A web-based video editor focused on:
- **Animated Crop System**: Keyframe-based cropping with smooth interpolation between different crop regions
- **Speed Controls**: Variable playback speed with dedicated timeline regions
- **Professional Timeline**: Multi-clip editing with trim, split, and arrange capabilities
- **Export Pipeline**: FFmpeg-based rendering with quality presets

## Development Approach

This project prioritizes:
1. **Risk Front-loading**: Most complex/novel features (crop keyframes) built first
2. **MVP Completeness**: Essential features (import/export) included early
3. **AI-Friendly Structure**: Clear technical requirements optimized for Claude Code
4. **Incremental Validation**: Each phase produces testable, working software

## Phase Overview

### Development Phases (Feature Building)
1. **Foundation** - Basic playback & architecture
2. **Crop Keyframes** - Animated crop system (HIGHEST RISK - Novel feature)
3. **Import/Export** - File management (MVP ESSENTIAL)
4. **Speed Controls** - Variable playback
5. **Timeline Editing** - Trim & multi-clip

### Deployment Phases (Production Readiness)
6. **Build Pipeline** - Automated builds
7. **Environment Setup** - Multi-environment deploy
8. **Cross-Platform** - Multi-device testing

## Documentation Structure

All project specifications and technical documentation are located in the [docs/](docs/) directory:

### Core Documentation
- [00-PROJECT-OVERVIEW.md](docs/00-PROJECT-OVERVIEW.md) - Complete project vision and phase breakdown
- [AI-IMPLEMENTATION-GUIDE.md](docs/AI-IMPLEMENTATION-GUIDE.md) - Guide for AI-assisted development
- [TECHNICAL-REFERENCE.md](docs/TECHNICAL-REFERENCE.md) - Technical architecture and patterns

### Phase Specifications
- [01-PHASE-FOUNDATION.md](docs/01-PHASE-FOUNDATION.md) - Video player foundation
- [02-PHASE-CROP-KEYFRAMES.md](docs/02-PHASE-CROP-KEYFRAMES.md) - Animated crop system
- [03-PHASE-IMPORT-EXPORT.md](docs/03-PHASE-IMPORT-EXPORT.md) - File I/O and rendering
- [04-PHASE-SPEED-CONTROLS.md](docs/04-PHASE-SPEED-CONTROLS.md) - Variable speed playback
- [05-PHASE-TIMELINE-EDITING.md](docs/05-PHASE-TIMELINE-EDITING.md) - Professional editing features
- [06-PHASE-BUILD-PIPELINE.md](docs/06-PHASE-BUILD-PIPELINE.md) - Build automation
- [07-PHASE-ENVIRONMENT-SETUP.md](docs/07-PHASE-ENVIRONMENT-SETUP.md) - Environment configuration
- [08-PHASE-CROSS-PLATFORM.md](docs/08-PHASE-CROSS-PLATFORM.md) - Cross-platform testing

## 🚀 Quick Start - Running the Application

### Windows Users - One-Click Startup! ⚡

From the project root directory:

```batch
start-dev.bat
```

That's it! This automatically starts both servers in separate windows.

**See [DEVELOPMENT.md](DEVELOPMENT.md) for complete Windows development guide.**

---

### Manual Setup (All Platforms)

#### Prerequisites

- **Python 3.11+** - [Download](https://www.python.org/downloads/)
- **Node.js 18+** - [Download](https://nodejs.org/)
- **FFmpeg** (for future video processing) - [Install guide](#install-ffmpeg)

#### Step 1: Start the Backend

**Windows:**
```batch
cd src\backend
start.bat
```

**macOS/Linux:**
```bash
cd src/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Backend will run at:** http://localhost:8000

#### Step 2: Start the Frontend (New Terminal)

**Windows:**
```batch
cd src\frontend
start.bat
```

**macOS/Linux:**
```bash
cd src/frontend
npm install
npm run dev
```

**Frontend will run at:** http://localhost:5173

#### Step 3: View the Application

Open your browser to: **http://localhost:5173**

You should see the video editor with:
- ✅ Beautiful gradient UI (Tailwind CSS)
- ✅ Live connection to backend API
- ✅ Video upload and processing capabilities

**Additional URLs:**
- API Documentation: http://localhost:8000/docs
- Backend API: http://localhost:8000/api/hello

---

## 🛠️ Technology Stack

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool with hot reload
- **Tailwind CSS** - Utility-first styling
- **Axios** - HTTP client for API calls

### Backend
- **FastAPI** - Modern Python web framework
- **Python 3.11+** - Programming language
- **Uvicorn** - ASGI server
- **Pydantic** - Data validation

### Coming Soon
- **FFmpeg** - Video encoding/decoding
- **OpenCV** - Video frame manipulation
- **moviepy** - Video editing

## Development Philosophy

Each phase specification includes:
- Exact component requirements
- Complete data models
- Algorithm specifications
- API contracts
- Testing requirements
- Clear acceptance criteria

The specifications are written to minimize ambiguity and maximize implementation success with AI coding assistants.

## Current Phase

**Status:** Hello World Demo Complete ✅
**Next:** Phase 1 (Foundation) - Video upload and playback

---

## 📚 Additional Documentation

- **[IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)** - Complete development plan with FastAPI backend architecture
- **[MILESTONES.md](./docs/MILESTONES.md)** - Project milestones and timeline (5 weeks to production)
- **[QUICK_START.md](./docs/QUICK_START.md)** - Detailed setup guide
- **[README_HELLO_WORLD.md](./docs/README_HELLO_WORLD.md)** - Hello World demo details
- **[VERIFICATION.md](./docs/VERIFICATION.md)** - Project verification guide

---

## 🐛 Troubleshooting

### Backend Issues

**Problem:** `ModuleNotFoundError: No module named 'fastapi'`
**Solution:** Make sure virtual environment is activated (you should see `(venv)` in terminal prompt), then run `pip install -r requirements.txt`

**Problem:** Port 8000 already in use
**Solution:** Kill the process: `lsof -ti:8000 | xargs kill -9` or use different port

### Frontend Issues

**Problem:** `Cannot find module 'vite'`
**Solution:** Delete `node_modules` and reinstall: `rm -rf node_modules package-lock.json && npm install`

**Problem:** CORS errors in browser console
**Solution:** Ensure backend is running on port 8000 and check CORS settings in `backend/app/main.py`

---

## 📦 Install FFmpeg

### macOS
```bash
brew install ffmpeg
```

### Ubuntu/Debian
```bash
sudo apt update && sudo apt install ffmpeg
```

### Windows
Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH

**Verify installation:**
```bash
ffmpeg -version
```

---

## 🎯 Project Structure

```
video-editor/
├── src/
│   ├── frontend/              # React + Vite + Tailwind
│   │   ├── src/
│   │   │   ├── App.jsx       # Main component
│   │   │   ├── main.jsx      # Entry point
│   │   │   └── index.css     # Tailwind CSS
│   │   └── package.json      # Dependencies
│   │
│   └── backend/              # FastAPI + Python
│       ├── app/
│       │   └── main.py       # FastAPI application
│       └── requirements.txt  # Python dependencies
│
├── docs/                     # Documentation & specifications
└── scripts/                  # Utility scripts
```

---

## ✨ Success Checklist

When everything is working:

- [ ] Backend shows: `INFO: Application startup complete`
- [ ] Frontend shows: `VITE v5.x.x ready in XXXms`
- [ ] Browser displays http://localhost:5173
- [ ] Green checkmark: "Hello from FastAPI + Python!"
- [ ] No errors in browser console (F12)
- [ ] API docs work: http://localhost:8000/docs

---

## License

TBD
