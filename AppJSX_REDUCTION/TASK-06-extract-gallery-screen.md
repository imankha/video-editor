# TASK-06: Extract GalleryScreen

## Objective
Create a dedicated GalleryScreen (or enhance DownloadsPanel) to be a first-class screen instead of just a modal overlay.

## Current State
The "Gallery" is implemented as `DownloadsPanel` - a modal that can be opened from any screen:

```jsx
// Currently used as modal overlay
<DownloadsPanel
  isOpen={isDownloadsPanelOpen}
  onClose={() => setIsDownloadsPanelOpen(false)}
  onOpenProject={(projectId) => {...}}
  onCountChange={refreshDownloadsCount}
/>
```

## Decision Point

There are two approaches:

### Option A: Keep as Modal (Recommended)
The Gallery is a modal that overlays any screen. This is the current behavior and works well:
- Users can quickly preview downloads without leaving their current work
- Consistent with many video editors (Premiere, DaVinci)
- Less disruption to workflow

### Option B: Full Screen
Make Gallery a full screen like the other modes:
- More space for video previews
- Easier bulk management
- Could include more features (playlists, tags)

## Recommendation
**Keep as modal** but make it more self-contained. The Gallery doesn't need to be a full screen mode - it's an overlay feature.

---

## Implementation Steps

### Step 1: Make DownloadsPanel Self-Contained

Currently, DownloadsPanel receives these props:
- `isOpen` - Modal open state
- `onClose` - Close handler
- `onOpenProject` - Navigate to project
- `onCountChange` - Update badge count

We can simplify by using stores:

**File**: `src/frontend/src/stores/galleryStore.js`

```javascript
import { create } from 'zustand';

/**
 * Store for gallery/downloads panel state
 */
export const useGalleryStore = create((set, get) => ({
  // Panel open state
  isOpen: false,

  // Downloaded videos
  videos: [],

  // Loading state
  isLoading: false,

  // Total count (for badge)
  count: 0,

  // Actions
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set(state => ({ isOpen: !state.isOpen })),

  setVideos: (videos) => set({ videos, count: videos.length }),

  setIsLoading: (loading) => set({ isLoading: loading }),

  refresh: async () => {
    const { setIsLoading, setVideos } = get();
    setIsLoading(true);

    try {
      const response = await fetch('/api/downloads');
      if (response.ok) {
        const data = await response.json();
        setVideos(data.videos || []);
      }
    } catch (err) {
      console.error('[GalleryStore] Failed to fetch:', err);
    } finally {
      setIsLoading(false);
    }
  },
}));

// Convenience hooks
export const useGalleryOpen = () => useGalleryStore(state => state.isOpen);
export const useGalleryCount = () => useGalleryStore(state => state.count);
export const useGalleryActions = () => useGalleryStore(state => ({
  open: state.open,
  close: state.close,
  toggle: state.toggle,
  refresh: state.refresh,
}));
```

### Step 2: Update DownloadsPanel

**File**: `src/frontend/src/components/DownloadsPanel.jsx`

```jsx
import { useEffect, useCallback } from 'react';
import { useGalleryStore } from '../stores/galleryStore';
import { useNavigationStore } from '../stores/navigationStore';
import { API_BASE } from '../config';

export function DownloadsPanel() {
  // Gallery store
  const {
    isOpen,
    videos,
    isLoading,
    close,
    setVideos,
    setIsLoading,
  } = useGalleryStore();

  // Navigation
  const { setProjectId, navigate } = useNavigationStore();

  // Fetch downloads on mount and when opened
  useEffect(() => {
    if (isOpen) {
      fetchDownloads();
    }
  }, [isOpen]);

  const fetchDownloads = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/downloads`);
      if (response.ok) {
        const data = await response.json();
        setVideos(data.videos || []);
      }
    } catch (err) {
      console.error('[DownloadsPanel] Failed to fetch:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenProject = useCallback((projectId) => {
    setProjectId(projectId);
    navigate('overlay');
    close();
  }, [setProjectId, navigate, close]);

  const handleDelete = useCallback(async (videoId) => {
    try {
      await fetch(`${API_BASE}/api/downloads/${videoId}`, { method: 'DELETE' });
      fetchDownloads();
    } catch (err) {
      console.error('[DownloadsPanel] Failed to delete:', err);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-lg w-full max-w-4xl max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Gallery</h2>
          <button onClick={close} className="text-gray-400 hover:text-white">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {isLoading ? (
            <div className="text-center text-gray-400">Loading...</div>
          ) : videos.length === 0 ? (
            <div className="text-center text-gray-400">
              No videos yet. Export from Overlay mode to see them here.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {videos.map(video => (
                <VideoCard
                  key={video.id}
                  video={video}
                  onOpenProject={() => handleOpenProject(video.project_id)}
                  onDelete={() => handleDelete(video.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VideoCard({ video, onOpenProject, onDelete }) {
  return (
    <div className="bg-gray-700 rounded-lg overflow-hidden">
      <video
        src={`${API_BASE}/api/downloads/${video.id}/file`}
        className="w-full aspect-video object-cover"
        controls
      />
      <div className="p-2">
        <p className="text-sm text-white truncate">{video.filename}</p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={onOpenProject}
            className="text-xs text-purple-400 hover:text-purple-300"
          >
            Open Project
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Step 3: Update Gallery Button Usage

Throughout the app, replace gallery button handlers:

```jsx
// Before
<button onClick={() => setIsDownloadsPanelOpen(true)}>Gallery</button>

// After
import { useGalleryStore } from '../stores/galleryStore';

function GalleryButton() {
  const open = useGalleryStore(state => state.open);
  const count = useGalleryStore(state => state.count);

  return (
    <button onClick={open}>
      Gallery {count > 0 && <span className="badge">{count}</span>}
    </button>
  );
}
```

### Step 4: Create GalleryButton Component

**File**: `src/frontend/src/components/GalleryButton.jsx`

```jsx
import { Image } from 'lucide-react';
import { useGalleryStore } from '../stores/galleryStore';

export function GalleryButton({ className = '' }) {
  const open = useGalleryStore(state => state.open);
  const count = useGalleryStore(state => state.count);

  return (
    <button
      onClick={open}
      className={`flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 rounded-lg transition-colors ${className}`}
      title="Gallery"
    >
      <Image size={18} className="text-purple-400" />
      <span className="text-sm text-gray-400">Gallery</span>
      {count > 0 && (
        <span className="px-1.5 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}
```

### Step 5: Render DownloadsPanel at App Level

Since Gallery is a modal, it should be rendered at the App level (or use a portal):

```jsx
// App.jsx
function App() {
  return (
    <>
      {/* Screen routing */}
      {mode === 'project-manager' && <ProjectsScreen />}
      {mode === 'annotate' && <AnnotateScreen />}
      {mode === 'framing' && <FramingScreen />}
      {mode === 'overlay' && <OverlayScreen />}

      {/* Global modals */}
      <DownloadsPanel />
    </>
  );
}
```

---

## Files Changed
- `src/frontend/src/stores/galleryStore.js` (new)
- `src/frontend/src/stores/index.js` (update)
- `src/frontend/src/components/DownloadsPanel.jsx` (update)
- `src/frontend/src/components/GalleryButton.jsx` (new)
- `src/frontend/src/App.jsx` (simplify gallery handling)

## Verification
```bash
cd src/frontend && npm test
cd src/frontend && npx playwright test "Gallery"
```

## Manual Testing
1. Export a video from Overlay mode
2. Open Gallery from any screen
3. Verify video appears
4. Click "Open Project" - verify navigation
5. Delete video - verify removal
6. Badge count updates correctly

## Commit Message
```
refactor: Make Gallery/DownloadsPanel self-contained

- Create galleryStore for panel state
- DownloadsPanel manages its own data fetching
- Create GalleryButton component for consistent UI
- Remove gallery props from all screens
```
