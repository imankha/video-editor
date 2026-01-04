# Code Smells & Refactoring Opportunities

This document identifies Martin Fowler-style code smells and refactoring opportunities in the video editor codebase. Organized by severity and effort.

---

## High Priority (Significant Technical Debt)

### 1. God Class: App.jsx (4,000+ lines)
**Smell**: Large Class, Feature Envy, Long Method

**Location**: [App.jsx](src/frontend/src/App.jsx)

**Status**: IN PROGRESS - Analysis complete, detailed refactoring plan created

**Problem**:
- Single file handles ALL application state for 3 different modes
- 100+ useState hooks in one component
- Mode-specific logic mixed together (framing, overlay, annotate)
- Handles video state for 3 separate video players
- Contains business logic that should be in hooks/services

**Evidence**:
```javascript
// Lines 38-120: ~80 useState declarations
const [videoFile, setVideoFile] = useState(null);
const [dragCrop, setDragCrop] = useState(null);
const [editorMode, setEditorMode] = useState('framing');
const [overlayVideoFile, setOverlayVideoFile] = useState(null);
const [annotateVideoFile, setAnnotateVideoFile] = useState(null);
// ... 70+ more
```

**Current Architecture Analysis** (completed):
- Mode components already exist: `FramingMode.jsx`, `OverlayMode.jsx`, `AnnotateMode.jsx`
- Contexts already exist: `CropContext.jsx`, `HighlightContext.jsx`
- State is passed from App.jsx to mode components via 40+ props per component
- The "prop drilling" pattern is the main issue

**Refactoring Plan** (incremental approach):

**Phase 1: Create Mode State Hooks** ✅ COMPLETED
- ~~Create `useFramingState.js`~~ - Framing already uses `useCrop` and `useSegments` hooks
- ✅ Created [useOverlayState.js](src/frontend/src/modes/overlay/hooks/useOverlayState.js) (23 tests)
  - Consolidates overlay video state, clip metadata, drag state, effect type
  - Provides `loadOverlayVideoFromUrl()`, `loadOverlayVideoFromFile()`, `resetOverlayState()`
- ✅ Created [useAnnotateState.js](src/frontend/src/modes/annotate/hooks/useAnnotateState.js) (23 tests)
  - Consolidates annotate video state, game ID, loading states, playback settings
  - Provides `loadAnnotateVideoFromUrl()`, `loadAnnotateVideoFromFile()`, `resetAnnotateState()`, `toggleFullscreen()`, `cyclePlaybackSpeed()`
- ✅ Added comprehensive tests for [useHighlightRegions.js](src/frontend/src/modes/overlay/hooks/useHighlightRegions.test.js) (53 tests)
- All 215 frontend tests pass

**Phase 2: Mode State Integration** ✅ COMPLETED
- ✅ App.jsx now uses `useOverlayState()` hook instead of 8 individual useState calls
  - Removed: overlayVideoFile, overlayVideoUrl, overlayVideoMetadata, overlayClipMetadata, isLoadingWorkingVideo, dragHighlight, selectedHighlightKeyframeTime, highlightEffectType
  - Also removed overlay persistence refs (pendingOverlaySaveRef, overlayDataLoadedRef)
- ✅ App.jsx now uses `useAnnotateState()` hook instead of 12 individual useState calls
  - Removed: annotateVideoFile, annotateVideoUrl, annotateVideoMetadata, annotateGameId, isCreatingAnnotatedVideo, isImportingToProjects, isUploadingGameVideo, annotatePlaybackSpeed, annotateFullscreen, showAnnotateOverlay, annotateSelectedLayer
  - Also removed annotate refs (annotateContainerRef, annotateFileInputRef)
- All 215 frontend tests and 159 backend tests pass

**Phase 3: Cross-Mode State Management** ✅ COMPLETED
- ✅ Created [AppStateContext.jsx](src/frontend/src/contexts/AppStateContext.jsx) following existing context pattern
- ✅ Context provides: editorMode, selectedProject, exportingProject, globalExportProgress, downloadsCount
- ✅ Updated ExportButton to use context (reduced 8 props)
- ✅ Updated ModeSwitcher to use context (reduced 2 props: hasProject, hasWorkingVideo)
- ✅ Updated ProjectManager to use context (reduced 2 props: downloadsCount, exportingProject)
- ✅ Added 4 unit tests for AppStateContext
- All 219 frontend tests and 159 backend tests pass

**Phase 4: Video State Unification** (0.5 day)
- Create `useVideoState(mode)` hook that returns the appropriate video state
- Replaces separate `videoFile`, `overlayVideoFile`, `annotateVideoFile`
- Simplifies VideoPlayer integration

**Testing Strategy**:
- Each phase should leave the app fully functional
- Run `npm run build` after each phase
- Manual testing of each mode after changes

**Effort**: High (2-3 days)

**Priority**: This is the next major refactoring target

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

### 6. Long Parameter Lists
**Smell**: Long Parameter List, Data Clump

**Status**: ✅ PARTIALLY ADDRESSED

**Locations**:
- [multi_clip.py](src/backend/app/routers/export/multi_clip.py) - `process_single_clip()` has 8 parameters
- [App.jsx](src/frontend/src/App.jsx) - `ExportButton` receives ~16 props (down from 25+)

**Progress**:

1. **Frontend (ExportButton)**: Significantly improved via AppStateContext (Phase 3)
   - Reduced from 25+ props to ~16 props
   - 7+ props now derived from context: `editorMode`, `projectId`, `projectName`, `onExportStart`, `onExportEnd`, `isExternallyExporting`, `externalProgress`
   - Remaining props are mode-specific data that must be passed (video file, keyframes, etc.)

2. **Backend**: `ProcessingConfig` dataclass exists in [video_processor.py](src/backend/app/services/video_processor.py)
   - Contains: `target_fps`, `export_mode`, `include_audio`, `crop_keyframes`, `segment_data`
   - Could be used more consistently across export functions
   - Current 8 parameters in `process_single_clip` are reasonable

**Remaining Work** (low priority):
- Refactor `process_single_clip` to use `ProcessingConfig` dataclass
- Consider grouping remaining ExportButton props into typed objects

**Effort**: Low (remaining items are minor improvements)

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

### 8. Magic Numbers/Strings
**Smell**: Magic Number, Magic String

**Status**: PARTIALLY COMPLETED - Video processing constants extracted

**Completed**:
- ✅ Extracted `VIDEO_MAX_WIDTH = 2560` and `VIDEO_MAX_HEIGHT = 1440` to [constants.py](src/backend/app/constants.py)
- ✅ Extracted `AI_UPSCALE_FACTOR = 4` to constants.py
- ✅ Updated [ai_upscaler/__init__.py](src/backend/app/ai_upscaler/__init__.py) to use constants
- ✅ Updated [multi_clip.py](src/backend/app/routers/export/multi_clip.py) to use constants

**Remaining**:
```python
# database.py
USER_ID = "a"  # Single-user hardcoded (kept as-is, clear intent)

# App.jsx
// Maximum file size: 4GB - mentioned in docs but not enforced
```

**Effort**: Low (remaining items are minor)

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

### 10. Nested Callbacks: Export Progress
**Smell**: Callback Hell, Message Chain

**Location**: [export.py](src/backend/app/routers/export.py) - progress_callback usage

**Problem**: Deep callback nesting for progress reporting.

```python
async def process_single_clip(..., progress_callback, ...):
    # ... processing
    if progress_callback:
        progress_callback(1, 1, "Using cached result", 'cached')
```

**Refactoring**:
1. **Observer Pattern**: Use events/pub-sub for progress
2. **AsyncIO Queues**: Use proper async patterns

**Effort**: Medium (1 day)

---

## Low Priority (Minor Issues)

### 11. Comments as Code Smell
**Smell**: Comments explaining what (not why)

**Locations throughout**:
```python
# Get clip durations
durations = [get_video_duration(path) for path in clip_paths]

# Build FFmpeg command
cmd = ['ffmpeg', '-y']
```

These comments explain obvious code. Better to have self-documenting code.

**Refactoring**: Remove obvious comments, add "why" comments where needed.

**Effort**: Ongoing (as code is touched)

---

### 12. Boolean Parameters
**Smell**: Boolean Blindness

**Locations**:
```python
def extract_clip_to_file(..., use_cache: bool = True):
async def create_clip_with_burned_text(..., use_cache: bool = True):
```

```javascript
includeAudio={true}
isHighlightEnabled={editorMode === 'overlay' && highlightRegions.length > 0}
```

**Refactoring**: Consider enum types or separate methods.

**Effort**: Low (ongoing)

---

### 13. Temporal Coupling
**Smell**: Temporal Coupling

**Location**: [export.py](src/backend/app/routers/export.py) - multi-clip export

**Problem**: Steps must be called in specific order but nothing enforces this:
1. Save video to temp
2. Compute cache key
3. Check cache
4. Process if miss
5. Store in cache

**Refactoring**: Use pipeline/builder pattern to enforce order.

**Effort**: Medium (1 day)

---

### 14. Incomplete Error Handling
**Smell**: Incomplete Library Class

**Location**: Various FFmpeg subprocess calls

**Problem**: FFmpeg errors captured but not always properly parsed/reported.

```python
result = subprocess.run(cmd, capture_output=True, text=True)
if result.returncode != 0:
    logger.error(f"[Multi-Clip] Fade error: {result.stderr}")
    raise RuntimeError(f"FFmpeg fade transition failed: {result.stderr}")
```

**Refactoring**: Create FFmpegError class, parse common error patterns.

**Effort**: Low (0.5 days)

---

## Architectural Improvements

### 15. Consider State Management Library
**Smell**: Data Class (anti-pattern for React)

**Problem**: App.jsx manages state through 100+ useState hooks. This is complex to reason about and test.

**Options**:
1. **Zustand**: Lightweight, works well with hooks
2. **Jotai**: Atomic state management
3. **XState**: For complex state machines (mode switching)

**Effort**: High (3-5 days) - but significant maintainability improvement

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
| High | App.jsx God Class | 2-3 days | Very High | **In Progress** (Phase 1-3 ✅, Phase 4 pending) |
| Medium | OpenCV Frame Extraction | 2-3 days | Medium | Workaround applied, FFmpeg refactor pending |
| Medium | JSON Primitive Obsession | 0.5 day | Medium | ✅ Completed (schemas.py) |
| Medium | Feature Envy (clip name) | N/A | Low | ✅ Analyzed - Intentional |
| Medium | Long Parameter Lists | Low | Medium | ✅ Partially addressed (AppStateContext) |
| Low | Unused transform_data | 0.5 hours | Low | ✅ Completed |
| Low | Magic Numbers | 2-3 hours | Low | ✅ Video processing constants done |
| Medium | progress/exported_at | 0.5 hours | Medium | ✅ Completed |

---

## Recommended Refactoring Order

1. **Next**: App.jsx mode extraction (follow 4-phase plan above)
2. **Ongoing**: Address smaller issues as files are touched

---

## Notes for AI Assistants

When working on this codebase:
1. **App.jsx**: Treat this file carefully. It's large and interconnected. Follow the 4-phase refactoring plan incrementally. Small changes can have unexpected effects.
2. **Export pipeline**: Test with actual video files after changes. FFmpeg behavior varies. Use the new transition strategy pattern for adding new transition types.
3. **Database migrations**: The codebase uses auto-migration. Test with existing databases.
4. **Mode interactions**: Changes in one mode may affect others through shared state.
5. **Services layer**: New GPU-intensive code should implement the `VideoProcessor` interface in `app/services/video_processor.py`.
6. **Constants**: All rating/tag constants should be imported from `app/constants.py` - never define duplicates.
7. **Transitions**: Use `TransitionFactory.create('fade')` or `apply_transition()` from `app/services/transitions/` for video concatenation.
