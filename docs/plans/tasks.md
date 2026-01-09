# Remaining Tasks

## Summary

App.jsx has been reduced from **2181 lines** to **345 lines** (84% reduction). Target is ~150 lines.

The following tasks from `mostly_implemented/AppJSX_REDUCTION/` remain incomplete:

---

## Task 1: Finalize AnnotateScreen (TASK-05)

**Status:** Not Started
**Estimated Impact:** -50 to -100 lines from App.jsx

### Goal
Make AnnotateScreen fully self-contained like FramingScreen and OverlayScreen.

### Current State
AnnotateScreen still receives props from App.jsx:
- `initialFile` / `onInitialFileConsumed` - pending file for annotation
- Navigation callbacks passed as props

### Changes Required
1. AnnotateScreen should use `sessionStorage` to get pending file/game ID (pattern already established)
2. Use `useNavigationStore` directly instead of receiving navigation callbacks as props
3. Internalize `useGames` hook (currently props passed from App.jsx)
4. Handle downloads panel internally

### Files to Modify
- `src/frontend/src/screens/AnnotateScreen.jsx`
- `src/frontend/src/App.jsx` (remove annotate-specific props)

---

## Task 2: Gallery Store (TASK-06)

**Status:** Not Started
**Estimated Impact:** -30 to -50 lines from App.jsx

### Goal
Make DownloadsPanel/Gallery self-contained via a Zustand store.

### Current State
- `isDownloadsPanelOpen` state lives in App.jsx
- `downloadsCount` is fetched in App.jsx and passed down
- Gallery button handlers are in App.jsx

### Changes Required
1. Create `galleryStore.js` with `isOpen`, `count`, `open()`, `close()` actions
2. DownloadsPanel manages its own open/close state via store
3. DownloadsPanel fetches its own data
4. Create `GalleryButton` component that uses the store directly
5. Remove gallery state from App.jsx

### Files to Create
- `src/frontend/src/stores/galleryStore.js`
- `src/frontend/src/components/GalleryButton.jsx`

### Files to Modify
- `src/frontend/src/components/DownloadsPanel.jsx`
- `src/frontend/src/stores/index.js`
- `src/frontend/src/App.jsx`

---

## Task 3: Final App.jsx Cleanup (TASK-07)

**Status:** Not Started
**Estimated Impact:** Get App.jsx to ~150 lines

### Goal
Remove all remaining dead code from App.jsx after Tasks 1-2 complete.

### Target Structure
```jsx
function App() {
  const mode = useCurrentMode();

  return (
    <ProjectProvider>
      {mode === 'project-manager' && <ProjectsScreen />}
      {mode === 'annotate' && <AnnotateScreen />}
      {mode === 'framing' && <FramingScreen />}
      {mode === 'overlay' && <OverlayScreen />}

      <DownloadsPanel />
      <ConfirmationDialog />
    </ProjectProvider>
  );
}
```

### Cleanup Checklist
- [ ] Remove unused imports
- [ ] Remove dead handler functions
- [ ] Remove orphaned state
- [ ] Remove unused effects
- [ ] Verify no props passed to screen components

---

## Task 4: OpenCV to FFmpeg Migration (Backend)

**Status:** Not Started
**Risk Level:** HIGH
**Estimated Effort:** Large (affects core video processing pipeline)

### Why This Matters

OpenCV's video frame extraction has known reliability issues that cause exported videos to be shorter than source videos.

**The Problem:**
```
Browser reports (from container metadata): 11.243s, 309 frames
OpenCV can actually decode:              11.099s, 304 frames
Result: Exported video is ~0.14s shorter than source
```

**Root Causes:**
- `cv2.CAP_PROP_FRAME_COUNT` is unreliable for certain video formats
- MP4 container metadata can declare frames that aren't fully decodable
- Variable Frame Rate (VFR) videos (common in screen recordings) cause discrepancies
- OpenCV's frame seeking can skip frames for certain codecs
- Incomplete GOPs (Groups of Pictures) in H.264

### Current Workaround
A binary search finds the actual last readable frame:
```python
video_total_frames = min(ffprobe_frame_count, opencv_total_frames)
# Then binary search to find actual last readable frame
```

This works but is a band-aid, not a fix.

### Proposed Solution
Replace OpenCV frame extraction with FFmpeg throughout the pipeline.

**Instead of:**
```python
cap = cv2.VideoCapture(path)
while cap.read():
    process_frame(frame)
```

**Use:**
```bash
ffmpeg -i input.mp4 -vsync 0 frames/frame_%06d.png
# Then process frames from disk
```

### Files That Use OpenCV (cv2)

| File | Usage | Migration Difficulty |
|------|-------|---------------------|
| `ai_upscaler/__init__.py` | VideoCapture for frame extraction | Medium |
| `ai_upscaler/video_encoder.py` | VideoCapture for reading | Medium |
| `ai_upscaler/frame_processor.py` | VideoCapture for frames | Medium |
| `ai_upscaler/frame_enhancer.py` | Image processing | Keep (not video I/O) |
| `ai_upscaler/utils.py` | Image utilities | Keep (not video I/O) |
| `ai_upscaler/keyframe_interpolator.py` | Frame processing | Keep (image ops) |
| `routers/detection.py` | Player detection from frames | Medium |
| `routers/export/overlay.py` | Frame-by-frame overlay | Hard |
| `services/export_worker.py` | Video processing | Medium |
| `ai_upscaler/rife/*` | Third-party AI model | Don't touch |

### Pros

| Benefit | Impact |
|---------|--------|
| Eliminates frame count mismatch | Fixes "video shorter than preview" bug |
| Single video dependency | FFmpeg only, no OpenCV for video I/O |
| Better VFR handling | Screen recordings work correctly |
| Consistent pipeline | Already use FFmpeg for encoding |
| More reliable seeking | FFmpeg handles edge cases better |

### Cons

| Drawback | Mitigation |
|----------|------------|
| Higher disk I/O | Must extract all frames to disk first |
| No incremental processing | Can't process frame-by-frame with progress |
| Larger temp storage | Need space for extracted PNG frames |
| Migration risk | Many files to change, could introduce bugs |
| Progress updates harder | Need to count files instead of read loop |

### Risk Assessment

**HIGH RISK because:**
1. Touches core video processing used by ALL export types
2. Many files need coordinated changes
3. AI upscaler is complex and already fragile
4. Hard to test all edge cases (VFR, various codecs, etc.)
5. Regression could break exports silently (wrong frame count)

### Recommended Approach

1. **Phase 1: Isolate** - Create `ffmpeg_frame_extractor.py` service
2. **Phase 2: Parallel** - Add FFmpeg extraction alongside OpenCV (compare results)
3. **Phase 3: Migrate** - Switch one consumer at a time, starting with simplest
4. **Phase 4: Remove** - Remove OpenCV video I/O after all consumers migrated

### When to Do This

- After frontend refactoring is complete (Tasks 1-3)
- When you have time for thorough testing
- Ideally with a set of test videos that reproduce the frame count bug

---

## Completed Tasks (Reference)

These have already been implemented:

1. **Navigation Store (TASK-01)** - Created `navigationStore.js`, `ProjectContext.jsx`
2. **ProjectsScreen (TASK-02)** - Created `useProjectLoader`, `projectDataStore`
3. **FramingScreen (TASK-03)** - Self-contained with own hooks
4. **OverlayScreen (TASK-04)** - Created `overlayStore.js`, self-contained
5. **Durable Export Architecture** - Background export jobs, graceful WebSocket

---

## Notes

### What Was NOT Relevant
- `mostly_implemented/refactor-tasks/` - Old approach superseded by AppJSX_REDUCTION
- `mostly_implemented/formal annotations/` - Test data files, not tasks

### Success Metrics
| Metric | Original | Current | Target |
|--------|----------|---------|--------|
| App.jsx lines | 2181 | 345 | ~150 |
| Props to FramingScreen | 50+ | 0 | 0 |
| Props to OverlayScreen | 60+ | 0 | 0 |
| Props to AnnotateScreen | 15+ | ~5 | 0 |
