# Video Editor

A browser-based video editing application with three-mode workflow: **Annotate** (clip extraction), **Framing** (crop/upscale), and **Overlay** (highlight effects).

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 + Vite (port 5173) |
| **Backend** | FastAPI + Python (uvicorn, port 8000) |
| **Database** | SQLite (`user_data/a/database.sqlite`) |
| **Video Processing** | FFmpeg (required in PATH) |
| **AI Upscaling** | Real-ESRGAN, RIFE (optional) |

## Quick Start

### Windows
```batch
start-dev.bat
```

### Manual (All Platforms)
```bash
# Terminal 1: Backend
cd src/backend
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2: Frontend
cd src/frontend
npm install && npm run dev
```

**Access:** http://localhost:5173 | **API Docs:** http://localhost:8000/docs

---

## Architecture Overview

```
User Workflow:
  +-----------------+     +---------------+     +--------------+     +---------+
  | Annotate Mode   | --> | Framing Mode  | --> | Overlay Mode | --> | Gallery |
  | (Mark clips in  |     | (Crop, speed, |     | (Highlight   |     | (Final  |
  |  game footage)  |     |  trim, AI up) |     |  effects)    |     | videos) |
  +-----------------+     +---------------+     +--------------+     +---------+
         |                       |                     |                  |
         v                       v                     v                  v
    raw_clips/            working_clips         working_videos      final_videos/
    (library)             (per project)         (per project)       (downloads)
```

### Three Editing Modes

1. **Annotate Mode**: Mark clip regions on full game footage
   - Add metadata (tags, rating 1-5, notes)
   - Export creates raw clips (4+ stars) + projects
   - Annotations stored in SQLite `annotations` table

2. **Framing Mode**: Edit individual clips within a project
   - Crop keyframes with spline interpolation
   - Segment splitting, speed control, trimming
   - AI upscaling (Real-ESRGAN 4x)
   - Outputs: `working_videos/` (intermediate renders)

3. **Overlay Mode**: Add highlight effects to working video
   - Ellipse highlight regions with keyframe animation
   - Effect types (brightness, dark overlay)
   - Outputs: `final_videos/` (shown in Gallery)

---

## Project Structure

```
video-editor/
├── src/
│   ├── backend/                    # FastAPI Python backend
│   │   └── app/
│   │       ├── main.py             # App initialization, CORS, WebSocket
│   │       ├── database.py         # SQLite schema, migrations, paths
│   │       ├── models.py           # Pydantic request/response models
│   │       ├── queries.py          # Shared SQL query helpers
│   │       ├── websocket.py        # WebSocket manager for progress
│   │       ├── constants.py        # Shared constants (ratings, tags, colors)
│   │       ├── user_context.py     # Per-request user isolation (for tests)
│   │       ├── routers/            # API endpoints
│   │       │   ├── projects.py     # Project CRUD, state persistence
│   │       │   ├── clips.py        # Raw clips library + working clips
│   │       │   ├── games.py        # Game footage storage, annotations
│   │       │   ├── annotate.py     # Annotate export (creates clips + projects)
│   │       │   ├── export/         # Export endpoints (split by mode)
│   │       │   │   ├── __init__.py     # Aggregates sub-routers
│   │       │   │   ├── framing.py      # /crop, /upscale, /framing endpoints
│   │       │   │   ├── overlay.py      # /overlay, /final endpoints
│   │       │   │   └── multi_clip.py   # /multi-clip, /chapters endpoints
│   │       │   ├── downloads.py    # Gallery/final video management
│   │       │   ├── detection.py    # YOLO player/ball detection
│   │       │   ├── health.py       # Health checks
│   │       │   └── auth.py         # User isolation (for E2E tests)
│   │       └── services/           # Business logic layer
│   │           ├── clip_cache.py       # Clip caching to avoid re-encoding
│   │           ├── video_processor.py  # Abstract GPU processing interface
│   │           ├── ffmpeg_service.py   # FFmpeg helper functions
│   │           ├── local_gpu_processor.py  # Local GPU implementation
│   │           └── transitions/        # Video transition strategies
│   │               ├── base.py         # TransitionStrategy interface
│   │               ├── cut.py          # Simple concatenation
│   │               ├── fade.py         # Fade to black transition
│   │               └── dissolve.py     # Cross-dissolve transition
│   │
│   └── frontend/                   # React + Vite frontend
│       └── src/
│           ├── App.jsx             # Main container (~2200 lines)
│           ├── components/         # Shared UI components
│           │   ├── VideoPlayer.jsx
│           │   ├── ProjectManager.jsx
│           │   ├── ClipSelectorSidebar.jsx
│           │   ├── ExportButton.jsx
│           │   ├── DownloadsPanel.jsx
│           │   └── timeline/       # Timeline components
│           ├── hooks/              # State management
│           │   ├── useProjects.js
│           │   ├── useProjectClips.js
│           │   ├── useClipManager.js
│           │   ├── useVideo.js
│           │   ├── useGames.js
│           │   └── useKeyframeController.js
│           ├── screens/            # Top-level screen components
│           │   ├── ProjectsScreen.jsx
│           │   ├── AnnotateScreen.jsx
│           │   ├── FramingScreen.jsx
│           │   └── OverlayScreen.jsx
│           ├── containers/         # Container components (state + logic)
│           │   ├── AnnotateContainer.jsx
│           │   ├── FramingContainer.jsx
│           │   └── OverlayContainer.jsx
│           ├── stores/             # Zustand state stores
│           │   ├── clipStore.js
│           │   ├── editorStore.js
│           │   ├── exportStore.js
│           │   └── videoStore.js
│           ├── modes/              # Mode-specific code
│           │   ├── FramingModeView.jsx
│           │   ├── OverlayModeView.jsx
│           │   ├── AnnotateModeView.jsx
│           │   ├── framing/        # Crop, segments, overlays
│           │   ├── overlay/        # Highlight regions
│           │   │   └── hooks/useOverlayState.js  # Consolidated overlay state
│           │   └── annotate/       # Clip marking, metadata
│           │       └── hooks/useAnnotateState.js # Consolidated annotate state
│           ├── controllers/        # Pure state machines
│           │   └── keyframeController.js
│           └── utils/              # Utilities
│               ├── timeFormat.js
│               ├── splineInterpolation.js
│               └── keyframeUtils.js
│
├── user_data/a/                    # Runtime data (gitignored)
│   ├── database.sqlite
│   ├── raw_clips/                  # Library clips (from Annotate)
│   ├── uploads/                    # Direct uploads
│   ├── games/                      # Full game videos
│   ├── working_videos/             # Framing output
│   ├── final_videos/               # Overlay output
│   ├── clip_cache/                 # Cached processed clips
│   └── downloads/                  # Temp export files
│
├── test_persistence.py             # Backend persistence tests
├── MANUAL_TEST.md                  # Manual testing procedures
├── KNOWN_BUGS.md                   # Known issues
└── prompt_preamble                 # Project context for AI assistants
```

---

## Database Schema

**Version-based system**: Uses INTEGER `version` columns that increment on re-export. Only latest version shown (except Gallery shows all).

### Core Tables

```sql
-- Raw clips: Extracted from Annotate mode (4+ star ratings)
raw_clips (
    id, filename, rating, tags, name, notes,
    start_time, end_time,  -- end_time is IDENTITY KEY for versioning
    created_at
)

-- Projects: Organize clips for editing
projects (
    id, name, aspect_ratio,
    working_video_id,      -- Points to latest working_videos.id
    final_video_id,        -- Points to latest final_videos.id
    current_mode,          -- 'framing' or 'overlay' (for resume)
    last_opened_at, created_at
)

-- Working clips: Clips in projects with framing edits
working_clips (
    id, project_id, raw_clip_id, uploaded_filename,
    exported_at,           -- NULL = not exported, timestamp = exported
    sort_order, version,   -- Version increments on re-export
    crop_data,             -- JSON: crop keyframes
    timing_data,           -- JSON: {trimRange}
    segments_data,         -- JSON: {boundaries, segmentSpeeds}
    created_at
)

-- Working videos: Framing mode output
working_videos (
    id, project_id, filename, version,
    effect_type,           -- Overlay effect type
    highlights_data,       -- JSON: [{start_time, end_time, keyframes}]
    text_overlays, duration, created_at
)

-- Final videos: Overlay mode output (shown in Gallery)
final_videos (
    id, project_id, filename, version, duration, created_at
)

-- Games: Full game footage for Annotate mode
games (
    id, name, video_filename,
    clip_count, brilliant_count, good_count,  -- Aggregate counts (cached)
    interesting_count, mistake_count, blunder_count,
    aggregate_score, created_at
)

-- Annotations: Marked regions in game footage (replaces TSV files)
annotations (
    id, game_id,               -- FK to games with ON DELETE CASCADE
    start_time, end_time,      -- Time range in seconds
    name, rating, tags, notes, -- Metadata (rating 1-5)
    created_at, updated_at
)
```

### Version Identity Rules

- **Clips**: Identified by `raw_clips.end_time` (not by ID)
- **Videos**: Identified by `project_id` + `version`
- **Latest query pattern**:
  ```sql
  SELECT * FROM working_clips wc WHERE wc.id IN (
      SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
              PARTITION BY COALESCE(rc.end_time, wc.uploaded_filename)
              ORDER BY version DESC
          ) as rn FROM working_clips wc
          LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
          WHERE project_id = ?
      ) WHERE rn = 1
  )
  ```

---

## Key API Endpoints

### Projects
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/projects` | List all with clip counts |
| POST | `/api/projects` | Create project |
| DELETE | `/api/projects/{id}` | Delete with all clips |
| PATCH | `/api/projects/{id}/state` | Update mode/timestamps |
| POST | `/api/projects/{id}/discard-uncommitted` | Revert unsaved edits |

### Clips
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/clips/raw` | List library clips |
| GET | `/api/clips/projects/{id}/clips` | List project's working clips |
| POST | `/api/clips/projects/{id}/clips` | Add clip to project |
| PUT | `/api/clips/projects/{id}/clips/{id}` | Save framing edits |

### Export
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/export/upscale` | AI upscale single clip |
| POST | `/api/export/multi-clip` | Concatenate multiple clips |
| POST | `/api/export/overlay` | Apply highlight effects |
| POST | `/api/export/framing` | Save framing output |
| POST | `/api/export/final` | Save final output |

### Games & Annotate
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/games` | Create game (video optional) |
| PUT | `/api/games/{id}/video` | Upload game video |
| POST | `/api/annotate/export` | Export clips + create projects |

---

## Key Frontend Patterns

### State Management
- **useKeyframeController**: Pure state machine for keyframe operations
- **Contexts**: CropContext, HighlightContext to avoid prop drilling
- **Hooks per domain**: useProjects, useClipManager, useVideo, etc.

### Keyframe System
```javascript
// All keyframes are frame-based (not time-based)
keyframe = {
  frame: number,
  origin: 'permanent' | 'user' | 'trim',  // Creation source
  // Mode-specific data:
  x, y, width, height,      // Crop mode
  radiusX, radiusY, opacity // Highlight mode
}
```

### Spline Interpolation
- Catmull-Rom cubic spline for smooth animations
- Converts frame -> position data between keyframes
- Used by both crop and highlight overlays

### Auto-Save Pattern
- Debounced (2s) saves to backend
- `refresh_required` response pattern: if true, client fetches fresh data
- Prevents version conflicts with server-side versioning

---

## Services Layer

The backend uses a services layer for GPU-intensive operations, designed for future extensibility to WebGPU or cloud processing (RunPod).

### Video Processor Interface

```python
from app.services import VideoProcessor, ProcessingBackend, ProcessorFactory

# Available backends (enum)
ProcessingBackend.LOCAL_GPU   # Current: Real-ESRGAN on local GPU
ProcessingBackend.WEB_GPU     # Future: Browser-based processing
ProcessingBackend.RUNPOD      # Future: Cloud GPU processing
ProcessingBackend.CPU_ONLY    # Fallback: CPU-only processing

# Get a processor
processor = ProcessorFactory.create(ProcessingBackend.LOCAL_GPU)

# Process a clip
result = await processor.process_clip(ProcessingConfig(
    input_path="/path/to/input.mp4",
    output_path="/path/to/output.mp4",
    target_width=1080,
    use_ai_upscale=True
))
```

### Shared Constants

All rating and tag constants are centralized in `app/constants.py`:

```python
from app.constants import (
    RATING_ADJECTIVES,      # {5: 'Brilliant', 4: 'Good', ...}
    RATING_NOTATION,        # {5: '!!', 4: '!', 3: '!?', ...}
    RATING_COLORS_HEX,      # FFmpeg format: {5: '0x66BB6A', ...}
    TAG_SHORT_NAMES,        # {'Goals': 'Goal', 'Assists': 'Assist', ...}
    get_rating_adjective,   # Helper functions
    get_rating_color_hex,
)
```

### Transition Strategies

Video clip concatenation uses the Strategy pattern for extensibility:

```python
from app.services.transitions import TransitionFactory, apply_transition

# Create specific transition strategy
strategy = TransitionFactory.create('dissolve')  # 'cut', 'fade', or 'dissolve'
success = strategy.concatenate(
    clip_paths=['clip1.mp4', 'clip2.mp4'],
    output_path='output.mp4',
    duration=0.5,  # transition duration in seconds
    include_audio=True
)

# Or use convenience function
success = apply_transition(
    transition_type='fade',
    clip_paths=['clip1.mp4', 'clip2.mp4'],
    output_path='output.mp4',
    duration=0.5
)
```

To add a new transition type, create a class implementing `TransitionStrategy` and register it with `TransitionFactory.register()`.

---

## Testing

### Test Organization

| Type | Location | Framework | Run Command |
|------|----------|-----------|-------------|
| **Backend Unit** | `src/backend/tests/` | pytest | `pytest tests/ -v` |
| **Frontend Unit** | Co-located with source (`*.test.js`) | Vitest | `npm test` |
| **E2E/Integration** | `src/frontend/e2e/` | Playwright | `npm run test:e2e` |

### Running Tests

```bash
# Frontend unit tests (342 tests)
cd src/frontend && npm test

# Backend unit tests (274 tests)
cd src/backend && .venv/Scripts/python -m pytest tests/ -v

# E2E tests (requires backend + frontend running)
# Terminal 1: cd src/backend && uvicorn app.main:app --port 8000
# Terminal 2: cd src/frontend && npm run dev
# Terminal 3:
cd src/frontend && npm run test:e2e

# E2E with visual UI (for debugging)
npm run test:e2e:ui
```

### E2E Test Data

Tests use data from `formal annotations/12.6.carlsbad/`:
- **Video**: `wcfc-vs-carlsbad-sc-2025-11-02-2025-12-08.mp4` (2.5GB)
- **TSV**: `12.6.carlsbad.tsv` (25 annotated clips)

### E2E Test Coverage

Tests are organized across multiple spec files:

**`full-workflow.spec.js`** - Core workflow and API tests:
- Project Manager loading, Annotate Mode (video upload, TSV import/export)
- Project creation, UI component tests (clip sidebar, star rating, clip editing)
- API integration tests (health, projects CRUD, games, clips)

**`regression-tests.spec.js`** - Smoke and full regression tests:
- Annotate: video frame loading, TSV import, timeline navigation
- Framing: video loading, export creates working video
- Overlay: video loading, highlight region initialization
- Import Into Projects workflow

**`game-loading.spec.js`** - Game loading specific tests:
- Load saved game into annotate mode
- Editor mode state changes on game load

### Manual Testing
- See [MANUAL_TEST.md](MANUAL_TEST.md) for manual UI procedures
- See `scripts/` folder for API and WebSocket test scripts

---

## Common Patterns

### Export Progress
- WebSocket connection for real-time updates
- Progress stages: init (10%) -> processing (20-80%) -> encoding (80-100%)
- Clip caching prevents re-encoding unchanged clips

### Error Handling
- Development: Full traceback in responses
- Production: Sanitized error messages
- Logging with `[Feature]` tags for filtering

### File Paths
```python
# Always use Path objects from database.py:
from app.database import RAW_CLIPS_PATH, UPLOADS_PATH, WORKING_VIDEOS_PATH
file_path = RAW_CLIPS_PATH / filename  # NOT f-strings
```

---

## Known Issues

See [KNOWN_BUGS.md](KNOWN_BUGS.md) for current issues and workarounds.

## Additional Documentation

- [CODE_SMELLS.md](CODE_SMELLS.md) - Refactoring opportunities and completed improvements
- [DEVELOPMENT.md](DEVELOPMENT.md) - Development setup guide
- [MANUAL_TEST.md](MANUAL_TEST.md) - Manual testing procedures
- [KNOWN_BUGS.md](KNOWN_BUGS.md) - Known issues and workarounds
- [prompt_preamble](prompt_preamble) - Detailed context for debugging
- [docs/](docs/) - Original phase specifications (historical)

---

## License

TBD
