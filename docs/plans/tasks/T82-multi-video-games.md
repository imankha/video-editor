# T82: Multi-Video Games (First Half / Second Half)

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-02-17
**Updated:** 2026-02-17

## Overview

Implement support for games that span two video files (first half / second half). This is a **rare case** - the default single-video upload path should remain unchanged. When a user does upload two halves, they should merge into a seamless experience that behaves like a single video.

## Key Requirements

1. **Minimize changes to default path** - Single-video uploads (99% of cases) should work exactly as before
2. **Continuous timeline** - If half 1 is 45 minutes and half 2 is 45 minutes, the timeline shows 0:00-90:00. Clips from half 2 show timestamps like 67:30, not "2H 22:30"
3. **User opts-in at upload start** - GameDetailsModal offers choice: "Video per game" (default) vs "Video per half"
4. **Seamless after upload** - Once both halves are uploaded, Annotate mode should feel like a single 90-minute video (auto-advances from half 1 to half 2)
5. **Halves only for now** - UI only supports exactly 2 segments. Database schema supports N segments for future flexibility.

## Current Architecture

### Database
- `games` table has `blake3_hash` pointing to a single video in R2 at `games/{hash}.mp4`
- `raw_clips` table references `game_id` with `start_time` and `end_time` in seconds

### Upload Flow
- `GameDetailsModal` collects opponent, date, game type before upload
- `uploadManager.js` hashes file, calls `prepare-upload`, uploads to R2, calls `finalize-upload`
- Backend creates game record with single `blake3_hash`

### Annotate Mode
- `AnnotateContainer.jsx` loads game and creates blob URL for video
- `AnnotateModeView.jsx` renders video player and timeline
- Clips are created with timestamps relative to video start

## Proposed Schema Change

```sql
-- New table for game videos (1:many relationship, supports N videos)
CREATE TABLE game_videos (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    blake3_hash TEXT NOT NULL,
    sequence INTEGER NOT NULL,  -- 1, 2, 3... (ordering only, no labels)
    duration REAL,  -- Duration in seconds (for timeline offset calculation)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, sequence)
);

-- games.blake3_hash becomes nullable (legacy single-video games keep it)
-- New games with multiple videos use game_videos table instead
-- Single-video games can EITHER use games.blake3_hash OR have one game_videos row
```

## Implementation Steps

### 1. GameDetailsModal Changes
- Add toggle/radio: "Video per game" (default) vs "Video per half"
- When "Video per half" selected, show two dropzones labeled "First Half" and "Second Half"
- Both files must be selected before upload can proceed
- Each file gets hashed and uploaded separately
- Single `finalize` call creates game + both game_videos records (sequence 1 and 2)

### 2. Backend Changes
- New `game_videos` table with migration
- Update `prepare-upload` and `finalize-upload` to support multi-video games
- Add parameter to indicate number of expected videos and current sequence
- `list_games` and `get_game` return video info:
  - Single-video: return `blake3_hash` as before (backwards compatible)
  - Multi-video: return array of `{ sequence, blake3_hash, duration }` ordered by sequence

### 3. Annotate Mode Changes
- If game has multiple videos, load both and stitch them:
  - Option A: Create two video elements, switch between them at boundary
  - Option B: Use MediaSource API to create seamless stream
  - Option C: Simple approach - load half 1, when it ends load half 2 with timeline offset
- Timeline must show continuous time (half 2 clips offset by half 1 duration)
- Seeking past half 1 duration should switch to half 2 video
- Clips stored with absolute timeline times; determine source video from timestamp + durations

### 4. Clip Storage & Extraction
- Clips continue to store `start_time` and `end_time` as absolute timeline seconds
- On extraction, backend calculates which video file(s) the clip spans:
  - If clip is entirely within one segment, extract from that file
  - Edge case: clip spans boundary - extract from both and concatenate (rare, handle gracefully)
- Add `video_sequence` to raw_clips table to cache which video the clip came from (optimization)

## Files to Modify

### Backend
- `src/backend/app/database.py` - Add game_videos table, migration
- `src/backend/app/routers/games_upload.py` - Support multi-video upload
- `src/backend/app/routers/games.py` - Return video segment info

### Frontend
- `src/frontend/src/components/GameDetailsModal.jsx` - "Video per game" vs "Video per half" UI
- `src/frontend/src/services/uploadManager.js` - Handle uploading multiple files sequentially
- `src/frontend/src/containers/AnnotateContainer.jsx` - Load/stitch multiple videos
- `src/frontend/src/modes/annotate/AnnotateModeView.jsx` - Continuous timeline across videos

## Acceptance Criteria

- [ ] Single-video upload ("Video per game") works exactly as before (no regression)
- [ ] GameDetailsModal has "Video per half" option with dual dropzones
- [ ] Both halves upload with progress indication for each
- [ ] Annotate mode shows continuous timeline (0:00 to ~90:00)
- [ ] Video playback seamlessly transitions from half 1 to half 2
- [ ] Seeking works across the boundary (seek to 50:00 loads half 2)
- [ ] Clips created in half 2 have correct absolute timestamps
- [ ] Clip extraction works for clips in either half
- [ ] Deleting a game deletes all video references (actual R2 files stay for dedup)

## What NOT to Do

- Don't add complexity to the single-video path ("Video per game" should be unchanged)
- Don't add labels to the database - just use sequence numbers
- Don't build UI for more than 2 segments (DB supports it, UI doesn't need to yet)
- Don't add segment navigation UI (tabs, dropdowns) - it should feel like one video
- Don't change how clips display their timestamps to users

## Testing

1. Upload a single-video game - verify no changes to behavior
2. Upload a two-half game - verify both files upload with progress
3. Annotate the two-half game - verify timeline is continuous (0:00 to ~90:00)
4. Seek past the half 1 boundary - verify half 2 loads correctly
5. Create clips in both halves - verify timestamps are absolute
6. Extract clips from both halves - verify correct video file is used
7. Re-upload same halves - verify deduplication still works per-video
