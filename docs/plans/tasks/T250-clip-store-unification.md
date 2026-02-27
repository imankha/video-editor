# T250: Clip Store Unification — Eliminate Dual-Store Sync Issues

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-02-27
**Updated:** 2026-02-27

## Problem

Clip data flows through TWO parallel reactive systems that must be manually synced:

1. **`useProjectClips`** — React `useState` hook holding raw API data
2. **`projectDataStore`** — Zustand store holding transformed UI clips

When extraction completes (or any backend state changes), the data goes:
```
Backend API → useProjectClips (useState) → [manual sync effect] → projectDataStore (Zustand) → UI
```

The "sync effect" in `FramingScreen.jsx:220-259` is duct tape between these two systems. It has:
- A `clips.find(c => c.workingClipId === backendClip.id)` lookup that can fail silently
- A dependency on `[projectClips, clips, updateClipData]` that creates circular update risk
- Only syncs extraction-related fields — other backend changes are silently dropped
- Runs per-clip with individual `updateClipData()` calls, each triggering a store update

Additionally, `transformClipToUIFormat()` creates **new client-side IDs** (`clip_xxx`) that diverge from backend IDs, requiring constant mapping. And boolean flags (`isExtracted`, `isExtracting`, `isFailed`) are **stored** as properties instead of **computed** from source data, creating opportunities for staleness.

### Specific symptoms
- Extraction completes on backend but UI card stays "Extracting"
- WebSocket broadcast ran in wrong event loop (fixed in T249, but the fragility remains)
- Safety-net polling and sync effects added as workarounds for missing reactivity
- Every new backend field that needs to update in the UI requires adding another sync path

### Affected files (current state)

**Stores:**
- `src/frontend/src/stores/projectDataStore.js` — Zustand store (clips, selectedClipId, etc.)
- `src/frontend/src/stores/clipStore.js` — **DEPRECATED** but still imported in 8 files

**Hooks:**
- `src/frontend/src/hooks/useProjectClips.js` — useState holding raw API clips + API methods
- `src/frontend/src/hooks/useClipManager.js` — wrapper around projectDataStore for CRUD
- `src/frontend/src/hooks/useProjectLoader.js` — transforms backend clips to UI format

**Screens/Components:**
- `src/frontend/src/screens/FramingScreen.jsx` — owns the sync effect, WebSocket listener
- `src/frontend/src/components/ClipSelectorSidebar.jsx` — reads transformed clips
- `src/frontend/src/App.jsx` — reads clips from projectDataStore
- `src/frontend/src/containers/FramingContainer.jsx` — receives clips as props

## Root Cause Analysis

### Anti-pattern 1: Two stores for the same data

`useProjectClips` holds raw API data in React `useState`. `projectDataStore` holds transformed clips in Zustand. Neither knows about the other. A manual `useEffect` in FramingScreen bridges them.

**Fix:** Raw API data goes directly into Zustand. No intermediate useState.

### Anti-pattern 2: Stored derived flags

```javascript
// Current: stored flags that can go stale
{ isExtracted: true, isExtracting: false, isFailed: false, extractionStatus: null, filename: "clip.mp4" }
```

`isExtracted` is just `!!filename`. `isFailed` is just `extractionStatus === 'failed'`. Storing them means every update path must recompute all of them.

**Fix:** Compute at read time via selectors. Never store derived values.

### Anti-pattern 3: Client-side ID generation

`transformClipToUIFormat` generates `clip_1709123456_abc` as the clip ID. The backend ID is stored as `workingClipId`. Every sync operation requires `clips.find(c => c.workingClipId === backendClip.id)` — a lookup that fails silently if the mapping breaks.

**Fix:** Use backend `working_clips.id` as the canonical clip ID everywhere. No client-side ID generation.

### Anti-pattern 4: Transformation creates a snapshot

`transformClipToUIFormat` creates a new object that immediately starts going stale. Backend data changes require re-transforming or manually patching.

**Fix:** Store raw backend data. Transform at render time (or in selectors).

## Solution

### Target Architecture

```
Backend API
    │
    └──→ projectDataStore (Zustand) — holds raw backend clip data
              │
              ├──→ Computed selectors (no stored flags)
              │      isExtracted(clip) = !!clip.filename
              │      isExtracting(clip) = clip.extraction_status === 'running' || === 'pending'
              │      isFailed(clip) = clip.extraction_status === 'failed'
              │      clipFileUrl(clip) = clip.file_url || proxyUrl(clip.id)
              │
              ├──→ UI components subscribe via selectors
              │
              └──→ API methods (fetch, save, retry) write directly to store
```

**One store. One ID system. No transformation. No sync effects.**

### Implementation Plan

#### Step 1: Merge `useProjectClips` into `projectDataStore`

Move the raw API clip data and API methods into the Zustand store:

```javascript
// projectDataStore.js additions:
rawClips: [],           // Raw backend WorkingClipResponse data
clipsFetching: false,   // Loading state
clipsError: null,       // Error state

// Actions:
fetchClips: async (projectId) => { /* fetch + set rawClips */ },
retryExtraction: async (projectId, clipId) => { /* POST + refetch */ },
saveFramingEdits: async (projectId, clipId, data) => { /* PUT + update rawClips */ },
// ... other API methods
```

**Delete `useProjectClips` hook entirely.** All consumers switch to reading from the store.

#### Step 2: Eliminate client-side ID generation

Use `clip.id` (backend `working_clips.id`) as the canonical clip ID everywhere:

- `projectDataStore.selectedClipId` becomes a backend integer ID
- `clips.find(c => c.id === clipId)` works directly — no `workingClipId` mapping
- Remove `generateClipId()` from `useClipManager.js` and `useProjectLoader.js`

Note: Clips added via file upload (not from backend) can use a temporary negative ID or UUID until the backend returns a real ID.

#### Step 3: Store raw data, compute derived values

Stop storing `isExtracted`, `isExtracting`, `isFailed`, `fileNameDisplay`, `fileUrl` on clip objects. Instead, create selector functions:

```javascript
// src/frontend/src/utils/clipSelectors.js
export const isExtracted = (clip) => !!clip.filename;
export const isExtracting = (clip) => clip.extraction_status === 'running' || clip.extraction_status === 'pending';
export const isFailed = (clip) => clip.extraction_status === 'failed';
export const isRetrying = (clip) => clip.extraction_status === 'retrying';
export const clipDisplayName = (clip) => (clip.filename || 'clip.mp4').replace(/\.[^/.]+$/, '');
export const clipFileUrl = (clip, projectId, apiBase) =>
  clip.file_url || `${apiBase}/api/clips/projects/${projectId}/clips/${clip.id}/file`;
```

Components call these functions instead of reading stored flags:

```jsx
// Before:
const isExtracted = clip.isExtracted !== false;

// After:
import { isExtracted } from '../utils/clipSelectors';
const extracted = isExtracted(clip);
```

#### Step 4: Eliminate `transformClipToUIFormat`

Store the raw `WorkingClipResponse` data in the store. Parse JSON fields (crop_data, segments_data, timing_data) lazily when a clip is selected, or via selectors:

```javascript
export const clipCropKeyframes = (clip) => {
  if (!clip.crop_data) return [];
  try { return JSON.parse(clip.crop_data); }
  catch { return []; }
};
```

This means `projectDataStore.clips` holds the same shape as the API response. No transformation step. When the API returns new data, you just replace it.

#### Step 5: Remove the sync effect

With one store holding raw data, the sync effect in FramingScreen is unnecessary:

1. WebSocket `extraction_complete` event → call `store.fetchClips(projectId)`
2. `fetchClips` updates `store.rawClips`
3. All subscribers re-render with new data
4. Selectors compute derived values fresh each render

Delete the entire sync effect (FramingScreen lines 220-259).

#### Step 6: Clean up deprecated clipStore

Delete `src/frontend/src/stores/clipStore.js` and update all 8 files that import it.

### Files to change

| File | Change |
|------|--------|
| `stores/projectDataStore.js` | Add rawClips, API methods, remove transformed clips |
| `hooks/useProjectClips.js` | **DELETE** — merged into store |
| `hooks/useClipManager.js` | Simplify — thin wrapper over store, no ID generation |
| `hooks/useProjectLoader.js` | Remove `transformClipToUIFormat`, write raw data to store |
| `screens/FramingScreen.jsx` | Remove sync effect, read from store + selectors |
| `components/ClipSelectorSidebar.jsx` | Use selectors instead of flags |
| `containers/FramingContainer.jsx` | Use selectors instead of flags |
| `App.jsx` | Update clip reading to use backend IDs |
| `stores/clipStore.js` | **DELETE** |
| `stores/index.js` | Remove clipStore export |
| **NEW** `utils/clipSelectors.js` | Computed selectors for derived clip values |

### Migration strategy

This is a **big-bang refactor** for clip data, but the surface area is contained:
- Only FramingScreen and its children read clips
- App.jsx reads clips for annotate mode selection
- No other screens depend on the clip data shape

Recommend doing it in one branch to avoid partial migration states.

### Progress Log

*No progress yet*

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
