# Feature: Framing → Annotate Navigation + Tags Display

## Overview
Add ability to switch from Framing mode to Annotate mode with the current clip's game loaded and clip selected. Also display clip tags in the Framing header.

## Status
**DONE** - Implementation complete (already in codebase)

## Priority
**MEDIUM** - Quality of life feature for editing workflow

---

## Current State Analysis

### Data Available in Framing Mode
- `selectedClip.workingClipId` - backend working_clips.id
- `selectedClip.annotateName` - from raw_clips.name
- `selectedClip.annotateNotes` - from raw_clips.notes
- **Missing**: `game_id`, `start_time`, `end_time`, `tags`, `rating`

### Data Needed for Annotate Navigation
- `game_id` - to load the correct game video
- `start_time` - to seek to the clip's position in the game

### Database Relationships
```
working_clips.raw_clip_id → raw_clips.id
raw_clips.game_id → games.id
raw_clips has: start_time, end_time, tags, rating
```

### Existing Backend Query (clips.py:936-957)
Already joins `raw_clips` and gets `raw_name`, `raw_notes`, `raw_rating`, `raw_tags`.
**Missing**: `rc.game_id`, `rc.start_time`, `rc.end_time`

---

## Implementation Plan

### Task 1: Backend - Extend WorkingClipResponse Model

**File:** `src/backend/app/routers/clips.py` (lines 144-157)

Add new fields to the Pydantic model:

```python
class WorkingClipResponse(BaseModel):
    # ... existing fields ...
    # NEW fields for Annotate navigation:
    game_id: Optional[int] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    tags: Optional[List[str]] = None
    rating: Optional[int] = None
```

### Task 2: Backend - Update Query and Response Building

**File:** `src/backend/app/routers/clips.py` (lines 936-981)

1. Add to SELECT clause:
```sql
rc.game_id as raw_game_id,
rc.start_time as raw_start_time,
rc.end_time as raw_end_time
```

2. Update response building (around line 967):
```python
result.append(WorkingClipResponse(
    # ... existing fields ...
    game_id=clip['raw_game_id'],
    start_time=clip['raw_start_time'],
    end_time=clip['raw_end_time'],
    tags=tags,
    rating=rating
))
```

### Task 3: Frontend - Update useClipManager

**File:** `src/frontend/src/hooks/useClipManager.js`

Update clip loading to capture new fields from backend:

```javascript
const newClip = {
  ...existing fields...,
  gameId: projectClip.game_id,               // NEW
  annotateStartTime: projectClip.start_time, // NEW
  annotateEndTime: projectClip.end_time,     // NEW
  tags: projectClip.tags || [],              // NEW
  rating: projectClip.rating                 // NEW
};
```

### Task 4: Frontend - Add Tags Display in Framing Header

**File:** `src/frontend/src/modes/FramingModeView.jsx`

Add tags below the clip title (lines ~136):

```jsx
{clipTitle && (
  <div className="flex flex-col">
    <span className="font-semibold text-white">{clipTitle}</span>
    {clipTags?.length > 0 && (
      <div className="flex gap-1 mt-1">
        {clipTags.map(tag => (
          <span key={tag} className="px-2 py-0.5 bg-blue-500/30 text-blue-200 text-xs rounded">
            {tag}
          </span>
        ))}
      </div>
    )}
  </div>
)}
```

**Prop threading:**
- `FramingScreen.jsx` → `FramingModeView` needs to pass `clipTags={selectedClip?.tags}`

### Task 5: Frontend - Update FramingModeView (Tags + Button)

**File:** `src/frontend/src/modes/FramingModeView.jsx`

Restructure header (lines 133-159) to add tags and "Edit in Annotate" button:

```jsx
{metadata && !isFullscreen && (
  <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
    <div className="flex items-center justify-between text-sm text-gray-300">
      {/* Left: Title + Tags */}
      <div className="flex flex-col gap-1">
        {clipTitle && <span className="font-semibold text-white">{clipTitle}</span>}
        {clipTags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {clipTags.map(tag => (
              <span key={tag} className="px-2 py-0.5 bg-blue-500/30 text-blue-200 text-xs rounded">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right: Edit button + Metadata */}
      <div className="flex items-center gap-4">
        {canEditInAnnotate && (
          <button
            onClick={onEditInAnnotate}
            className="px-3 py-1.5 bg-green-600/20 hover:bg-green-600/40 text-green-300 text-sm rounded border border-green-600/30 transition-colors"
          >
            Edit in Annotate
          </button>
        )}
        <div className="flex space-x-6">
          {/* existing Resolution, Framerate, Format, Size */}
        </div>
      </div>
    </div>
  </div>
)}
```

**New props:** `clipTags`, `canEditInAnnotate`, `onEditInAnnotate`

### Task 6: Frontend - Add Handler in FramingScreen

**File:** `src/frontend/src/screens/FramingScreen.jsx`

```javascript
const handleEditInAnnotate = useCallback(() => {
  if (!selectedClip?.gameId) return;

  // Store navigation intent (same pattern as existing game loading)
  sessionStorage.setItem('pendingGameId', selectedClip.gameId.toString());
  sessionStorage.setItem('pendingClipSeekTime', selectedClip.annotateStartTime?.toString() || '0');

  // Switch to annotate mode
  setEditorMode('annotate');
}, [selectedClip, setEditorMode]);
```

Pass to FramingModeView: `clipTags={selectedClip?.tags}`, `canEditInAnnotate={selectedClip?.gameId != null}`, `onEditInAnnotate={handleEditInAnnotate}`

### Task 7: Frontend - Handle Navigation in AnnotateScreen

**File:** `src/frontend/src/screens/AnnotateScreen.jsx`

Update the existing `pendingGameId` handler to also seek to clip:

```javascript
useEffect(() => {
  const pendingGameId = sessionStorage.getItem('pendingGameId');
  const pendingSeekTime = sessionStorage.getItem('pendingClipSeekTime');

  if (pendingGameId && !annotateVideoUrl) {
    handleLoadGame(parseInt(pendingGameId));

    // After game loads, seek to clip position
    if (pendingSeekTime) {
      // Queue seek for after video is ready
      setPendingSeekTime(parseFloat(pendingSeekTime));
    }

    sessionStorage.removeItem('pendingGameId');
    sessionStorage.removeItem('pendingClipSeekTime');
  }
}, []);

// Separate effect to handle seek after video loads
useEffect(() => {
  if (pendingSeekTime != null && annotateVideoUrl && videoRef.current) {
    seek(pendingSeekTime);
    setPendingSeekTime(null);
  }
}, [pendingSeekTime, annotateVideoUrl, seek]);
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/backend/app/routers/clips.py` | Join raw_clips to get game_id, start_time, end_time, tags, rating |
| `src/frontend/src/hooks/useClipManager.js` | Capture new fields from backend response |
| `src/frontend/src/modes/FramingModeView.jsx` | Add tags display + "Edit in Annotate" button |
| `src/frontend/src/screens/FramingScreen.jsx` | Add handleEditInAnnotate handler, pass props |
| `src/frontend/src/screens/AnnotateScreen.jsx` | Handle pendingClipSeekTime for navigation |

---

## Verification

1. **Backend test**:
   ```bash
   curl http://localhost:8000/api/projects/{id}/clips | jq '.[0] | {game_id, start_time, tags, rating}'
   ```
   Verify new fields are present for clips from annotations.

2. **Tags display**:
   - Load a project with clips from annotation (have tags)
   - Verify tags appear as badges under the clip title in Framing header

3. **Edit in Annotate button**:
   - Clips from annotations (have gameId) → button visible
   - Directly uploaded clips (no gameId) → button hidden

4. **Navigation flow**:
   - In Framing, click "Edit in Annotate"
   - Verify Annotate mode loads with correct game video
   - Verify playhead seeks to clip's start_time
   - Verify the clip region is visible on timeline
