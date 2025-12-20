# Video Editor Project - AI Implementation Preamble

**Include this preamble at the start of each task prompt to provide context.**

---

## Project Overview

This is a browser-based video editor for creating soccer highlight clips with three modes:
- **Annotate Mode** - Mark and annotate clips from full game footage
- **Framing Mode** - Crop, trim, and speed-adjust clips
- **Overlay Mode** - Add visual effects to the framed video

## Tech Stack

- **Frontend:** React 18 + Vite (runs on port 5173)
- **Backend:** FastAPI + Python (runs on port 8000)
- **Video Processing:** FFmpeg (command-line)
- **Database:** SQLite (being added)
- **State Management:** React hooks (useState, useCallback, useMemo)

## Project Structure

```
video-editor/
├── src/
│   ├── frontend/src/
│   │   ├── App.jsx                          # Main app component (~1000 lines)
│   │   ├── hooks/
│   │   │   ├── useClipManager.js            # Manages clips in Framing mode
│   │   │   ├── useVideo.js                  # Video playback control
│   │   │   └── ...
│   │   ├── components/
│   │   │   ├── FileUpload.jsx               # Upload buttons
│   │   │   ├── ClipSelectorSidebar.jsx      # Framing mode clip list
│   │   │   └── shared/
│   │   │       └── ModeSwitcher.jsx         # Mode tabs
│   │   ├── modes/
│   │   │   ├── annotate/
│   │   │   │   ├── hooks/useAnnotate.js     # Annotate clip regions
│   │   │   │   ├── components/
│   │   │   │   │   ├── ClipsSidePanel.jsx
│   │   │   │   │   ├── ClipDetailsEditor.jsx
│   │   │   │   │   └── ...
│   │   │   │   └── constants/soccerTags.js  # Rating definitions
│   │   │   ├── framing/
│   │   │   └── overlay/
│   │   └── utils/
│   └── backend/app/
│       ├── main.py                          # FastAPI app entry
│       ├── models.py                        # Pydantic models
│       ├── routers/
│       │   ├── __init__.py                  # Exports all routers
│       │   ├── annotate.py                  # Clip extraction endpoints
│       │   ├── export.py                    # Video export endpoints
│       │   ├── health.py                    # Health check
│       │   └── detection.py                 # YOLO detection
│       └── websocket.py
└── user_data/                               # NEW - Will be created
    └── a/                                   # Single user folder
        ├── database.sqlite
        ├── raw_clips/
        ├── uploads/
        ├── working_videos/
        └── final_videos/
```

## Current State

The app currently has **no persistence** - videos exist only in browser memory. This task series adds:
1. SQLite database for metadata
2. Server-side file storage for videos
3. Project-based workflow

## Database Schema (Target State)

```sql
CREATE TABLE raw_clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    rating INTEGER NOT NULL,              -- 4 (Good) or 5 (Brilliant)
    tags TEXT,                            -- JSON array
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,           -- "16:9" or "9:16"
    working_video_id INTEGER,
    final_video_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (working_video_id) REFERENCES working_videos(id),
    FOREIGN KEY (final_video_id) REFERENCES final_videos(id)
);

CREATE TABLE working_clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    raw_clip_id INTEGER,                  -- NULL if uploaded directly
    uploaded_filename TEXT,               -- NULL if from raw_clips
    progress INTEGER DEFAULT 0,           -- 0=not framed, 1=framed
    sort_order INTEGER DEFAULT 0,
    abandoned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id)
);

CREATE TABLE working_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    abandoned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE final_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    abandoned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

## Key Data Structures

### Annotate Clip Region (Frontend)
```javascript
{
  id: 'clip_123',
  startTime: 150.5,
  endTime: 165.5,
  name: 'Brilliant Goal',
  tags: ['Goal', '1v1 Attack'],
  notes: 'Amazing finish',
  rating: 5,                    // 1-5 stars
  color: '#3B82F6'
}
```

### Rating System
```javascript
// From soccerTags.js
ratingAdjectives = {
  5: 'Brilliant',   // Saved + gets own 9:16 project
  4: 'Good',        // Saved
  3: 'Interesting', // NOT saved
  2: 'Unfortunate', // NOT saved
  1: 'Bad'          // NOT saved
}
```

### Clip Manager Clip (Frontend - Framing Mode)
```javascript
{
  id: 'clip_123',
  file: File,                   // Video File object
  fileName: 'clip.mp4',
  duration: 15.5,
  sourceWidth: 1920,
  sourceHeight: 1080,
  framerate: 30,
  segments: { boundaries, segmentSpeeds, trimRange },
  cropKeyframes: []
}
```

## API Patterns

**Backend registers routers in main.py:**
```python
from app.routers import health_router, export_router, ...
app.include_router(health_router)
```

**Router file pattern (routers/__init__.py):**
```python
from .health import router as health_router
from .export import router as export_router
```

**Endpoints use FastAPI patterns:**
```python
from fastapi import APIRouter, UploadFile, File, Form
router = APIRouter(prefix="/api/projects", tags=["projects"])

@router.get("")
async def list_projects():
    ...
```

## Running the App

```bash
# Backend
cd src/backend
python -m uvicorn app.main:app --reload --port 8000

# Frontend
cd src/frontend
npm run dev
```

## Important Notes

1. **FFmpeg** is required and assumed to be in PATH
2. **CORS** is configured for localhost:5173 and localhost:3000
3. **File uploads** use FormData with multipart encoding
4. **Video metadata extraction** uses `extractVideoMetadata()` utility
5. **Temp files** are cleaned up using FastAPI's `BackgroundTask`
