# Task 09: Clip Sidebar - Library Integration

## Context

**Project:** Browser-based video editor for soccer highlights with Annotate, Framing, and Overlay modes.

**Tech Stack:**
- Frontend: React 18 + Vite (port 5173)
- UI: Tailwind CSS + lucide-react icons

**Current ClipSelectorSidebar:**
```
┌─────────────────────┐
│ Clips               │
├─────────────────────┤
│ [Clip 1 thumbnail]  │
│ [Clip 2 thumbnail]  │
│ [Clip 3 thumbnail]  │
├─────────────────────┤
│ [+ Add Clip]        │ ← Currently single button
└─────────────────────┘
```

**Updated Add Flow:**
```
┌─────────────────────┐
│ [+ Add Clip]        │ ← Click opens menu
├─────────────────────┤
│ [Upload Clip]       │ ← Opens file picker
│ [From Library]      │ ← Opens ClipLibraryModal
│ [Cancel]            │
└─────────────────────┘
```

**Raw Clips (Library) Data:**
```javascript
{
  id: 1,
  filename: "brilliant_goal.mp4",
  rating: 5,
  tags: ["Goal", "1v1 Attack"],
  created_at: "..."
}
```

**Working Clip Creation:**
- From library: `{ project_id, raw_clip_id, sort_order }`
- From upload: `{ project_id, uploaded_filename, sort_order }`

---

## Objective
Update ClipSelectorSidebar in Framing mode to:
1. Replace single "Add" button with "Upload" and "From Library" options
2. Create ClipLibraryModal for selecting from raw_clips
3. Load project clips from server when project is selected

## Dependencies
- Tasks 01-08 must be completed
- Raw clips exist in database (from Annotate export)

## Files to Create

### 1. `src/frontend/src/components/ClipLibraryModal.jsx`

```javascript
import React, { useState, useEffect } from 'react';
import { X, Star, Check } from 'lucide-react';

const API_BASE = 'http://localhost:8000/api';

/**
 * ClipLibraryModal - Select clips from the raw clips library
 */
export function ClipLibraryModal({
  isOpen,
  onClose,
  onSelectClip,
  existingClipIds = []  // Raw clip IDs already in the project
}) {
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Fetch raw clips
  useEffect(() => {
    if (!isOpen) return;

    const fetchClips = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE}/clips/raw`);
        if (response.ok) {
          const data = await response.json();
          setClips(data);
        }
      } catch (err) {
        console.error('Failed to fetch clips:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchClips();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleSelect = (clipId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(clipId)) {
        next.delete(clipId);
      } else {
        next.add(clipId);
      }
      return next;
    });
  };

  const handleAdd = () => {
    selectedIds.forEach(id => {
      onSelectClip(id);
    });
    setSelectedIds(new Set());
    onClose();
  };

  // Filter out clips already in project
  const availableClips = clips.filter(clip => !existingClipIds.includes(clip.id));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">Add from Library</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading...</div>
          ) : availableClips.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {clips.length === 0
                ? 'No clips in library. Export from Annotate mode first.'
                : 'All clips already added to this project.'}
            </div>
          ) : (
            <div className="space-y-2">
              {availableClips.map(clip => {
                const isSelected = selectedIds.has(clip.id);
                return (
                  <div
                    key={clip.id}
                    onClick={() => handleToggleSelect(clip.id)}
                    className={`p-3 rounded-lg cursor-pointer border transition-all ${
                      isSelected
                        ? 'bg-purple-900/40 border-purple-500'
                        : 'bg-gray-700 border-gray-600 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                        isSelected
                          ? 'bg-purple-600 border-purple-600'
                          : 'border-gray-500'
                      }`}>
                        {isSelected && <Check size={14} className="text-white" />}
                      </div>

                      {/* Clip info */}
                      <div className="flex-1">
                        <div className="text-white font-medium">
                          {clip.filename.replace('.mp4', '')}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          {/* Rating stars */}
                          <span className="flex">
                            {[1, 2, 3, 4, 5].map(n => (
                              <Star
                                key={n}
                                size={12}
                                fill={n <= clip.rating ? '#fbbf24' : 'transparent'}
                                color={n <= clip.rating ? '#fbbf24' : '#6b7280'}
                              />
                            ))}
                          </span>
                          {/* Tags */}
                          {clip.tags?.length > 0 && (
                            <span className="text-xs">
                              {clip.tags.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={selectedIds.size === 0}
            className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Add {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ClipLibraryModal;
```

### 2. Modify `src/frontend/src/components/ClipSelectorSidebar.jsx`

Update the "Add" button section:

```javascript
import { useState, useRef } from 'react';
import { GripVertical, X, Plus, Film, MessageSquare, Upload, Library } from 'lucide-react';
import { ClipLibraryModal } from './ClipLibraryModal';

// ... keep existing code ...

export function ClipSelectorSidebar({
  clips,
  selectedClipId,
  onSelectClip,
  onAddClip,           // For file upload
  onAddFromLibrary,    // NEW: For library selection
  onDeleteClip,
  onReorderClips,
  globalTransition,
  onTransitionChange,
  existingRawClipIds = []  // NEW: Track which raw clips are already added
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const fileInputRef = useRef(null);

  // ... keep existing handlers ...

  const handleLibrarySelect = (rawClipId) => {
    if (onAddFromLibrary) {
      onAddFromLibrary(rawClipId);
    }
  };

  return (
    <div className="w-56 bg-gray-900/95 border-r border-gray-700 flex flex-col h-full">
      {/* Header - keep existing */}
      {/* ... */}

      {/* Clip list - keep existing */}
      {/* ... */}

      {/* Add clip section - MODIFIED */}
      <div className="p-3 border-t border-gray-700">
        {showAddMenu ? (
          <div className="space-y-2">
            {/* Upload option */}
            <button
              onClick={() => {
                fileInputRef.current?.click();
                setShowAddMenu(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
            >
              <Upload size={16} />
              <span>Upload Clip</span>
            </button>

            {/* Library option */}
            <button
              onClick={() => {
                setShowLibraryModal(true);
                setShowAddMenu(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
            >
              <Library size={16} />
              <span>From Library</span>
            </button>

            {/* Cancel */}
            <button
              onClick={() => setShowAddMenu(false)}
              className="w-full px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddMenu(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            <span>Add Clip</span>
          </button>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          className="hidden"
          multiple
        />
      </div>

      {/* Total duration - keep existing */}
      {/* ... */}

      {/* Library Modal */}
      <ClipLibraryModal
        isOpen={showLibraryModal}
        onClose={() => setShowLibraryModal(false)}
        onSelectClip={handleLibrarySelect}
        existingClipIds={existingRawClipIds}
      />
    </div>
  );
}
```

## Files to Modify in App.jsx

Update to pass the new props to ClipSelectorSidebar:

```javascript
// Get raw clip IDs already in the project (from working clips)
const existingRawClipIds = useMemo(() => {
  if (!selectedProject?.clips) return [];
  return selectedProject.clips
    .filter(c => c.raw_clip_id)
    .map(c => c.raw_clip_id);
}, [selectedProject]);

// Handler for adding from library
const handleAddFromLibrary = useCallback(async (rawClipId) => {
  if (!selectedProjectId) return;

  await addClipFromLibrary(rawClipId);
  // Refresh project to get updated clips list
  await refreshSelectedProject();
  // Also fetch the clip file and add to local clip manager
  // ... (implementation depends on how you handle clip loading)
}, [selectedProjectId, addClipFromLibrary, refreshSelectedProject]);

// In JSX:
<ClipSelectorSidebar
  clips={clips}
  selectedClipId={selectedClipId}
  onSelectClip={handleSelectClip}
  onAddClip={handleFileSelect}
  onAddFromLibrary={handleAddFromLibrary}  // NEW
  onDeleteClip={deleteClip}
  onReorderClips={reorderClips}
  globalTransition={globalTransition}
  onTransitionChange={setGlobalTransition}
  existingRawClipIds={existingRawClipIds}  // NEW
/>
```

## Testing Steps

### 1. Ensure Raw Clips Exist

First, make sure you have raw clips in the library:

```bash
sqlite3 user_data/a/database.sqlite "SELECT id, filename, rating FROM raw_clips;"
```

If empty, run an Annotate export with 4+ star clips first.

### 2. Load App and Select a Project

1. Open the app
2. Select or create a project
3. Should see the Framing mode

### 3. Test Add Menu

1. Click "Add Clip" button in sidebar
2. Should see two options: "Upload Clip" and "From Library"
3. Click "Cancel" - menu should close

### 4. Test Upload Option

1. Click "Add Clip" → "Upload Clip"
2. Should open file picker
3. Select a video file
4. Should add to the clips list

### 5. Test Library Modal

1. Click "Add Clip" → "From Library"
2. Modal should open
3. Should see list of raw clips from library
4. Each shows filename, rating stars, tags

### 6. Test Selection in Modal

1. Click on a clip - should show checkmark
2. Click again - should deselect
3. Select multiple clips
4. "Add" button should show count

### 7. Test Adding from Library

1. Select one or more clips
2. Click "Add"
3. Modal should close
4. Clips should appear in sidebar

### 8. Test Already Added Filter

1. Open library modal again
2. Clips you just added should NOT appear (filtered out)
3. If all clips are added, should show "All clips already added" message

### 9. Verify Database

```bash
sqlite3 user_data/a/database.sqlite << 'EOF'
SELECT wc.id, wc.project_id, wc.raw_clip_id, rc.filename
FROM working_clips wc
LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
WHERE wc.abandoned = FALSE;
EOF
```

## Success Criteria

- [ ] "Add Clip" button shows menu with two options
- [ ] "Upload Clip" opens file picker and works
- [ ] "From Library" opens modal
- [ ] Modal shows raw clips with rating and tags
- [ ] Can select/deselect clips in modal
- [ ] Can add multiple clips at once
- [ ] Added clips appear in sidebar
- [ ] Already-added clips filtered from modal
- [ ] Empty library shows appropriate message
- [ ] Modal cancel button works
