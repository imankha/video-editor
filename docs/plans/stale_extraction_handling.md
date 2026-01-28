# Stale Extraction Handling Plan

## Problem

When a clip's annotation changes (start/end time) after it has been framed:
1. The extracted video file is stale - it was cut at the old times
2. The framing edits (crop keyframes, trim, speed) were based on the old video's timeline
3. Those edits may no longer be valid

## Solution: Option B - Flag as Stale, Let User Decide

### Database Changes

Add to `raw_clips` table:
```sql
extracted_at TIMESTAMP           -- when filename was created
annotation_modified_at TIMESTAMP -- when start/end last changed
```

### Backend Changes

1. **update_raw_clip** (`clips.py`):
   - When `start_time` or `end_time` changes, set `annotation_modified_at = CURRENT_TIMESTAMP`
   - Do NOT clear `filename` - let user decide

2. **ProjectListItem** (`projects.py`):
   - Add field: `has_stale_extractions: bool`
   - True if any clip has `annotation_modified_at > extracted_at`

3. **WorkingClipResponse** (`projects.py`):
   - Add field: `is_extraction_stale: bool`
   - True if `annotation_modified_at > extracted_at`

4. **New endpoint**: `POST /api/clips/{clip_id}/re-extract`
   - Triggers re-extraction for a specific clip
   - Clears `filename` and `crop_data`, `segments_data`, `timing_data`
   - Enqueues to modal_queue

### Frontend Changes

1. **ClipSelectorSidebar**:
   - Show orange warning icon on clips where `is_extraction_stale = true`
   - Tooltip: "Annotation changed since extraction"
   - Click shows options:
     - "Keep current extraction" (dismiss warning)
     - "Re-extract (clears framing edits)"

2. **ProjectCard**:
   - Show warning indicator if `has_stale_extractions = true`
   - Tooltip: "Some clips have changed since extraction"

### User Flow

1. User annotates clip (creates extraction)
2. User frames the clip (adds crop/trim edits)
3. User goes back to annotation and changes start/end time
4. User returns to framing mode
5. **NEW**: Warning icon appears on clip
6. User clicks icon and chooses:
   - "Keep current" - continues with old extraction
   - "Re-extract" - triggers new extraction, clears framing edits

### Future Enhancement

Option C (Smart Remap):
- Calculate time offset between old and new annotation
- Shift crop keyframes and trim ranges by offset
- Only works for simple time shifts, not duration changes
