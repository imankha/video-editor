# Gesture-Based Sync Strategy

## Problem Statement

The frontend currently sends **full JSON blobs** to the backend, which causes:

1. **Same-session overwrites**: Component A sends full `highlights_data`, Component B sends full `crop_keyframes` - one overwrites the other
2. **Data loss on concurrent edits**: Even within one tab, rapid edits can race and overwrite each other
3. **Inefficient sync**: Sending 50 keyframes when only 1 changed wastes bandwidth and processing
4. **Harder conflict resolution**: With full blobs, you can only do "last write wins" - with gestures, you could merge

## Current Architecture (Problematic Endpoints)

### 1. Framing Edits - `PUT /api/clips/projects/{projectId}/clips/{clipId}`

**Current payload** (from `useProjectClips.js:226-262`):
```javascript
{
  "crop_data": JSON.stringify(fullCropKeyframesArray),      // ALL keyframes
  "segments_data": JSON.stringify(fullSegmentsObject),     // ALL segment data
  "timing_data": JSON.stringify({ trimRange: fullRange })  // Full trim range
}
```

**User gestures this represents**:
- Add crop keyframe at frame X
- Move crop keyframe from frame X to frame Y
- Delete crop keyframe at frame X
- Update crop keyframe values (x, y, width, height)
- Split segment at time T
- Change segment speed
- Set trim range start/end

---

### 2. Overlay Data - `PUT /api/export/projects/{projectId}/overlay-data`

**Current payload** (from `OverlayContainer.jsx:337-363`):
```javascript
FormData {
  "highlights_data": JSON.stringify(fullHighlightRegionsArray),  // ALL regions with ALL keyframes
  "text_overlays": JSON.stringify(fullTextOverlaysArray),        // ALL text overlays
  "effect_type": "brightness_boost" | "original" | "dark_overlay"
}
```

**User gestures this represents**:
- Create highlight region (start_time, end_time)
- Delete highlight region
- Move region start/end boundary
- Toggle region enabled/disabled
- Add keyframe to region (time, x, y, radiusX, radiusY, opacity, color)
- Move/resize keyframe
- Delete keyframe from region
- Change effect type

---

### 3. Annotations - `PUT /api/games/{gameId}/annotations`

**Current payload** (from `useGames.js:377-406`):
```javascript
[
  { "id": 1, "start_time": 0, "end_time": 5, "name": "Clip 1", "rating": 5, "tags": [...], "notes": "..." },
  { "id": 2, "start_time": 10, "end_time": 15, "name": "Clip 2", ... },
  // ... ALL annotations
]
```

**User gestures this represents**:
- Create annotation (start_time, end_time)
- Delete annotation
- Update annotation name
- Update annotation rating
- Add/remove tag
- Update annotation notes
- Move annotation start/end time

---

## Proposed Architecture: Gesture-Based API

### Design Principles

1. **Send the user gesture, not the resulting state** - The backend computes the new state
2. **Idempotent operations** - Same gesture applied twice = same result
3. **Atomic operations** - Each gesture is one DB operation
4. **Optimistic UI** - Frontend applies change immediately, backend confirms/rejects

### New Endpoint Pattern

Instead of `PUT /resource` with full blob, use:
```
POST /api/{resource}/actions
{
  "action": "action_name",
  "target": { /* identifies what to modify */ },
  "data": { /* the change */ }
}
```

---

## Proposed Endpoints

### 1. Framing Actions - `POST /api/clips/projects/{projectId}/clips/{clipId}/actions`

```javascript
// Add keyframe
{ "action": "add_crop_keyframe", "data": { "frame": 100, "x": 50, "y": 50, "width": 640, "height": 360 } }

// Update keyframe
{ "action": "update_crop_keyframe", "target": { "frame": 100 }, "data": { "x": 60, "y": 55 } }

// Delete keyframe
{ "action": "delete_crop_keyframe", "target": { "frame": 100 } }

// Move keyframe to new frame
{ "action": "move_crop_keyframe", "target": { "frame": 100 }, "data": { "new_frame": 120 } }

// Split segment
{ "action": "split_segment", "data": { "time": 2.5 } }

// Set segment speed
{ "action": "set_segment_speed", "target": { "segment_index": 0 }, "data": { "speed": 0.5 } }

// Set trim range
{ "action": "set_trim_range", "data": { "start": 1.0, "end": 5.0 } }

// Clear trim range
{ "action": "clear_trim_range" }
```

**Backend response**:
```javascript
{
  "success": true,
  "version": 47,           // Incremented version for conflict detection
  "applied_at": "2024-01-30T12:00:00Z"
}
```

---

### 2. Overlay Actions - `POST /api/export/projects/{projectId}/overlay/actions`

```javascript
// Create region
{ "action": "create_region", "data": { "start_time": 0, "end_time": 2.0 } }
// Returns: { "region_id": "region-xxx", ... }

// Delete region
{ "action": "delete_region", "target": { "region_id": "region-xxx" } }

// Move region boundary
{ "action": "move_region_start", "target": { "region_id": "region-xxx" }, "data": { "start_time": 0.5 } }
{ "action": "move_region_end", "target": { "region_id": "region-xxx" }, "data": { "end_time": 2.5 } }

// Toggle region
{ "action": "toggle_region", "target": { "region_id": "region-xxx" }, "data": { "enabled": false } }

// Add keyframe to region
{
  "action": "add_region_keyframe",
  "target": { "region_id": "region-xxx" },
  "data": { "time": 1.0, "x": 0.5, "y": 0.5, "radiusX": 0.1, "radiusY": 0.15, "opacity": 0.3, "color": "#FFFF00" }
}

// Update keyframe
{
  "action": "update_region_keyframe",
  "target": { "region_id": "region-xxx", "time": 1.0 },
  "data": { "x": 0.55, "y": 0.52 }
}

// Delete keyframe
{ "action": "delete_region_keyframe", "target": { "region_id": "region-xxx", "time": 1.0 } }

// Set effect type
{ "action": "set_effect_type", "data": { "effect_type": "brightness_boost" } }
```

---

### 3. Annotation Actions - `POST /api/games/{gameId}/annotation/actions`

```javascript
// Create annotation
{
  "action": "create_annotation",
  "data": { "start_time": 10.0, "end_time": 15.0, "name": "Great Play" }
}
// Returns: { "annotation_id": 123, ... }

// Delete annotation
{ "action": "delete_annotation", "target": { "annotation_id": 123 } }

// Update annotation field (partial update)
{ "action": "update_annotation", "target": { "annotation_id": 123 }, "data": { "name": "Amazing Play" } }
{ "action": "update_annotation", "target": { "annotation_id": 123 }, "data": { "rating": 5 } }
{ "action": "update_annotation", "target": { "annotation_id": 123 }, "data": { "notes": "Player scored" } }

// Move annotation time
{
  "action": "move_annotation",
  "target": { "annotation_id": 123 },
  "data": { "start_time": 11.0, "end_time": 16.0 }
}

// Add/remove tag
{ "action": "add_tag", "target": { "annotation_id": 123 }, "data": { "tag": "goal" } }
{ "action": "remove_tag", "target": { "annotation_id": 123 }, "data": { "tag": "goal" } }
```

---

## Implementation Strategy

### Phase 1: Add Action Endpoints (Backend)

1. Create new `/actions` endpoints alongside existing PUT endpoints
2. Both old and new endpoints work (backward compatible)
3. Actions modify DB directly, no full blob parsing

**Backend pattern**:
```python
@router.post("/projects/{project_id}/clips/{clip_id}/actions")
async def clip_action(project_id: int, clip_id: int, action: ClipAction):
    if action.action == "add_crop_keyframe":
        # Parse existing crop_data, add keyframe, save
        current = get_clip_crop_data(clip_id)
        current.append(action.data)
        current.sort(key=lambda k: k["frame"])
        save_clip_crop_data(clip_id, current)
        return {"success": True, "version": get_new_version()}

    elif action.action == "delete_crop_keyframe":
        current = get_clip_crop_data(clip_id)
        current = [k for k in current if k["frame"] != action.target["frame"]]
        save_clip_crop_data(clip_id, current)
        return {"success": True, "version": get_new_version()}
    # ... etc
```

### Phase 2: Migrate Frontend (One Feature at a Time)

1. Start with **Overlay** (most complex, highest bug rate)
2. Then **Framing**
3. Then **Annotations**

**Frontend pattern**:
```javascript
// Before (useProjectClips.js)
const saveFramingEdits = async (clipId, framingData) => {
  await fetch(`/api/clips/.../clips/${clipId}`, {
    method: 'PUT',
    body: JSON.stringify({
      crop_data: JSON.stringify(framingData.cropKeyframes),  // Full blob!
    })
  });
};

// After
const addCropKeyframe = async (clipId, keyframe) => {
  await fetch(`/api/clips/.../clips/${clipId}/actions`, {
    method: 'POST',
    body: JSON.stringify({
      action: 'add_crop_keyframe',
      data: keyframe
    })
  });
};
```

### Phase 3: Add Versioning (Conflict Detection)

1. Each entity (clip, overlay, annotation) has a `version` field
2. Actions include `expected_version` parameter
3. Backend rejects if version mismatch (409 Conflict)
4. Frontend can show "data changed, refresh" or attempt merge

```javascript
// Request with version
{
  "action": "add_crop_keyframe",
  "expected_version": 46,
  "data": { ... }
}

// Response on conflict
{
  "success": false,
  "error": "version_conflict",
  "current_version": 47,
  "message": "Data was modified. Refresh and retry."
}
```

### Phase 4: Deprecate Full-Blob Endpoints

1. Log usage of old PUT endpoints
2. When no usage for 30 days, remove them
3. Frontend fully migrated to gesture-based

---

## Benefits

| Aspect | Full Blob | Gesture-Based |
|--------|-----------|---------------|
| Data loss risk | High (overwrites) | Low (atomic ops) |
| Bandwidth | High (full state) | Low (just delta) |
| Conflict resolution | Last-write-wins only | Can merge non-conflicting |
| Debugging | Hard (what changed?) | Easy (action log) |
| Undo/redo | Must store full states | Store action history |
| Offline support | Complex | Natural (queue actions) |

---

## Migration Priority

Based on current bug frequency and complexity:

1. **Overlay highlights** - Most complex, most bugs
2. **Framing crop keyframes** - Medium complexity
3. **Annotations** - Simpler, fewer bugs

---

## Files to Modify

### Backend (new endpoints)
- `src/backend/app/routers/clips.py` - Add `/actions` endpoint
- `src/backend/app/routers/export/overlay.py` - Add `/overlay/actions` endpoint
- `src/backend/app/routers/games.py` - Add `/annotation/actions` endpoint

### Frontend (migrate to actions)
- `src/frontend/src/hooks/useProjectClips.js` - Replace `saveFramingEdits`
- `src/frontend/src/containers/OverlayContainer.jsx` - Replace `saveOverlayData`
- `src/frontend/src/hooks/useGames.js` - Replace `saveAnnotations`
- `src/frontend/src/hooks/useHighlightRegions.js` - Add action dispatchers

### New files
- `src/backend/app/models/actions.py` - Pydantic models for actions
- `src/frontend/src/api/actions.js` - Action API client

---

## Testing Strategy

1. **Unit tests**: Each action type independently
2. **Integration tests**: Action sequences (add, update, delete)
3. **Conflict tests**: Simulate concurrent edits, verify rejection
4. **E2E tests**: Full workflow with new action endpoints

---

## Rollout Plan

1. Deploy backend with new endpoints (old endpoints still work)
2. Feature flag: `USE_ACTION_API=false` initially
3. Internal testing with flag enabled
4. Gradual rollout: 10% → 50% → 100%
5. Monitor for errors, rollback if needed
6. Deprecate old endpoints after 30 days stable

---

## Relationship to Task 17 (Stale Session Detection)

This task (gesture-based sync) and Task 17 (stale session detection) are complementary:

- **Task 17** solves: Tab A vs Tab B conflict (different sessions)
- **This task** solves: Component A vs Component B conflict (same session)

With both:
1. Gestures reduce conflict surface area (smaller atomic changes)
2. Version numbers enable detection of both same-session and cross-session conflicts
3. Backend can potentially merge non-conflicting gestures from different sources

Implement **this task first** - it provides the versioning infrastructure that Task 17 needs.
