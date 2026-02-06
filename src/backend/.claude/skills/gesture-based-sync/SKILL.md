---
name: gesture-based-sync
description: "Action-based API pattern that sends user gestures instead of full state blobs. Prevents data loss from concurrent edits and enables conflict detection. Apply when implementing API endpoints or modifying data sync."
license: MIT
author: video-editor
version: 1.0.0
---

# Gesture-Based Sync

Send user gestures (actions) instead of full JSON blobs. Enables atomic operations, conflict detection, and future undo/redo.

## When to Apply
- Implementing new API endpoints that modify data
- Refactoring existing PUT endpoints
- Debugging data loss or overwrite issues
- Implementing optimistic UI updates

## The Problem with Full Blobs

```javascript
// Component A sends full highlights_data
PUT /overlay-data { highlights_data: [...all regions...] }

// Component B sends full crop_keyframes (same request)
PUT /clips/123 { crop_data: [...all keyframes...] }

// Result: One overwrites the other, data lost
```

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Action Design | CRITICAL | `action-` |
| 2 | Endpoint Pattern | HIGH | `endpoint-` |
| 3 | Versioning | HIGH | `version-` |
| 4 | Frontend Integration | MEDIUM | `frontend-` |

## Quick Reference

### Action Design (CRITICAL)
- `action-gesture-not-state` - Send the user action, not resulting state
- `action-idempotent` - Same action applied twice = same result
- `action-atomic` - Each action is one DB operation

### Endpoint Pattern (HIGH)
- `endpoint-actions-route` - Use `POST /resource/actions` pattern
- `endpoint-action-target-data` - Structure: `{action, target, data}`
- `endpoint-version-response` - Return `{success, version, applied_at}`

### Versioning (HIGH)
- `version-expected` - Client sends `expected_version`
- `version-conflict-409` - Return 409 if version mismatch
- `version-increment` - Increment version after each action

### Frontend Integration (MEDIUM)
- `frontend-optimistic-ui` - Apply change immediately, confirm/reject later
- `frontend-action-queue` - Queue actions for offline support
- `frontend-conflict-refresh` - Show "data changed, refresh" on conflict

---

## Endpoint Pattern

### Instead of PUT with full blob:
```javascript
PUT /api/clips/123
{ crop_data: JSON.stringify(allKeyframes) }  // BAD: Full blob
```

### Use POST with action:
```javascript
POST /api/clips/123/actions
{
  "action": "add_crop_keyframe",
  "data": { "frame": 100, "x": 50, "y": 50, "width": 640, "height": 360 }
}
```

---

## Action Types

### Framing Actions
```javascript
{ "action": "add_crop_keyframe", "data": { "frame": 100, "x": 50, ... } }
{ "action": "update_crop_keyframe", "target": { "frame": 100 }, "data": { "x": 60 } }
{ "action": "delete_crop_keyframe", "target": { "frame": 100 } }
{ "action": "move_crop_keyframe", "target": { "frame": 100 }, "data": { "new_frame": 120 } }
{ "action": "set_trim_range", "data": { "start": 1.0, "end": 5.0 } }
```

### Overlay Actions
```javascript
{ "action": "create_region", "data": { "start_time": 0, "end_time": 2.0 } }
{ "action": "delete_region", "target": { "region_id": "xxx" } }
{ "action": "add_region_keyframe", "target": { "region_id": "xxx" }, "data": { ... } }
{ "action": "set_effect_type", "data": { "effect_type": "brightness_boost" } }
```

### Annotation Actions
```javascript
{ "action": "create_annotation", "data": { "start_time": 10, "end_time": 15, "name": "Play" } }
{ "action": "update_annotation", "target": { "annotation_id": 123 }, "data": { "rating": 5 } }
{ "action": "add_tag", "target": { "annotation_id": 123 }, "data": { "tag": "goal" } }
```

---

## Backend Implementation

```python
@router.post("/projects/{project_id}/clips/{clip_id}/actions")
async def clip_action(project_id: int, clip_id: int, action: ClipAction):
    if action.action == "add_crop_keyframe":
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
```

---

## Benefits

| Aspect | Full Blob | Gesture-Based |
|--------|-----------|---------------|
| Data loss risk | High (overwrites) | Low (atomic ops) |
| Bandwidth | High (full state) | Low (just delta) |
| Conflict resolution | Last-write-wins only | Can merge |
| Debugging | Hard (what changed?) | Easy (action log) |
| Undo/redo | Store full states | Store action history |
| Offline support | Complex | Natural (queue actions) |

---

## Migration Priority

Based on complexity and bug frequency:
1. **Overlay highlights** - Most complex, most bugs
2. **Framing crop keyframes** - Medium complexity
3. **Annotations** - Simpler, fewer bugs

---

## Implementation Strategy

### Phase 1: Add Action Endpoints (Backend)
1. Create `/actions` endpoints alongside existing PUT endpoints
2. Both old and new endpoints work (backward compatible)
3. Actions modify DB directly, no full blob parsing

### Phase 2: Migrate Frontend (One Feature at a Time)
1. Start with **Overlay** (most complex, highest bug rate)
2. Then **Framing**
3. Then **Annotations**

### Phase 3: Add Versioning (Conflict Detection)
1. Each entity has a `version` field
2. Actions include `expected_version` parameter
3. Backend rejects if version mismatch (409 Conflict)

---

## Complete Rules

See individual rule files in `rules/` directory.
