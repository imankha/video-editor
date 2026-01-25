# Video Editor

A browser-based video editing application with three-mode workflow: **Annotate** (clip extraction), **Framing** (crop/upscale), and **Overlay** (highlight effects).

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 + Vite + Zustand (port 5173) |
| **Backend** | FastAPI + Python (uvicorn, port 8000) |
| **Database** | SQLite (per-user, synced to R2) |
| **Storage** | Cloudflare R2 (S3-compatible) |
| **Video Processing** | FFmpeg (required in PATH) |
| **AI Upscaling** | Real-ESRGAN, RIFE (optional) |
| **Testing** | Vitest (unit), Playwright (E2E) |

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
│   │       ├── websocket.py        # WebSocket manager (silent on disconnect)
│   │       ├── constants.py        # Shared constants (ratings, tags, colors)
│   │       ├── user_context.py     # Per-request user isolation (for tests)
│   │       ├── routers/            # API endpoints
│   │       │   ├── projects.py     # Project CRUD, state persistence
│   │       │   ├── clips.py        # Raw clips library + working clips
│   │       │   ├── games.py        # Game footage storage, annotations
│   │       │   ├── annotate.py     # Annotate export (creates clips + projects)
│   │       │   ├── exports.py      # Durable export jobs API
│   │       │   ├── export/         # Export endpoints (split by mode)
│   │       │   │   ├── __init__.py     # Aggregates sub-routers
│   │       │   │   ├── framing.py      # /crop, /upscale, /framing endpoints
│   │       │   │   ├── overlay.py      # /overlay, /final endpoints
│   │       │   │   ├── multi_clip.py   # /multi-clip, /chapters endpoints
│   │       │   │   └── before_after.py # Before/after comparison videos
│   │       │   ├── downloads.py    # Gallery/final video management
│   │       │   ├── storage.py      # R2 presigned URL redirects
│   │       │   ├── detection.py    # YOLO player/ball detection
│   │       │   ├── health.py       # Health checks
│   │       │   └── auth.py         # User isolation (for E2E tests)
│   │       ├── highlight_transform.py  # Smart highlight coordinate mapping
│   │       └── services/           # Business logic layer
│   │           ├── export_worker.py    # Background export job processor
│   │           ├── clip_cache.py       # Clip caching to avoid re-encoding
│   │           ├── clip_pipeline.py    # Clip processing pipeline
│   │           ├── video_processor.py  # Abstract GPU processing interface
│   │           ├── ffmpeg_service.py   # FFmpeg helper functions
│   │           ├── ffmpeg_errors.py    # FFmpeg error parsing
│   │           ├── local_gpu_processor.py  # Local GPU implementation
│   │           ├── image_extractor.py  # Frame extraction utilities
│   │           ├── progress_reporter.py # WebSocket progress updates
│   │           ├── r2_storage.py       # Cloudflare R2 storage integration
│   │           ├── db_sync.py          # SQLite <-> R2 sync with versioning
│   │           └── transitions/        # Video transition strategies
│   │               ├── base.py         # TransitionStrategy interface
│   │               ├── cut.py          # Simple concatenation
│   │               ├── fade.py         # Fade to black transition
│   │               └── dissolve.py     # Cross-dissolve transition
│   │
│   └── frontend/                   # React + Vite frontend
│       └── src/
│           ├── App.jsx             # Mode router (~345 lines, down from 2200)
│           ├── components/         # Shared UI components
│           │   ├── VideoPlayer.jsx
│           │   ├── ProjectManager.jsx
│           │   ├── ClipSelectorSidebar.jsx
│           │   ├── ExportButton.jsx        # Includes WebSocket + health check
│           │   ├── GlobalExportIndicator.jsx  # Global export progress toast
│           │   ├── GameDetailsModal.jsx    # Edit game metadata (opponent, date)
│           │   ├── GameClipSelectorModal.jsx  # Select clips from games
│           │   ├── DownloadsPanel.jsx
│           │   ├── shared/             # Shared components
│           │   │   ├── Breadcrumb.jsx       # Navigation breadcrumbs
│           │   │   ├── Button.jsx           # Styled button variants
│           │   │   ├── CollapsibleGroup.jsx # Collapsible UI sections
│           │   │   ├── ConfirmationDialog.jsx
│           │   │   ├── ExportProgress.jsx
│           │   │   ├── ModeSwitcher.jsx
│           │   │   ├── ServerStatus.jsx     # Server health banner
│           │   │   ├── StarRating.jsx       # 1-5 star rating input
│           │   │   ├── TagSelector.jsx      # Tag selection UI
│           │   │   └── Toast.jsx            # Toast notifications
│           │   └── timeline/       # Timeline components
│           ├── hooks/              # State management
│           │   ├── useProjects.js
│           │   ├── useProjectClips.js
│           │   ├── useClipManager.js
│           │   ├── useVideo.js
│           │   ├── useGames.js
│           │   ├── useProjectLoader.js   # Project loading logic
│           │   ├── useStorageUrl.js      # R2 presigned URL handling
│           │   ├── useKeyframeController.js
│           │   ├── useDownloads.js       # Gallery downloads management
│           │   ├── useRawClips.js        # Raw clips library access
│           │   ├── useExportManager.js   # Export job management
│           │   ├── useExportRecovery.js  # Resume interrupted exports
│           │   ├── useKeyboardShortcuts.js # Keyboard shortcuts
│           │   ├── useTimeline.js        # Timeline state management
│           │   └── useTimelineZoom.js    # Timeline zoom controls
│           ├── screens/            # Self-contained screen components
│           │   ├── ProjectsScreen.jsx    # Owns project selection
│           │   ├── AnnotateScreen.jsx    # Owns annotate workflow
│           │   ├── FramingScreen.jsx     # Owns video/crop/segment hooks
│           │   └── OverlayScreen.jsx     # Owns highlight hooks
│           ├── containers/         # Container components (state + logic)
│           │   ├── AnnotateContainer.jsx
│           │   ├── FramingContainer.jsx
│           │   └── OverlayContainer.jsx
│           ├── contexts/           # React contexts
│           │   ├── AppStateContext.jsx
│           │   ├── ProjectContext.jsx    # Project data provider │           │   └── index.js
│           ├── stores/             # Zustand state stores
│           │   ├── clipStore.js
│           │   ├── editorStore.js
│           │   ├── exportStore.js
│           │   ├── videoStore.js
│           │   ├── navigationStore.js    # App navigation state
│           │   ├── framingStore.js       # Framing persistence
│           │   ├── overlayStore.js       # Overlay state
│           │   ├── projectDataStore.js   # Loaded project data
│           │   ├── galleryStore.js       # Gallery/downloads state
│           │   └── gamesStore.js         # Games list state
│           ├── modes/              # Mode-specific code
│           │   ├── FramingModeView.jsx
│           │   ├── OverlayModeView.jsx
│           │   ├── AnnotateModeView.jsx
│           │   ├── framing/        # Crop, segments, overlays
│           │   ├── overlay/        # Highlight regions
│           │   │   └── hooks/useOverlayState.js
│           │   └── annotate/       # Clip marking, metadata
│           │       └── hooks/useAnnotateState.js
│           ├── controllers/        # Pure state machines
│           │   └── keyframeController.js
│           └── utils/              # Utilities
│               ├── timeFormat.js
│               ├── splineInterpolation.js
│               ├── keyframeUtils.js
│               └── storageUrls.js       # R2 URL generation helpers
│
├── user_data/{user_id}/            # Runtime data (gitignored, synced to R2)
│   ├── database.sqlite             # Per-user SQLite database
│   ├── raw_clips/                  # Library clips (from Annotate)
│   ├── uploads/                    # Direct uploads
│   ├── games/                      # Full game videos
│   ├── working_videos/             # Framing output
│   ├── final_videos/               # Overlay output
│   ├── clip_cache/                 # Cached processed clips
│   └── downloads/                  # Temp export files
│
├── plans/                          # Planning documents
│   └── tasks.md                    # Remaining tasks and roadmap
├── scripts/                        # Utility scripts
│   ├── verify.sh                   # Verification script
│   └── test_manual.md              # Manual test procedures
└── start-dev.bat                   # Windows quick start script
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
    game_id,               -- FK to games (source game)
    auto_project_id,       -- FK to projects (auto-created for 5-star)
    default_highlight_regions,  -- JSON: cross-project highlight reuse
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
    id, project_id, filename, version, duration,
    source_type,           -- 'brilliant_clip', 'custom_project', 'annotated_game'
    game_id,               -- FK to games (for annotated exports)
    name,                  -- Display name (for annotated exports)
    rating_counts,         -- JSON: rating snapshot at export time
    created_at
)

-- Before/After tracks: Links final videos to source footage
before_after_tracks (
    id, final_video_id,    -- FK to final_videos
    raw_clip_id,           -- FK to raw_clips (optional)
    source_path,           -- Path to source video
    start_frame, end_frame, -- Frame range in source
    clip_index,            -- Order in final video
    created_at
)

-- Games: Full game footage for Annotate mode
games (
    id, name, video_filename,
    opponent_name, game_date, game_type,      -- Game details (home/away/tournament)
    tournament_name,
    video_duration, video_width, video_height, video_size,  -- Video metadata (cached)
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

-- Export jobs: Durable background export tracking
export_jobs (
    id TEXT PRIMARY KEY,       -- UUID like 'export_abc123'
    project_id, type,          -- 'framing' | 'overlay' | 'multi_clip'
    status,                    -- 'pending' | 'processing' | 'complete' | 'error'
    error,                     -- Error message if failed
    input_data,                -- JSON blob of export parameters
    output_video_id,           -- FK to working_videos or final_videos
    output_filename,           -- Path to output file
    created_at, started_at, completed_at
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

### Architecture (Post-Refactor)

App.jsx was reduced from **2200 lines to ~345 lines** by making screens self-contained:

```jsx
// App.jsx is now a simple mode router
function App() {
  const { editorMode } = useEditorStore();

  if (!selectedProject && editorMode !== 'annotate') {
    return <ProjectsScreen />;
  }

  return (
    <ProjectProvider>
      {editorMode === 'framing' && <FramingScreen />}
      {editorMode === 'overlay' && <OverlayScreen />}
      {editorMode === 'annotate' && <AnnotateScreen />}
      <DownloadsPanel />
    </ProjectProvider>
  );
}
```

Each screen owns its hooks internally - no prop drilling from App.jsx.

### State Management
- **Zustand stores**: Global state (editorStore, exportStore, navigationStore, etc.)
- **Screen-owned hooks**: Each screen initializes its own useVideo, useCrop, etc.
- **Contexts**: ProjectContext for shared project data
- **useKeyframeController**: Pure state machine for keyframe operations

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

### Toast Notifications
Global toast system for user feedback:
```javascript
import { useToastStore } from '@/components/shared/Toast';

// Show toast notification
useToastStore.getState().addToast({
  type: 'success',  // 'success' | 'error' | 'info'
  title: 'Export complete',
  message: 'Video saved to downloads',
  action: { label: 'View', onClick: () => {} },  // optional
  duration: 5000,  // auto-dismiss (0 = no auto-dismiss)
});
```

---

## Services Layer

The backend uses a services layer for GPU-intensive operations, designed for future extensibility to WebGPU or cloud GPU processing.

### Video Processor Interface

```python
from app.services import VideoProcessor, ProcessingBackend, ProcessorFactory

# Available backends (enum)
ProcessingBackend.LOCAL_GPU   # Current: Real-ESRGAN on local GPU
ProcessingBackend.WEB_GPU     # Future: Browser-based processing
ProcessingBackend.CLOUD_GPU   # Future: Cloud GPU processing (Modal, etc.)
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

### Highlight Transformation

The `highlight_transform.py` module handles coordinate space mapping between raw clips and working videos:

```python
from app.highlight_transform import (
    transform_highlights_for_save,   # working_video -> raw_clip space
    transform_highlights_for_load,   # raw_clip -> working_video space
)

# Coordinate Spaces:
# - Raw Clip Space: Original video dimensions and timing
# - Working Video Space: After crop, trim, and speed modifications

# The transformation accounts for:
# - Crop keyframes (position and size changes)
# - Trim ranges (start/end cuts)
# - Segment speeds (slow-mo, fast-forward)
```

This enables highlights to persist correctly even when clips are re-cropped or re-trimmed.

### R2 Storage Integration

All user data is stored in Cloudflare R2 (S3-compatible):

```python
from app.services.r2_storage import r2_storage

# Upload file to R2
await r2_storage.upload_file(local_path, r2_key)

# Get presigned URL for direct download
url = await r2_storage.get_presigned_url(r2_key, expires_in=3600)

# Files are organized by user_id prefix:
# reel-ballers-users/{user_id}/games/video.mp4
# reel-ballers-users/{user_id}/database.sqlite
```

Database sync uses version tracking to minimize R2 operations - only syncs when version changes.

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
# Frontend unit tests
cd src/frontend && npm test

# Backend unit tests
cd src/backend && .venv/Scripts/python -m pytest tests/ -v

# E2E tests - IMPORTANT: Start servers manually first!
# Terminal 1:
cd src/backend && python -m uvicorn app.main:app --port 8000

# Terminal 2:
cd src/frontend && npm run dev

# Terminal 3:
cd src/frontend
npx playwright test              # Run all tests
npx playwright test --grep @smoke  # Fast smoke tests only
npx playwright test --grep @full   # Full coverage tests
npx playwright test --ui         # Visual UI mode (recommended)
```

**Note**: Playwright will NOT auto-start servers. This prevents zombie processes when tests are cancelled.

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

**`regression-tests.spec.js`** - Comprehensive regression tests:
- **Smoke tests** (@smoke): Quick sanity checks for each mode
- **Annotate**: video frame loading, TSV import, timeline navigation
- **Framing**: video loading, export creates working video, auto-navigate to overlay
- **Overlay**: video loading after export, highlight region initialization
- **Import Into Projects**: Full annotation → project workflow
- **Video first frame validation**: Ensures video content actually renders (not just metadata)

**`game-loading.spec.js`** - Game loading specific tests:
- Load saved game into annotate mode
- Editor mode state changes on game load

### Manual Testing
- See [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md) for manual UI procedures
- See `scripts/` folder for API and WebSocket test scripts

---

## Common Patterns

### Durable Export Architecture

Exports are designed to survive browser closes:

```
┌─────────────┐                  ┌─────────────┐
│  Frontend   │                  │   Backend   │
│             │                  │             │
│ Start Export│──POST /exports──►│ Create job  │
│             │◄─── job_id ──────│ Return ID   │
│             │                  │             │
│  WebSocket  │◄── progress ─────│ (optional)  │
│  (optional) │                  │             │
│             │                  │             │
│ On Return   │──GET /projects──►│ Check jobs  │
│             │◄── status ───────│             │
└─────────────┘                  └─────────────┘
```

**Key Design Principle:** WebSocket is optional, not required.
- Connected → show real-time progress
- Disconnected → export continues silently, no errors
- User returns → check database for completion status

### Export Progress
- WebSocket connection for real-time updates (optional)
- Health check before export starts (3s timeout)
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

## Roadmap & Known Issues

See [plans/tasks.md](plans/tasks.md) for:
- Remaining refactoring tasks (AnnotateScreen, Gallery, App.jsx cleanup)
- OpenCV to FFmpeg migration (backend video processing)
- Known issues and architectural decisions

## Additional Documentation

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - Development setup guide
- [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md) - Manual testing procedures
- [docs/REFERENCE/](docs/REFERENCE/) - AI upscaling and model testing docs
- [src/backend/README.md](src/backend/README.md) - Backend setup and API reference
- [src/backend/MULTI_GPU_GUIDE.md](src/backend/MULTI_GPU_GUIDE.md) - Multi-GPU AI upscaling

---

## License

TBD
