# Code Smells & Refactoring Opportunities

This document identifies Martin Fowler-style code smells and refactoring opportunities in the video editor codebase. Organized by severity and effort.

---

## Completed Refactors

### ✅ Duplicated Rating/Tag Constants (COMPLETED)
**Status**: Resolved

**What was done**:
- Created [constants.py](src/backend/app/constants.py) as single source of truth for all rating/tag constants
- Contains: `RATING_ADJECTIVES`, `RATING_NOTATION`, `RATING_COLORS_HEX`, `RATING_COLORS_CSS`, `TAG_SHORT_NAMES`
- Helper functions: `get_rating_adjective()`, `get_rating_notation()`, `get_rating_color_hex()`, `get_tag_short_name()`
- Updated [queries.py](src/backend/app/queries.py), [annotate.py](src/backend/app/routers/annotate.py), [games.py](src/backend/app/routers/games.py) to import from constants

**Remaining**: Frontend still has duplicate constants in `soccerTags.js`. Consider serving via API endpoint for full unification.

---

### ✅ GPU Processing Interface (COMPLETED)
**Status**: Resolved - Created extensible architecture for future WebGPU/RunPod support

**What was done**:
- Created [video_processor.py](src/backend/app/services/video_processor.py) - Abstract interface with:
  - `ProcessingBackend` enum: `LOCAL_GPU`, `WEB_GPU`, `RUNPOD`, `CPU_ONLY`
  - `ProcessingConfig` dataclass for standardized input
  - `ProcessingResult` dataclass for standardized output
  - `ProcessorFactory` for creating processors by backend type
- Created [ffmpeg_service.py](src/backend/app/services/ffmpeg_service.py) - Isolated FFmpeg helpers
- Created [local_gpu_processor.py](src/backend/app/services/local_gpu_processor.py) - Current implementation using Real-ESRGAN
- Updated [services/__init__.py](src/backend/app/services/__init__.py) to export new modules

**Future work**: Implement `WebGPUProcessor` and `RunPodProcessor` classes when those features are needed.

---

## High Priority (Significant Technical Debt)

### 1. God Class: App.jsx (4,000+ lines)
**Smell**: Large Class, Feature Envy, Long Method

**Location**: [App.jsx](src/frontend/src/App.jsx)

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

**Refactoring**:
1. **Extract Mode Components**: Create `<FramingModeContainer>`, `<OverlayModeContainer>`, `<AnnotateModeContainer>` that own their mode's state
2. **State Machine Pattern**: Replace boolean flags with proper state machine (xstate or useReducer)
3. **Context Splitting**: Move shared state to granular contexts (VideoContext, ExportContext, ProjectContext)

**Effort**: High (2-3 days)

---

### 2. Long Module: export.py (2,059 lines)
**Smell**: Large Class, Long Method, Shotgun Surgery

**Location**: [export.py](src/backend/app/routers/export.py)

**Status**: Partially addressed - FFmpeg helpers extracted to `ffmpeg_service.py`, GPU interface created

**Remaining Problem**:
- Router still handles 10+ different export operations
- Could benefit from further splitting into `framing_export.py`, `overlay_export.py`, `multi_clip_export.py`

**Evidence**:
- `_concatenate_with_fade()` (lines 443-533): 90 lines of FFmpeg filter building
- `_concatenate_with_dissolve()` (lines 536-599): Nearly identical structure
- `process_single_clip()` (lines 99-200): Mixes caching, file I/O, and AI processing

**Refactoring**:
1. ~~**Extract FFmpegService**: Move FFmpeg command building to dedicated service~~ ✅ Done
2. **Strategy Pattern**: Create transition strategies (FadeTransition, DissolveTransition, CutTransition)
3. **Split Router**: Separate into `framing_export.py`, `overlay_export.py`, `multi_clip_export.py`

**Effort**: Medium (1-2 days remaining)

---

## Medium Priority (Code Quality Issues)

### 4. Primitive Obsession: JSON Columns
**Smell**: Primitive Obsession, Stringly Typed

**Location**: Database schema across all tables

**Problem**: Complex data structures stored as JSON strings in TEXT columns, parsed/serialized repeatedly.

**Evidence**:
```sql
crop_data TEXT,      -- JSON: crop keyframes
timing_data TEXT,    -- JSON: {trimRange}
segments_data TEXT,  -- JSON: {boundaries, segmentSpeeds}
highlights_data TEXT -- JSON: [{start_time, end_time, keyframes}]
```

**Issues**:
- No schema validation at DB level
- Every read requires `json.loads()`, every write requires `json.dumps()`
- No query capability on nested data

**Refactoring**:
1. **Pydantic Models**: Create proper models for all JSON structures
2. **JSON Schema Validation**: Add validation before storage
3. **Consider Normalization**: For frequently-queried data like keyframes

**Effort**: Medium (1-2 days)

---

### 5. Feature Envy: Clip Name Derivation
**Smell**: Feature Envy, Duplicated Code

**Locations**:
- [queries.py](src/backend/app/queries.py) - `derive_clip_name()`
- [soccerTags.js](src/frontend/src/modes/annotate/constants/soccerTags.js) - `deriveClipName()`

**Problem**: Same business logic implemented in both Python and JavaScript.

```python
# Backend (Python)
def derive_clip_name(custom_name, rating, tags):
    if custom_name: return custom_name
    adjective = RATING_ADJECTIVES[rating]
    return f"{adjective} {', '.join(tags[:-1])} and {tags[-1]}"
```

```javascript
// Frontend (JavaScript)
export function deriveClipName(customName, rating, tags) {
    if (customName) return customName;
    const adjective = RATING_ADJECTIVES[rating];
    return `${adjective} ${tags.slice(0,-1).join(', ')} and ${tags.at(-1)}`;
}
```

**Refactoring**: Derive name server-side only, include in API responses.

**Effort**: Low (0.5 days)

---

### 6. Long Parameter Lists
**Smell**: Long Parameter List, Data Clump

**Locations**:
- [export.py](src/backend/app/routers/export.py) - `process_single_clip()` has 8 parameters
- [App.jsx](src/frontend/src/App.jsx) - `ExportButton` receives 25+ props (lines 3801-3845)

**Evidence**:
```jsx
<ExportButton
  videoFile={...}
  cropKeyframes={...}
  highlightRegions={...}
  isHighlightEnabled={...}
  segmentData={...}
  disabled={...}
  includeAudio={...}
  // ... 18 more props
/>
```

**Refactoring**:
1. **Parameter Object**: Create `ExportConfig` object
2. **Context**: Use React Context for shared export state
3. **Builder Pattern**: For backend export configuration

**Effort**: Low-Medium (1 day)

---

### 7. Speculative Generality: transform_data Column
**Smell**: Speculative Generality, Dead Code

**Location**: [database.py](src/backend/app/database.py) - `working_clips` table

**Problem**: `transform_data` column is defined but never used anywhere.

```sql
transform_data TEXT,  -- Reserved for future use
```

**Refactoring**: Remove unused column (or implement the feature).

**Effort**: Low (0.5 hours)

---

### 8. Magic Numbers/Strings
**Smell**: Magic Number, Magic String

**Locations throughout codebase**:

```python
# export.py
max_w, max_h = 2560, 1440  # Why these values?
sr_w = int(min_crop_width * 4)  # 4x upscale - not documented

# database.py
USER_ID = "a"  # Single-user hardcoded

# App.jsx
// Line 3900: Maximum file size: 4GB - not enforced, just in docs
```

**Refactoring**: Extract to named constants with documentation.

**Effort**: Low (2-3 hours)

---

### 9. Inconsistent Naming: progress vs exported_at
**Smell**: Inconsistent Naming, Middle Man

**Location**: [clips.py](src/backend/app/routers/clips.py), [database.py](src/backend/app/database.py)

**Problem**: Database migration left dual concepts:
- `progress INTEGER` - Old field (0 = not exported, 1 = exported)
- `exported_at TIMESTAMP` - New field (NULL = not exported)

Both are checked in different places, creating confusion.

**Refactoring**: Complete migration to `exported_at`, remove `progress`.

**Effort**: Medium (1 day)

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
| High | App.jsx God Class | 2-3 days | Very High | Pending |
| High | export.py Long Module | 1-2 days | High | **Partial** |
| ~~High~~ | ~~Duplicated Constants~~ | ~~1 day~~ | ~~Medium~~ | **✅ Done** |
| ~~High~~ | ~~GPU Interface~~ | ~~1 day~~ | ~~High~~ | **✅ Done** |
| Medium | JSON Primitive Obsession | 1-2 days | Medium | Pending |
| Medium | Feature Envy (clip name) | 0.5 days | Low | Pending |
| Medium | Long Parameter Lists | 1 day | Medium | Pending |
| Low | Unused transform_data | 0.5 hours | Low | Pending |
| Low | Magic Numbers | 2-3 hours | Low | Pending |
| Medium | progress/exported_at | 1 day | Medium | Pending |

---

## Recommended Refactoring Order

1. ~~**First Sprint**: Duplicated constants (reduces shotgun surgery for future work)~~ ✅ Completed
2. ~~**GPU Interface**: Create abstract processor interface for future WebGPU/RunPod~~ ✅ Completed
3. **Next**: Export.py router split (enables parallel work on export features)
4. **Future**: App.jsx mode extraction (biggest payoff for maintainability)
5. **Ongoing**: Address smaller issues as files are touched

---

## Notes for AI Assistants

When working on this codebase:
1. **App.jsx**: Treat this file carefully. It's large and interconnected. Small changes can have unexpected effects.
2. **Export pipeline**: Test with actual video files after changes. FFmpeg behavior varies.
3. **Database migrations**: The codebase uses auto-migration. Test with existing databases.
4. **Mode interactions**: Changes in one mode may affect others through shared state.
5. **Services layer**: New GPU-intensive code should implement the `VideoProcessor` interface in `app/services/video_processor.py`.
6. **Constants**: All rating/tag constants should be imported from `app/constants.py` - never define duplicates.
