# Code Smells & Refactoring Opportunities

This document identifies Martin Fowler-style code smells and refactoring opportunities in the video editor codebase. Organized by severity and effort.

---

## High Priority (Significant Technical Debt)

### 1. God Class: App.jsx (4,000+ lines)
**Smell**: Large Class, Feature Envy, Long Method

**Location**: [App.jsx](src/frontend/src/App.jsx)

**Status**: IN PROGRESS - See [APP_REFACTOR_PLAN.md](APP_REFACTOR_PLAN.md) for detailed plan

**Problem**:
- Single file handles ALL application state for 3 different modes
- 100+ useState hooks in one component
- Mode-specific logic mixed together (framing, overlay, annotate)
- Handles video state for 3 separate video players
- Contains business logic that should be in hooks/services

**Authoritative Plan**: [APP_REFACTOR_PLAN.md](APP_REFACTOR_PLAN.md)

**Current Progress** (from APP_REFACTOR_PLAN.md):

| Phase | Task | Status |
|-------|------|--------|
| 1.1 | Create useVideoStore | ✅ Complete |
| 1.2 | Create useClipStore | ✅ Complete |
| 2.1 | Extract useKeyboardShortcuts | ✅ Complete |
| 2.2 | Extract useExportWebSocket | ✅ Complete |
| 3.1 | Extract AnnotateContainer | 🟡 Container created, App.jsx integration pending |
| 3.2 | Extract OverlayContainer | 🟡 Container created, App.jsx integration pending |
| 3.3 | Extract FramingContainer | 🟡 Container created, App.jsx integration pending |

**Target Architecture**:
```
src/frontend/src/
├── App.jsx                        (~200 lines - down from 4088)
├── containers/
│   ├── AnnotateContainer.jsx      (~800 lines) ✅ Created
│   ├── OverlayContainer.jsx       (~700 lines) ✅ Created
│   └── FramingContainer.jsx       (~900 lines) ✅ Created
├── stores/
│   ├── videoStore.js              ✅ Created
│   └── clipStore.js               ✅ Created
└── hooks/
    ├── useKeyboardShortcuts.js    ✅ Created
    └── useExportWebSocket.js      ✅ Created
```

**Next Step**: Integrate containers into App.jsx (replace ~500 lines per container)

**Effort**: High (2-3 days remaining for integration)

**Priority**: This is the active refactoring target

---

## Medium Priority (Code Quality Issues)

### 3. OpenCV Frame Extraction Limitations
**Smell**: Inappropriate Intimacy (with OpenCV quirks), Data Clump

**Location**: [ai_upscaler/__init__.py](src/backend/app/ai_upscaler/__init__.py) - `process_video_with_upscale()`

**Problem**: OpenCV's `cv2.CAP_PROP_FRAME_COUNT` and frame seeking are unreliable for certain video formats, causing exports to be shorter than source videos.

**Root Cause**:
- **Container metadata mismatch**: MP4 containers store duration/frame count metadata separately from actual decodable frames
- **Incomplete GOPs**: H.264 encodes frames in Groups of Pictures. If recording stopped mid-GOP, metadata declares frames that aren't fully decodable
- **Variable Frame Rate (VFR)**: Screen recordings often have VFR, causing discrepancies between declared and actual frame counts
- **Seek inaccuracy**: OpenCV's `CAP_PROP_POS_FRAMES` seek can skip frames for certain codecs

**Evidence**:
```
# Browser reports (from container metadata): 11.243s, 309 frames
# OpenCV can actually decode: 11.099s, 304 frames
# Result: Exported video is ~0.14s shorter than source
```

**Current Workaround** (implemented):
```python
# Use minimum of ffprobe and OpenCV frame counts
video_total_frames = min(ffprobe_frame_count, opencv_total_frames)

# Binary search to find actual last readable frame
if not cap.read() at last_frame:
    # Find actual_last via binary search
    video_total_frames = actual_last + 1
```

**Proper Refactoring** (future work):
1. **Use FFmpeg for frame extraction** instead of OpenCV
   - FFmpeg handles edge cases more gracefully
   - Consistent with encoding pipeline (already uses FFmpeg)
   - Better VFR support

2. **Implementation approach**:
   ```python
   # Instead of OpenCV frame-by-frame:
   cap = cv2.VideoCapture(path)
   while cap.read(): ...

   # Use FFmpeg to extract all frames at once:
   ffmpeg -i input.mp4 -vsync 0 frames/frame_%06d.png
   ```

3. **Benefits**:
   - Eliminates frame count mismatch between browser preview and export
   - More reliable handling of VFR and edge cases
   - Single dependency (FFmpeg) instead of FFmpeg + OpenCV

**Trade-offs**:
- FFmpeg extraction is all-or-nothing (can't process frames incrementally)
- Higher disk I/O (must extract all frames before processing)
- Current OpenCV approach allows frame-by-frame processing with progress updates

**Effort**: Medium-High (2-3 days)
- Refactor frame extraction to use FFmpeg subprocess
- Update progress reporting to work with batch extraction
- Test with VFR and edge-case videos

---

### 4. Primitive Obsession: JSON Columns
**Smell**: Primitive Obsession, Stringly Typed

**Status**: ✅ COMPLETED - Pydantic models created

**Location**: [schemas.py](src/backend/app/schemas.py)

**Problem**: Complex data structures stored as JSON strings in TEXT columns, parsed/serialized repeatedly.

**Resolution**:
Created comprehensive Pydantic models for all JSON columns:

```python
from app.schemas import (
    # Crop data (working_clips.crop_data)
    CropKeyframe, CropData,
    # Timing data (working_clips.timing_data)
    TimingData,
    # Segments data (working_clips.segments_data)
    SegmentsData,
    # Highlights data (working_videos.highlights_data)
    HighlightKeyframe, HighlightRegion, HighlightsData,
    # Helper parsers
    parse_crop_data, parse_timing_data, parse_segments_data, parse_highlights_data
)
```

**Benefits for AI maintainability**:
- Self-documenting schemas with type hints and descriptions
- AI can immediately understand data shapes without searching
- Field-level documentation explains valid values and defaults
- Validation prevents malformed data
- 40 unit tests verify all schemas

**Usage example**:
```python
# Parse JSON from database
crop_data = parse_crop_data(json_string)
if crop_data:
    for kf in crop_data.keyframes:
        print(kf.x, kf.y, kf.width, kf.height)

# Serialize for storage
json_string = json.dumps(crop_data.to_json_list())
```

**Effort**: Low (0.5 day - less than estimated)

---

### 5. Feature Envy: Clip Name Derivation
**Smell**: Feature Envy, Duplicated Code

**Status**: ✅ ANALYZED - Intentional Strategic Duplication

**Locations**:
- [queries.py](src/backend/app/queries.py) - `derive_clip_name()` (15 tests)
- [soccerTags.js](src/frontend/src/modes/annotate/constants/soccerTags.js) - `generateClipName()`

**Analysis**:
The same business logic exists in both Python and JavaScript, but this is **intentional** due to different use cases:

1. **Frontend** (`generateClipName`): Used in Annotate mode for **live preview** of clips being created. These clips are in-browser only and not yet persisted to the database. Calling an API would add unnecessary latency during real-time editing.

2. **Backend** (`derive_clip_name`): Used in API responses to derive names for **already-saved clips**. Also handles the `stored_name` parameter for custom names.

**Verification**:
- Backend has 15 unit tests including 4 "frontend parity" tests
- Tests like `test_frontend_parity_brilliant_goal` verify both produce identical output
- Tag name conversion (full → short) happens on TSV export, so both receive short names

**Decision**: Keep both implementations. The latency cost of server-side-only derivation during real-time editing outweighs the duplication cost. Both are tested and match.

**Effort**: N/A (no refactoring needed)

---

### 6. Long Parameter Lists ✅ COMPLETED
**Smell**: Long Parameter List, Data Clump

**Status**: ✅ COMPLETED - Reasonable parameter counts achieved

**Locations**:
- [multi_clip.py](src/backend/app/routers/export/multi_clip.py) - `process_single_clip()` has 8 parameters
- [App.jsx](src/frontend/src/App.jsx) - `ExportButton` receives ~16 props (down from 25+)

**Resolution**:

1. **Frontend (ExportButton)**: Significantly improved via AppStateContext (Phase 3)
   - Reduced from 25+ props to ~16 props
   - 7+ props now derived from context: `editorMode`, `projectId`, `projectName`, `onExportStart`, `onExportEnd`, `isExternallyExporting`, `externalProgress`
   - Remaining props are mode-specific data that must be passed (video file, keyframes, etc.)

2. **Backend**: `ProcessingConfig` dataclass exists in [video_processor.py](src/backend/app/services/video_processor.py)
   - Contains: `target_fps`, `export_mode`, `include_audio`, `crop_keyframes`, `segment_data`
   - The 8 parameters in `process_single_clip` are reasonable and well-organized
   - Parameters naturally group into: input data (2), infrastructure (2), settings (3), callback (1)

**Decision**: The current parameter counts are acceptable. Further refactoring would add complexity without meaningful benefit.

**Effort**: Low (complete)

---

### 7. Speculative Generality: transform_data Column
**Smell**: Speculative Generality, Dead Code

**Status**: ✅ COMPLETED

**Location**: [database.py](src/backend/app/database.py) - `working_clips` table

**Problem**: `transform_data` column was defined but never used anywhere.

**Resolution**:
- Removed from new database schema (fresh installs won't have this column)
- Removed from Pydantic models in clips.py
- Removed from all SELECT, INSERT, UPDATE queries
- Migration kept for backward compatibility (existing DBs have harmless column)

**Effort**: Low (0.5 hours)

---

### 8. Magic Numbers/Strings ✅ COMPLETED
**Smell**: Magic Number, Magic String

**Status**: ✅ COMPLETED - All significant constants extracted

**Resolution**:
- ✅ Extracted `VIDEO_MAX_WIDTH = 2560` and `VIDEO_MAX_HEIGHT = 1440` to [constants.py](src/backend/app/constants.py)
- ✅ Extracted `AI_UPSCALE_FACTOR = 4` to constants.py
- ✅ Extracted `DEFAULT_USER_ID = "a"` to constants.py with documentation explaining single-user design
- ✅ Updated [database.py](src/backend/app/database.py) to import from constants.py
- ✅ Updated [ai_upscaler/__init__.py](src/backend/app/ai_upscaler/__init__.py) to use constants
- ✅ Updated [multi_clip.py](src/backend/app/routers/export/multi_clip.py) to use constants

**Notes**:
- The "4GB" file size in App.jsx is informational UI text, not a hard limit. No constant needed.
- All significant magic numbers/strings now have named constants with documentation.

**Effort**: Low (complete)

---

### 9. Inconsistent Naming: progress vs exported_at
**Smell**: Inconsistent Naming, Middle Man

**Status**: ✅ COMPLETED

**Location**: [clips.py](src/backend/app/routers/clips.py), [database.py](src/backend/app/database.py), [projects.py](src/backend/app/routers/projects.py)

**Problem**: Database migration left dual concepts:
- `progress INTEGER` - Old field (0 = not exported, 1 = exported)
- `exported_at TIMESTAMP` - New field (NULL = not exported)

Both were checked in different places, creating confusion.

**Resolution**:
- Fresh installs use only `exported_at` (no `progress` column in schema)
- Migration code in `database.py` converts old `progress` values to `exported_at` timestamps
- Updated `discard_uncommitted_changes()` in `projects.py` to use `exported_at IS NULL` instead of `progress = 0`
- All queries now consistently use `exported_at`

**Effort**: Low (0.5 hours - was simpler than estimated)

---

### 10. Nested Callbacks: Export Progress ✅ COMPLETED
**Smell**: Callback Hell, Message Chain

**Location**: [export.py](src/backend/app/routers/export.py) - progress_callback usage

**Problem**: Deep callback nesting for progress reporting.

```python
async def process_single_clip(..., progress_callback, ...):
    # ... processing
    if progress_callback:
        progress_callback(1, 1, "Using cached result", 'cached')
```

**Solution Implemented**:
- ✅ Created [progress_reporter.py](src/backend/app/services/progress_reporter.py) with:
  - `ProgressReporter` class that centralizes progress tracking
  - `ProgressPhase` enum for typed phase management
  - `create_clip_progress_reporter()` helper for multi-clip exports
  - Backward-compatible `as_callback()` and `from_callback()` methods
  - Sub-reporter pattern for nested operations
- ✅ Added 24 tests in [test_progress_reporter.py](src/backend/tests/test_progress_reporter.py)
- New code should use `ProgressReporter` instead of ad-hoc callbacks

**Effort**: Medium (1 day)

---

## Low Priority (Minor Issues)

### 11. Comments as Code Smell ✅ ADDRESSED
**Smell**: Comments explaining what (not why)

**Status**: Cleaned up obvious "what" comments

**Changes Made**:
- Removed obvious comments from `ffmpeg_service.py`, `cut.py`, `dissolve.py`, `fade.py`
- Kept useful section headers and "why" comments
- Examples removed: `# Get clip durations`, `# Build FFmpeg command`, `# Combine filters`

**Ongoing**: Continue removing obvious comments when touching code.

**Effort**: Low (complete for existing violations)

---

### 12. Boolean Parameters ✅ REVIEWED
**Smell**: Boolean Blindness

**Status**: Reviewed and found acceptable

**Analysis**:
- Current boolean parameters are well-named (`use_cache`, `include_audio`, `enable_multi_gpu`)
- Each has clear semantics and documentation
- No cases of confusing `func(true, false, true)` call sites
- AIVideoUpscaler has 5 boolean params but all are optional with sensible defaults

**Decision**: No refactoring needed. Boolean parameters are appropriate for simple on/off flags.

**Effort**: N/A (no changes needed)

---

### 13. Temporal Coupling ✅ COMPLETED
**Smell**: Temporal Coupling

**Location**: [export.py](src/backend/app/routers/export.py) - multi-clip export

**Problem**: Steps must be called in specific order but nothing enforces this:
1. Save video to temp
2. Compute cache key
3. Check cache
4. Process if miss
5. Store in cache

**Solution Implemented**:
- ✅ Created [clip_pipeline.py](src/backend/app/services/clip_pipeline.py) with:
  - `ClipProcessingPipeline` class with explicit stages (INIT → SAVED → CONFIGURED → CACHE_CHECKED → PROCESSED → CACHED)
  - `PipelineError` exception raised when operations called out of order
  - `ClipProcessingContext` dataclass holding all processing state
  - `process_clip_with_pipeline()` convenience function
- ✅ Added 19 tests in [test_clip_pipeline.py](src/backend/tests/test_clip_pipeline.py)
- Each stage validates prerequisites before proceeding
- New exports can use the pipeline for guaranteed correct order

**Effort**: Medium (1 day)

---

### 14. Incomplete Error Handling ✅ COMPLETED
**Smell**: Incomplete Library Class

**Location**: Various FFmpeg subprocess calls

**Problem**: FFmpeg errors captured but not always properly parsed/reported.

```python
result = subprocess.run(cmd, capture_output=True, text=True)
if result.returncode != 0:
    logger.error(f"[Multi-Clip] Fade error: {result.stderr}")
    raise RuntimeError(f"FFmpeg fade transition failed: {result.stderr}")
```

**Solution Implemented**:
- ✅ Created [ffmpeg_errors.py](src/backend/app/services/ffmpeg_errors.py) with:
  - `FFmpegError` exception class with categorized error types
  - `FFmpegErrorType` enum (FILE_NOT_FOUND, PERMISSION_DENIED, INVALID_DATA, etc.)
  - `run_ffmpeg()` helper function for standardized error handling
  - Error pattern matching for common FFmpeg errors
- ✅ Added 32 tests in [test_ffmpeg_errors.py](src/backend/tests/test_ffmpeg_errors.py)
- New code should use `run_ffmpeg()` for consistent error handling

**Effort**: Low (0.5 days)

---

## Architectural Improvements

### 15. State Management with Zustand
**Smell**: Data Class (anti-pattern for React)

**Status**: ✅ COMPLETED

**Problem**: App.jsx still has ~20 useState hooks for cross-cutting concerns that aren't consolidated into domain hooks. Components access this state via prop drilling through 40+ props.

**Analysis**: Many state groups are ALREADY consolidated into hooks:
- ✅ `useVideo` - video playback state
- ✅ `useOverlayState` - overlay mode state
- ✅ `useAnnotateState` - annotate mode state
- ✅ `useClipManager` - clip management
- ✅ `useProjects` - project management

**Remaining non-consolidated state** (targets for Zustand):
1. Editor mode: `editorMode`, `modeSwitchDialog`, `selectedLayer`
2. Export tracking: `exportProgress`, `exportingProject`, `globalExportProgress`
3. UI flags: `includeAudio`, `framingChangedSinceExport`

**Implementation Plan**:

| Task | Status | Description |
|------|--------|-------------|
| 15.1 Install Zustand | ✅ Done | Add zustand dependency |
| 15.2 Create editorStore | ✅ Done | editorMode, modeSwitchDialog, selectedLayer (14 tests) |
| 15.3 Create exportStore | ✅ Done | exportProgress, exportingProject, globalExportProgress (15 tests) |
| 15.4 Integrate editorStore | ✅ Done | App.jsx now uses editorStore for mode state |
| 15.5 Integrate exportStore | ✅ Done | App.jsx now uses exportStore for export state |
| 15.6 Remove props from App.jsx | ✅ Done | Removed 6 useState declarations, using stores |
| 15.7 Add store tests | ✅ Done | 29 tests total (14 editor + 15 export) |

**Benefits**:
- Components access state directly (no prop drilling)
- Stores can be tested in isolation
- DevTools support for debugging
- Cleaner App.jsx

**Effort**: Medium (2-3 days)

---

### 16. Service Layer Pattern
**Smell**: Transaction Script

**Problem**: Business logic mixed into router handlers. Makes testing harder.

**Current**:
```python
@router.post("/export")
async def export(...):
    # All logic here: validation, processing, DB updates
```

**Improved**:
```python
# service layer
class ExportService:
    def process_clip(self, config: ExportConfig) -> ExportResult:
        # Business logic here

# router layer
@router.post("/export")
async def export(...):
    return await export_service.process_clip(config)
```

**Effort**: High (2-3 days per router)

---

## Summary by Effort

| Priority | Issue | Effort | Impact | Status |
|----------|-------|--------|--------|--------|
| High | App.jsx God Class | 2-3 days | Very High | **In Progress** - See [APP_REFACTOR_PLAN.md](APP_REFACTOR_PLAN.md) |
| Medium | OpenCV Frame Extraction | 2-3 days | Medium | Workaround applied, FFmpeg refactor pending |
| Medium | JSON Primitive Obsession | 0.5 day | Medium | ✅ Completed (schemas.py) |
| Medium | Feature Envy (clip name) | N/A | Low | ✅ Analyzed - Intentional |
| Medium | Long Parameter Lists | Low | Medium | ✅ Partially addressed (AppStateContext) |
| Low | Unused transform_data | 0.5 hours | Low | ✅ Completed |
| Low | Magic Numbers | 2-3 hours | Low | ✅ Completed |
| Medium | progress/exported_at | 0.5 hours | Medium | ✅ Completed |

---

## Recommended Refactoring Order

1. **Active**: App.jsx container integration (see [APP_REFACTOR_PLAN.md](APP_REFACTOR_PLAN.md))
2. **Ongoing**: Address smaller issues as files are touched

---

## Notes for AI Assistants

When working on this codebase:
1. **App.jsx**: Read [APP_REFACTOR_PLAN.md](APP_REFACTOR_PLAN.md) first. It contains the complete refactoring plan with progress tracking. The file is large and interconnected - small changes can have unexpected effects.
2. **Export pipeline**: Test with actual video files after changes. FFmpeg behavior varies. Use the new transition strategy pattern for adding new transition types.
3. **Database migrations**: The codebase uses auto-migration. Test with existing databases.
4. **Mode interactions**: Changes in one mode may affect others through shared state.
5. **Services layer**: New GPU-intensive code should implement the `VideoProcessor` interface in `app/services/video_processor.py`.
6. **Constants**: All rating/tag constants should be imported from `app/constants.py` - never define duplicates.
7. **Transitions**: Use `TransitionFactory.create('fade')` or `apply_transition()` from `app/services/transitions/` for video concatenation.
