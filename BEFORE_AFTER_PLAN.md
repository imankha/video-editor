# Before/After Comparison Video Feature

## Implementation Status: COMPLETE

| Phase | Component | Status | Notes |
|-------|-----------|--------|-------|
| 1.1 | Database table design | COMPLETE | `before_after_tracks` table |
| 1.2 | Database migration | COMPLETE | Added to database.py |
| 2.1 | Track source clips on final export | COMPLETE | Populates tracking on final export |
| 2.2 | API endpoint for comparison video | COMPLETE | `POST /api/export/before-after/{id}` |
| 2.3 | Status check endpoint | COMPLETE | `GET /api/export/before-after/{id}/status` |
| 3.1 | Video generation logic | COMPLETE | FFmpeg composition in before_after.py |
| 3.2 | Text overlay rendering | COMPLETE | "Before" / "After" labels (72px white text) |
| 4.1 | Gallery UI button | COMPLETE | Blue columns icon in DownloadsPanel |

### Handoff Notes
- **2026-01-12**: Implementation complete
  - Database table `before_after_tracks` stores source clip info per final video
  - Final export automatically populates tracking table
  - API generates 9x16 comparison video with text overlays
  - Gallery shows blue columns button to export before/after
  - Note: Only works for videos exported AFTER this feature was added
  - **Fix applied**: Changed concatenation from `-c copy` (concat demuxer) to filter_complex with re-encoding to fix truncated output issue
  - **Expected behavior**: "Before" shows raw footage at original speed; "After" shows final video with all effects (including speed changes). Duration differences are expected.

---

## Requirements

1. **Database tracking**: Store relationship between final videos and their source footage
   - Source file path (raw clip)
   - Frame range used from source
   - Link to final output

2. **Comparison video format**:
   - 9x16 vertical format
   - Input videos scaled to fit inside 9x16
   - Only for 9x16 exports (full space utilization)
   - "Before" text overlay (top centered) on source footage
   - "After" text overlay (top centered) on final footage

3. **Gallery export button**: One-click export of before/after comparison

---

## Architecture

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS before_after_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    final_video_id INTEGER NOT NULL,
    raw_clip_id INTEGER,              -- NULL if uploaded file
    source_path TEXT NOT NULL,        -- Path to source video
    start_frame INTEGER NOT NULL,     -- Start frame in source
    end_frame INTEGER NOT NULL,       -- End frame in source
    clip_index INTEGER NOT NULL,      -- Order in final video (0, 1, 2...)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (final_video_id) REFERENCES final_videos(id) ON DELETE CASCADE
)
```

### Data Flow

```
Final Video Export
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  For each working_clip in project:                      │
│    - Get raw_clip.filename (source_path)                │
│    - Get segments_data.trimRange (start/end frames)     │
│    - Insert into before_after_tracks                    │
└─────────────────────────────────────────────────────────┘
       │
       ▼
Before/After Export Request
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  1. Query before_after_tracks for final_video_id        │
│  2. For each source clip:                               │
│     - Extract trimmed segment from source               │
│     - Scale to fit 9x16, add "Before" text              │
│  3. Add final video with "After" text                   │
│  4. Concatenate: [before1, before2, ..., final_after]   │
│  5. Return comparison video                             │
└─────────────────────────────────────────────────────────┘
```

### Video Composition

```
┌─────────────────┐
│     Before      │  ← Text overlay (top centered)
│                 │
│  ┌───────────┐  │
│  │  Source   │  │  ← Scaled to fit, letterboxed
│  │   Clip    │  │
│  └───────────┘  │
│                 │
│    1080x1920    │  ← 9x16 canvas
└─────────────────┘

┌─────────────────┐
│     After       │  ← Text overlay (top centered)
│                 │
│  ┌───────────┐  │
│  │  Final    │  │  ← Full frame (already 9x16)
│  │  Video    │  │
│  └───────────┘  │
│                 │
│    1080x1920    │
└─────────────────┘
```

---

## API Design

### Endpoint: Generate Before/After Comparison

```
POST /api/export/before-after/{final_video_id}
```

Response: Video file download (MP4)

### Endpoint: Check if comparison available

```
GET /api/export/before-after/{final_video_id}/status
```

Response:
```json
{
  "available": true,
  "clip_count": 3,
  "final_video_exists": true
}
```

---

## Files to Create/Modify

### Create
- `src/backend/app/routers/export/before_after.py` - New router for comparison video

### Modify
- `src/backend/app/database.py` - Add `before_after_tracks` table
- `src/backend/app/routers/export/overlay.py` - Track sources on final export
- `src/frontend/src/pages/DownloadsPage.jsx` - Add export button

---

## Implementation Order

1. **Phase 1**: Database
   - Add table schema to database.py
   - Add migration for existing databases

2. **Phase 2**: Tracking
   - Modify final video export to populate tracking table
   - Store source paths and frame ranges

3. **Phase 3**: Video Generation
   - Create before_after.py router
   - Implement FFmpeg composition with text overlays
   - Handle scaling for non-9x16 sources

4. **Phase 4**: UI
   - Add button to gallery/downloads page
   - Wire up to API endpoint
