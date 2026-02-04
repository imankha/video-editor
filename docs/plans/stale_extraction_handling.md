# Stale Extraction Handling Plan

## Status: IMPLEMENTED (2026-02-04)

This plan has been implemented with a version-based approach instead of the originally proposed timestamp approach.

## Problem

When a clip's annotation changes (start/end time) after it has been framed:
1. The extracted video file is stale - it was cut at the old times
2. The framing edits (crop keyframes, trim, speed) were based on the old video's timeline
3. Those edits may no longer be valid

## Implemented Solution: Version-Based Tracking

### Database Changes

Added to `raw_clips` table:
```sql
boundaries_version INTEGER DEFAULT 1    -- increments when start_time/end_time changes
boundaries_updated_at TIMESTAMP         -- when boundaries last changed
```

Added to `working_clips` table:
```sql
raw_clip_version INTEGER                -- snapshot of boundaries_version at import time
```

### Backend Changes

1. **update_raw_clip** (`clips.py`):
   - When `start_time` or `end_time` changes, increment `boundaries_version`
   - Set `boundaries_updated_at = datetime('now')`
   - Do NOT trigger extraction - only track the version change

2. **New endpoint**: `GET /api/projects/{id}/outdated-clips`
   - Compares `raw_clip.boundaries_version` vs `working_clip.raw_clip_version`
   - Returns list of clips where boundaries have changed since import
   - Called when entering Framing mode

3. **New endpoint**: `POST /api/projects/{id}/refresh-outdated-clips`
   - Clears framing data (crop_data, timing_data, segments_data)
   - Updates `raw_clip_version` to match current `boundaries_version`
   - Clears `filename` to mark for re-extraction
   - Triggers extraction in background

### Frontend Changes

1. **FramingScreen**:
   - Calls `/outdated-clips` on load
   - Shows popup if any clips are outdated
   - Popup lists outdated clips with options:
     - "Use Latest Clip" → calls `/refresh-outdated-clips`
     - "Keep Original" → dismisses popup, uses original extraction

### User Flow

1. User annotates clip (creates extraction via project creation)
2. User frames the clip (adds crop/trim edits)
3. User goes back to annotation and changes start/end time
4. `boundaries_version` increments on the raw_clip
5. User returns to framing mode
6. **Popup appears**: "1 clip has been modified since import"
7. User clicks:
   - "Use Latest Clip" → triggers re-extraction, clears framing edits
   - "Keep Original" → continues with old extraction and edits

### Key Design Decisions

1. **Version-based, not timestamp-based**: Simpler comparison, atomic increment
2. **Extraction on project creation, not on annotation save**: Avoids unnecessary extractions
3. **User choice at Framing entry**: Non-disruptive, user controls when to update
4. **Framing edits are cleared on re-import**: No attempt at smart remapping (too error-prone)

### Future Enhancement

Option C (Smart Remap) was considered but not implemented:
- Calculate time offset between old and new annotation
- Shift crop keyframes and trim ranges by offset
- Only works for simple time shifts, not duration changes
- Deemed too complex for initial implementation
