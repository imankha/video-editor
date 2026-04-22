# T1660: Framing Gesture Persistence Audit

## Problem

User reported deleted keyframes "popping back up" in framing mode. Root cause: all framing gesture API calls use fire-and-forget with no error recovery. If the backend rejects a write (validation error, network failure), the UI has already updated optimistically and never rolls back. On next load, stale data reappears from the DB.

**There is no safety net.** `saveCurrentClipState` is only called on export button click (`ExportButtonContainer.jsx:621`). There is no auto-save on clip switch or navigation -- `clipHasUserEditsRef` is reset to `false` on clip change (`FramingContainer.jsx:812-813`) without triggering a save. So if a gesture API call fails silently, the data is permanently lost.

## Complete Gesture Inventory

| # | Gesture | Handler (line) | API Action | Store Sync | Status |
|---|---------|----------------|------------|------------|--------|
| 1 | Drag/resize crop (add/update kf) | `handleCropComplete` (:293) | `addCropKeyframe` | `updateClipData` | OK |
| 2 | Delete keyframe | `handleKeyframeDelete` (:618) | `deleteCropKeyframe` | **MISSING** | BROKEN |
| 3 | Copy crop | `handleCopyCrop` (:636) | None (local only) | N/A | OK |
| 4 | Paste crop | `handlePasteCrop` (:645) | `addCropKeyframe` | **MISSING** | BROKEN |
| 5 | Split segment | `handleAddSplit` (:670) | `splitSegment` | **MISSING** | BROKEN |
| 6 | Remove split | `handleRemoveSplit` (:687) | `removeSegmentSplit` | **MISSING** | BROKEN |
| 7 | Set segment speed | `handleSegmentSpeedChange` (:715) | `setSegmentSpeed` | `updateClipData` | OK |
| 8 | Trim segment | `handleTrimSegment` (:334) | `setTrimRange` | `updateClipData` (partial) | BROKEN |
| 9 | Detrim start | `handleDetrimStart` (:458) | `setTrimRange`/`clearTrimRange` | **MISSING** | BROKEN |
| 10 | Detrim end | `handleDetrimEnd` (:533) | `setTrimRange`/`clearTrimRange` | **MISSING** | BROKEN |
| 11 | Click keyframe (seek) | `handleKeyframeClick` (:611) | None (navigation) | N/A | OK |

All line numbers reference `src/frontend/src/containers/FramingContainer.jsx`.

**"BROKEN" means:** fire-and-forget API (no error handling) AND/OR missing store sync. ALL gesture API calls share the fire-and-forget problem; "BROKEN" in the table highlights gestures with additional gaps.

## Delete Keyframe: End-to-End Trace (the reported bug)

```
User clicks red Trash button on KeyframeMarker
  -> KeyframeMarker.jsx:109 onDelete() callback
  -> CropLayer.jsx:151 onKeyframeDelete(keyframeTime, duration)
  -> FramingContainer.jsx:618 handleKeyframeDelete(time)
     1. frame = Math.round(time * framerate)
     2. removeKeyframe(time, duration)          <-- UI UPDATED HERE (keyframe gone)
     3. onUserEdit?.()
     4. setFramingChangedSinceExport?.(true)
     5. framingActions.deleteCropKeyframe(projectId, clipId, frame)  <-- async, NOT awaited
        -> sendAction() POST /api/clips/projects/{pid}/clips/{cid}/actions
           { action: "delete_crop_keyframe", target: { frame } }
        -> Backend clips.py:404-418:
           a. _find_keyframe_by_frame(crop_keyframes, frame)
           b. if idx == -1: raise ValueError("not found")     <-- REJECTION
           c. if origin == 'permanent': raise ValueError(...)  <-- REJECTION
           d. del crop_keyframes[idx]
           e. _save_clip_framing_data() -> UPDATE working_clips
        -> Returns {success: true} or 400 {success: false, error: "..."}
     6. .catch(err => console.error('...'))     <-- ONLY catches network errors
        .then() DOES NOT EXIST                  <-- response never checked
```

**Backend rejection conditions that could cause the bug:**
- Frame number mismatch: `Math.round(time * framerate)` on frontend vs what's stored in DB (rounding drift)
- Keyframe has `origin: 'permanent'` -- backend refuses to delete it
- Clip ID stale (clip was versioned/re-exported, old ID no longer valid)

**Result:** UI shows keyframe deleted. Backend may have rejected it. On next clip load from DB, keyframe reappears.

## Anomalies Found

### A1: Fire-and-forget with no error recovery (ALL gestures)

Every gesture handler follows this broken pattern:

```javascript
framingActions.deleteCropKeyframe(projectId, clipId, frame)
  .catch(err => console.error('...', err));
```

No `.then()`. No response checking. No rollback. The `sendAction` function returns `{success, error}` on failure, but no caller checks it.

**Affected handlers** (all in `FramingContainer.jsx`):
- `handleKeyframeDelete` (line 628)
- `handleCropComplete` (line 312)
- `handlePasteCrop` (line 662)
- `handleAddSplit` (line 680)
- `handleRemoveSplit` (line 697)
- `handleSegmentSpeedChange` (line 724)
- `handleTrimSegment` (line 436)
- `handleDetrimStart` (lines 519, 523)
- `handleDetrimEnd` (lines 598, 603)

### A2: Delete keyframe doesn't sync to clip store

`handleCropComplete` updates the clip store via `updateClipData(selectedClipId, { crop_data: ... })` (line 317-322) so sidebar indicators reflect the change. But `handleKeyframeDelete` does NOT call `updateClipData`. Same gap for paste, split, remove split, detrim start, detrim end.

### A3: Trim/detrim keyframe modifications are local-only (BOTH crop AND highlight)

When trimming, the handler:
1. Calls `deleteKeyframesInRange()` -- local state only, NOT sent to backend
2. Calls `addOrUpdateKeyframe()` for boundary permanent kf -- local state only
3. Also modifies **highlight keyframes** via `highlightHook.deleteKeyframesInRange()` and `highlightHook.addOrUpdateKeyframe()` -- same local-only gap
4. Only sends `setTrimRange` to backend

The keyframe changes (both crop AND highlight) rely on `saveCurrentClipState` at export time. If user trims then switches clips, keyframe changes from the trim are lost.

Same pattern in `handleDetrimStart` (:458) and `handleDetrimEnd` (:533) -- both modify crop and highlight keyframes locally, only persist the trim range.

### A4: `moveCropKeyframe` API is dead code

`framingActions.js:95` exports it, backend supports it (`clips.py:420`), but no gesture handler calls it.

## Fix Plan

### Phase 1: Error Recovery (fixes the reported bug)

For each gesture handler:
1. `await` the API call
2. Check the response for `{success: false}`
3. On failure: revert the optimistic UI update OR show an error toast
4. Log the specific error for debugging

### Phase 2: Store Sync Consistency

For gestures missing `updateClipData`:
- `handleKeyframeDelete`: filter deleted keyframe from store's `crop_data`
- `handlePasteCrop`: add pasted keyframe to store's `crop_data`
- `handleAddSplit` / `handleRemoveSplit`: update store's `segments_data`
- `handleDetrimStart` / `handleDetrimEnd`: update store's `segments_data`

### Phase 3: Trim/Detrim Keyframe Persistence

When trim/detrim modifies keyframes locally, also send corresponding `delete_crop_keyframe` / `add_crop_keyframe` actions to the backend so the DB stays in sync without relying on a later full-state save.

### Out of Scope

- A4 (dead code `moveCropKeyframe`) - remove or wire up separately
- Conflict detection via `expected_version` - future enhancement

## Key Architecture Context

### Persistence model (from CLAUDE.md)
- **Gesture -> surgical API call**: each user action fires a backend call sending ONLY the changed data
- **No reactive persistence**: never useEffect to watch state and write to DB
- **Full-state saves require explicit gesture**: `saveCurrentClipState` only on export click

### sendAction (framingActions.js:23-47)
Already correctly returns `{success: false, error: "..."}` on both HTTP errors and network failures. The fix is purely on the **caller side** -- handlers need to check the return value.

### Backend error handling (clips.py:500-505)
Already correctly returns 400 with `{success: false, error: "..."}` for ValueError (validation) and 500 for unexpected errors. No backend changes needed.

### State reload path
When a clip is selected/reloaded, keyframes are loaded from the DB via `projectDataStore.loadProjectData()` -> clip's `crop_data` column. If a gesture failed silently, the DB still has the old state, and that's what gets loaded.

## Files

| File | Changes |
|------|---------|
| `src/frontend/src/containers/FramingContainer.jsx` | All gesture handlers -- add response handling + store sync |
| `src/frontend/src/api/framingActions.js` | No changes needed (already returns results correctly) |
| `src/backend/app/routers/clips.py` | No changes needed (already returns errors correctly) |

## Classification

**Stack Layers:** Frontend
**Files Affected:** ~1 file (FramingContainer.jsx)
**LOC Estimate:** ~100 lines
**Test Scope:** Frontend Unit (mock API responses, verify rollback behavior)
