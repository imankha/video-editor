# Backend-Authoritative Framing Export

## Overview

This document describes the architecture change from client-driven to backend-authoritative rendering for framing exports.

## Current Architecture (Problems)

```
Frontend                                    Backend
────────                                    ───────
User edits crop/trim/speed
    │
    ▼
Local state (keyframes, segments)
    │
    ├──(async)── PUT /clips/{id} ──────────▶ Save to working_clips
    │            (may or may not complete)    (crop_data, segments_data, timing_data)
    │
    ▼
Export button clicked
    │
    ▼
Send video + ALL edit data ──────────────▶ Render video (trusts frontend data)
                                           Create working_video
                                           (NO validation against saved data)
```

**Problems:**
1. Export data may be out of sync with saved data
2. Projects can have working_videos without working_clips (orphans)
3. Backend can't reproduce exports without frontend
4. No single source of truth

## New Architecture (Backend-Authoritative)

```
Frontend                                    Backend
────────                                    ───────
User edits crop/trim/speed
    │
    ▼
PUT /clips/{id} ───────────────────────────▶ Save to working_clips
    │                                        (crop_data, segments_data, timing_data)
    │                                               │
    ▼                                               ▼
(await response - save confirmed)            R2 sync (middleware)
    │
    ▼
Export button clicked
    │
    ▼
POST /export/framing/render ───────────────▶ 1. Read working_clips
    { project_id }                           2. VALIDATE: clips exist, have data
                                             3. Fetch video(s) from R2
                                             4. Render using STORED parameters
                                             5. Create working_video
                                             6. R2 sync
```

**Benefits:**
1. Backend is single source of truth
2. Exports are reproducible (same input = same output)
3. Projects without working_clips can't export (fail-fast)
4. No orphan working_videos possible
5. Simpler frontend (no need to serialize complex data on export)

## Database Schema (Existing - No Changes Needed)

```sql
-- working_clips already has all rendering data
CREATE TABLE working_clips (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    raw_clip_id INTEGER,           -- Links to source video
    crop_data TEXT,                -- JSON: crop keyframes
    timing_data TEXT,              -- JSON: trim range
    segments_data TEXT,            -- JSON: speed segments
    sort_order INTEGER,            -- Multi-clip ordering
    version INTEGER,               -- For versioning
    ...
);
```

## Save Strategy (Sync Guarantees)

The sync strategy ensures **one R2 sync per user gesture**:

1. **Request-level batching**: `DatabaseSyncMiddleware` syncs at end of each HTTP request
2. **Write detection**: `TrackedCursor` automatically detects INSERT/UPDATE/DELETE
3. **Batched commits**: Multiple DB writes in one request = one sync

```
User gesture: "Update crop position"
    │
    ▼
HTTP Request: PUT /clips/projects/1/clips/5
    │
    ├── TrackedCursor detects write (UPDATE working_clips)
    ├── TrackedCursor detects write (INSERT working_clips - new version)
    ▼
Response returned
    │
    ▼
DatabaseSyncMiddleware: sync_db_to_cloud_if_writes()
    │
    ▼
Single R2 upload containing ALL changes
```

## API Design

### New Endpoint: `POST /api/export/framing/render`

**Request:**
```json
{
  "project_id": 123,
  "export_id": "uuid-for-websocket"
}
```

**Response (success):**
```json
{
  "success": true,
  "working_video_id": 456,
  "filename": "working_123_abc.mp4"
}
```

**Response (error - no clips):**
```json
{
  "error": "no_clips",
  "message": "Project has no clips to export. Add clips first."
}
```

**Response (error - missing data):**
```json
{
  "error": "missing_crop_data",
  "message": "Clip 'Great Goal' has no framing data. Open clip in Framing mode first.",
  "clip_id": 5
}
```

### Backend Processing Steps

1. **Validate project exists** and belongs to user
2. **Fetch working_clips** for project (latest version)
3. **Validate each clip** has required data:
   - `raw_clip_id` or `uploaded_filename` (source video reference)
   - Source video exists in R2
4. **Fetch source videos** from R2 to temp directory
5. **Render** using stored parameters:
   - Parse `crop_data` → CropKeyframe objects
   - Parse `segments_data` → segment boundaries, speeds
   - Parse `timing_data` → trim range
6. **Apply standard rendering** (same as current upscale endpoint)
7. **Save working_video** to R2 and database
8. **Return result** to frontend

## Frontend Changes

### ExportButton.jsx

```javascript
// Before (client-sends-everything)
const handleFramingExport = async () => {
  formData.append('video', videoFile);
  formData.append('keyframes_json', JSON.stringify(cropKeyframes));
  formData.append('segment_data_json', JSON.stringify(segmentData));
  await axios.post('/api/export/upscale', formData);
};

// After (backend-authoritative)
const handleFramingExport = async () => {
  // 1. Ensure all edits are saved
  await saveCurrentClipState();

  // 2. Request render (backend reads from DB)
  await axios.post('/api/export/framing/render', {
    project_id: projectId,
    export_id: generateExportId()
  });
};
```

### Save-Before-Export Pattern

```javascript
const handleExport = async () => {
  // Save any pending edits
  if (hasUnsavedChanges) {
    const saveResult = await saveFramingEdits(currentClipId, {
      cropKeyframes,
      segments: segmentData,
      trimRange
    });

    if (!saveResult.success) {
      showError("Failed to save changes. Please try again.");
      return;
    }
  }

  // Now safe to request backend render
  startExport();
};
```

## Multi-Clip Export

For projects with multiple clips:

1. Backend reads all working_clips in `sort_order`
2. For each clip:
   - Fetch source video from R2
   - Apply clip-specific crop/trim/speed
   - Render clip segment
3. Concatenate clips with transitions
4. Save final working_video

## Migration Path

1. **Phase 1**: Add new endpoint `/api/export/framing/render` (this task)
2. **Phase 2**: Update frontend to use new endpoint
3. **Phase 3**: Deprecate old `/api/export/upscale` endpoint
4. **Phase 4**: Remove old endpoint after testing period

## Error Handling

| Error Case | Backend Response | Frontend Action |
|------------|------------------|-----------------|
| Project not found | 404 | Show error, return to projects |
| No clips in project | 400 `no_clips` | Show "Add clips first" |
| Clip missing framing data | 400 `missing_crop_data` | Offer to open clip |
| Source video not found | 500 `video_not_found` | Show error, suggest re-import |
| R2 fetch failed | 500 `storage_error` | Show retry option |
| Render failed | 500 `render_error` | Show error details |

## Testing Checklist

- [ ] Single clip export from saved data
- [ ] Multi-clip export preserves order
- [ ] Missing crop_data returns clear error
- [ ] Missing source video returns clear error
- [ ] Export after save produces correct output
- [ ] Progress WebSocket works with new endpoint
- [ ] E2E test: edit → save → export → verify output
