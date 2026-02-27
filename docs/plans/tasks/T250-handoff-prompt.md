# T250: Clip Store Unification — Handoff Prompt

**For:** Fresh AI context implementing T250
**Branch:** `feature/T85b-profile-switching` (or create `feature/T250-clip-store-unification`)
**Task file:** `docs/plans/tasks/T250-clip-store-unification.md`

---

## What You're Doing

Eliminate the dual-store clip data architecture that causes persistent sync bugs. Currently, clip data flows through TWO parallel systems:

```
Backend API → useProjectClips (React useState) → [manual sync effect] → projectDataStore (Zustand) → UI
```

The target architecture is:

```
Backend API → projectDataStore (Zustand, raw data) → computed selectors → UI
```

**One store. One ID system. No transformation. No sync effects.**

---

## The Problem in Detail

### Current Data Flow (Broken)

1. `useProjectClips` hook (`src/frontend/src/hooks/useProjectClips.js`) holds raw API data in React `useState`
2. `useProjectLoader` hook (`src/frontend/src/hooks/useProjectLoader.js`) calls `transformClipToUIFormat()` which:
   - Generates new client-side IDs (`clip_xxx`) via `generateClipId()`
   - Stores derived boolean flags (`isExtracted`, `isExtracting`, `isFailed`)
   - Creates a snapshot object that immediately starts going stale
3. Transformed clips go into `projectDataStore` (Zustand) via `setProjectClips()`
4. When extraction completes, a WebSocket event triggers `fetchProjectClips()` which updates `useProjectClips` (useState Store #1)
5. A sync effect in `FramingScreen.jsx:220-259` bridges Store #1 → Store #2 by iterating clips and calling `updateClipData()` for each one
6. The bridge uses `clips.find(c => c.workingClipId === backendClip.id)` — this mapping fails silently

### Four Anti-Patterns to Fix

1. **Two stores for same data** — `useProjectClips` (useState) and `projectDataStore` (Zustand) both hold clip data
2. **Stored derived flags** — `isExtracted: !!filename`, `isFailed: status === 'failed'` stored as properties instead of computed
3. **Client-side ID generation** — `generateClipId()` creates `clip_xxx` IDs that diverge from backend `working_clips.id`
4. **Transformation snapshot** — `transformClipToUIFormat()` creates objects that go stale on arrival

---

## Backend API Response Shape

The backend returns `WorkingClipResponse` from `GET /api/clips/projects/{id}/clips`:

```python
# src/backend/app/routers/clips.py:141-162
class WorkingClipResponse(BaseModel):
    id: int
    project_id: int
    raw_clip_id: Optional[int]
    uploaded_filename: Optional[str]
    filename: Optional[str]          # None if extraction not complete
    file_url: Optional[str]          # Presigned R2 URL or None (local dev)
    name: Optional[str]
    notes: Optional[str]
    exported_at: Optional[str]
    sort_order: int
    crop_data: Optional[str]         # JSON string
    timing_data: Optional[str]       # JSON string
    segments_data: Optional[str]     # JSON string
    game_id: Optional[int]
    start_time: Optional[float]
    end_time: Optional[float]
    tags: Optional[List[str]]
    rating: Optional[int]
    extraction_status: Optional[str] # 'pending', 'running', 'completed', 'failed', None
```

**Important:** `file_url` is `null` in local dev (R2 disabled). Use `filename` presence to determine extraction state, not `file_url`.

---

## Implementation Steps

### Step 1: Add raw clip storage + API methods to `projectDataStore.js`

Add to the Zustand store:

```javascript
// New state
rawClips: [],           // Raw WorkingClipResponse[] from API
clipsFetching: false,
clipsError: null,

// New actions
fetchClips: async (projectId) => { /* GET + set rawClips */ },
retryExtraction: async (projectId, clipId) => { /* POST + refetch */ },
saveFramingEdits: async (projectId, clipId, data) => { /* PUT + update rawClips */ },
addClipFromLibrary: async (projectId, rawClipId) => { /* POST + refetch */ },
uploadClip: async (projectId, file) => { /* POST + refetch */ },
removeClip: async (projectId, clipId) => { /* DELETE + refetch */ },
reorderClips: async (projectId, clipIds) => { /* PUT + refetch */ },
getClipFileUrl: (clipId, projectId) => { /* compute URL */ },
```

The existing `clips` array and `setProjectClips` should be replaced by `rawClips`. The store should use `rawClips` as the canonical clip data. `selectedClipId` should now hold a backend integer ID.

### Step 2: Create `src/frontend/src/utils/clipSelectors.js`

Computed selectors — never stored as properties:

```javascript
export const isExtracted = (clip) => !!clip.filename;
export const isExtracting = (clip) =>
  clip.extraction_status === 'running' || clip.extraction_status === 'pending';
export const isFailed = (clip) => clip.extraction_status === 'failed';
export const isRetrying = (clip) => clip.extraction_status === 'retrying';
export const clipDisplayName = (clip) =>
  (clip.filename || 'clip.mp4').replace(/\.[^/.]+$/, '');
export const clipFileUrl = (clip, projectId, apiBase) =>
  clip.file_url || `${apiBase}/api/clips/projects/${projectId}/clips/${clip.id}/file`;
```

Also add lazy JSON parsers:

```javascript
export const clipCropKeyframes = (clip) => {
  if (!clip.crop_data) return [];
  try { return JSON.parse(clip.crop_data); }
  catch { return []; }
};
export const clipSegments = (clip, duration) => {
  if (!clip.segments_data) return { boundaries: [0, duration || 0], userSplits: [], trimRange: null, segmentSpeeds: {} };
  try { return JSON.parse(clip.segments_data); }
  catch { return { boundaries: [0, duration || 0], userSplits: [], trimRange: null, segmentSpeeds: {} }; }
};
export const clipTrimRange = (clip) => {
  if (!clip.timing_data) return null;
  try { return JSON.parse(clip.timing_data).trimRange || null; }
  catch { return null; }
};
```

### Step 3: Use backend IDs everywhere

- `selectedClipId` holds a backend `working_clips.id` integer
- All `clip.id` references throughout the codebase become backend IDs
- Remove `generateClipId()` from both `useProjectLoader.js` and `useClipManager.js`
- Remove `workingClipId` property — `clip.id` IS the backend ID

For clips added via file upload (not from backend), use a temporary negative ID until the backend returns a real ID.

### Step 4: Update `useProjectLoader.js`

- Remove `transformClipToUIFormat()` function entirely
- Remove `generateClipId()` function
- Instead of transforming clips, store raw API data directly: call `store.setRawClips(clipsData)`
- Video metadata loading can still happen but store results separately (e.g., in a `clipMetadataCache` map keyed by clip ID)
- The `buildClipMetadata()` function can remain but should read from raw data + selectors

### Step 5: Update `useClipManager.js`

- Remove `generateClipId()`
- Remove `addClipFromProject()` (no longer needed — raw data goes directly into store)
- Simplify to be a thin wrapper over `projectDataStore` for UI convenience
- All methods use backend IDs

### Step 6: Remove the sync effect in `FramingScreen.jsx`

Delete the entire effect at lines 220-259. With one store, the flow becomes:
1. WebSocket `extraction_complete` → `store.fetchClips(projectId)`
2. `fetchClips` updates `store.rawClips`
3. Components re-render via Zustand subscriptions
4. Selectors compute derived values fresh

Also update the WebSocket listener (lines 175-218) to call `store.fetchClips()` instead of the old `fetchProjectClips()`.

### Step 7: Update all component consumers

Components that read clip properties need to switch from stored flags to selectors:

```jsx
// Before:
const extracted = clip.isExtracted !== false;
const extracting = clip.isExtracting;
const failed = clip.isFailed;
const displayName = clip.fileNameDisplay;

// After:
import { isExtracted, isExtracting, isFailed, clipDisplayName } from '../utils/clipSelectors';
const extracted = isExtracted(clip);
const extracting = isExtracting(clip);
const failed = isFailed(clip);
const displayName = clipDisplayName(clip);
```

Components that read parsed JSON data:
```jsx
// Before:
const keyframes = clip.cropKeyframes;
const segments = clip.segments;

// After:
import { clipCropKeyframes, clipSegments } from '../utils/clipSelectors';
const keyframes = clipCropKeyframes(clip);
const segments = clipSegments(clip, clip.duration);
```

### Step 8: Delete deprecated files

- **DELETE** `src/frontend/src/hooks/useProjectClips.js`
- **DELETE** `src/frontend/src/stores/clipStore.js`
- **DELETE** `src/frontend/src/stores/clipStore.test.js`
- Update `src/frontend/src/stores/index.js` to remove `clipStore` export

---

## Files Affected (Complete List)

| File | Action |
|------|--------|
| `src/frontend/src/stores/projectDataStore.js` | Major rewrite — add rawClips, API methods, backend IDs |
| `src/frontend/src/utils/clipSelectors.js` | **NEW** — computed selectors |
| `src/frontend/src/hooks/useProjectLoader.js` | Remove transformation, store raw data |
| `src/frontend/src/hooks/useClipManager.js` | Simplify — thin wrapper, no ID generation |
| `src/frontend/src/hooks/useProjectClips.js` | **DELETE** |
| `src/frontend/src/stores/clipStore.js` | **DELETE** |
| `src/frontend/src/stores/clipStore.test.js` | **DELETE** |
| `src/frontend/src/stores/index.js` | Remove clipStore export |
| `src/frontend/src/screens/FramingScreen.jsx` | Remove sync effect, use store + selectors |
| `src/frontend/src/components/ClipSelectorSidebar.jsx` | Use selectors instead of flags |
| `src/frontend/src/containers/FramingContainer.jsx` | Use selectors instead of flags |
| `src/frontend/src/App.jsx` | Update clip reading to use backend IDs |
| `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` | Check for clip data usage |
| `src/frontend/src/components/FileUpload.jsx` | Check for clip data usage |

---

## Important Context

### Video metadata loading
Clips need video metadata (duration, width, height, framerate) for the framing UI. Currently `useProjectLoader` loads this during `transformClipToUIFormat`. After the refactor, you'll need a strategy for this:
- **Option A:** Store metadata in a separate `clipMetadata: {}` map in projectDataStore, keyed by clip ID. Load on demand when a clip is selected.
- **Option B:** Add metadata fields to the raw clip data after loading (mutation of the raw array entry). Less pure but simpler.

### JSON field parsing
`crop_data`, `segments_data`, and `timing_data` are JSON strings in the API response. Currently they're parsed once in `transformClipToUIFormat`. After the refactor, parse them lazily via selectors (see Step 2). Consider memoizing if performance is a concern.

### Local dev (R2 disabled)
In local development, `file_url` is always `null` because R2 is disabled. The proxy endpoint `GET /api/clips/projects/{projectId}/clips/{clipId}/file` serves the file locally. The `clipFileUrl` selector handles this fallback.

### Extraction flow
1. User adds clips to project → backend enqueues extraction
2. Backend processes clips (Modal GPU or local FFmpeg)
3. On completion, backend sets `filename` and `extraction_status = 'completed'`
4. Backend broadcasts WebSocket event `extraction_complete`
5. Frontend receives event → refetches clips from API → store updates → UI re-renders

### Tests to verify
- Backend: `cd src/backend && .venv/Scripts/python.exe run_tests.py` (424+ tests)
- Frontend: `cd src/frontend && npm test` (449+ tests)
- Build: `cd src/frontend && npm run build`

---

## Acceptance Criteria

- [ ] `useProjectClips` hook is deleted — all API data lives in Zustand store
- [ ] No `useState` holds clip data anywhere (only Zustand)
- [ ] No `isExtracted`, `isExtracting`, `isFailed` stored on clip objects — all computed via selectors
- [ ] Backend `working_clips.id` is the canonical clip ID — no client-side ID generation
- [ ] No sync effects between stores — store updates propagate automatically
- [ ] `transformClipToUIFormat` is deleted — raw API data stored directly
- [ ] Deprecated `clipStore.js` is deleted
- [ ] Extraction complete → UI updates automatically (no manual bridge)
- [ ] All existing tests pass (backend 424+, frontend 449+)
- [ ] Frontend build succeeds

---

## Coding Standards (Enforced)

Read these before implementing:
- `.claude/references/coding-standards.md` — especially "API Data Architecture (CRITICAL)" section
- `src/frontend/.claude/skills/state-management/SKILL.md` — especially "API Data Rules (CRITICAL)" section
- `src/frontend/CLAUDE.md` — Don't list includes the anti-patterns being fixed

Key rules:
1. **API data in Zustand, never useState**
2. **Store raw backend data, transform at read time**
3. **Use backend IDs as canonical identifiers**
4. **Never store derived boolean flags**
