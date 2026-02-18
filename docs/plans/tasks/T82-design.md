# T82 Design: Multi-Video Games (First Half / Second Half)

**Status:** APPROVED (with revisions)
**Author:** Architect Agent

## Design Principles

1. **Each half video goes through full BLAKE3 hash + R2 dedup** - same as single-video uploads
2. **Two clean game endpoints** - create game (0-N videos), add videos to game
3. **DRY** - R2 upload mechanics (`prepare-upload`/`finalize-upload`) stay the same; game management is separate
4. **Single-video path unchanged** - multi-video is opt-in via `game_videos` table

## Architecture: Separation of Concerns

**R2 Upload layer** (existing, per-video, unchanged):
- `prepare-upload` → BLAKE3 dedup check against R2 → presigned URLs or "exists"
- Upload parts → bytes go to R2
- `finalize-upload` → complete R2 multipart → return blake3_hash + metadata

**Game Management layer** (new, decoupled from upload):
- `POST /api/games` → create game with 0, 1, or N video references (by blake3_hash)
- `POST /api/games/{game_id}/videos` → add video(s) to existing game

This means `prepare-upload` and `finalize-upload` no longer create games.
Game creation is always through `POST /api/games`.

### New Upload Flow (both single and multi-video)

```
1. For each video file:
   hash(file) → prepare-upload(hash) → [upload if needed] → finalize(hash)
   Result: video is in R2 at games/{hash}.mp4

2. POST /api/games with game details + video hashes
   Result: game record + game_videos rows created
   Returns: game_id, presigned URLs for all videos
```

### New Data Model

```
games table (existing, simplified):
  id, name, blake3_hash (kept for legacy single-video),
  video_duration (total across all videos), video_width, video_height,
  opponent_name, game_date, game_type, tournament_name, ...

game_videos table (NEW):
  id, game_id, blake3_hash, sequence, duration,
  video_width, video_height, video_size,
  UNIQUE(game_id, sequence)
```

Single-video games: `games.blake3_hash` set, no `game_videos` rows (backward compat).
Multi-video games: `games.blake3_hash = NULL`, has `game_videos` rows.

## Implementation Plan

### Phase 1: Database

**File: `src/backend/app/database.py`**
- Add `game_videos` table in schema
- Add migration to create table + index

### Phase 2: Game Management Endpoints

**File: `src/backend/app/routers/games.py`**

**Endpoint 1: `POST /api/games`** - Create game with 0-N videos
```json
Request: {
  "opponent_name": "Eagles",
  "game_date": "2024-03-15",
  "game_type": "home",
  "tournament_name": null,
  "videos": [
    { "blake3_hash": "abc...", "sequence": 1, "duration": 2700.5,
      "width": 1920, "height": 1080, "file_size": 2000000000 }
  ]
}
Response: {
  "game_id": 42,
  "name": "Vs Eagles 3/15",
  "videos": [{ "sequence": 1, "video_url": "https://..." }]
}
```

**Endpoint 2: `POST /api/games/{game_id}/videos`** - Add videos to existing game
```json
Request: {
  "videos": [
    { "blake3_hash": "def...", "sequence": 2, "duration": 2700.5,
      "width": 1920, "height": 1080, "file_size": 2000000000 }
  ]
}
Response: {
  "game_id": 42,
  "videos_added": 1,
  "videos": [
    { "sequence": 1, "video_url": "https://..." },
    { "sequence": 2, "video_url": "https://..." }
  ]
}
```

### Phase 3: Upload Endpoint Changes

**File: `src/backend/app/routers/games_upload.py`**

- `prepare-upload`: Remove game creation from "linked" case. Just return `{ status: "exists", blake3_hash }` when video already in R2. Still return `{ status: "upload_required", ... }` when upload needed.
- `finalize-upload`: Remove game creation. Just complete R2 multipart and return `{ status: "success", blake3_hash, file_size }`.
- Remove `already_owned` status (was game-level concept; now handled by `POST /api/games`).

### Phase 4: Game Read API Changes

**File: `src/backend/app/routers/games.py`**

- `GET /api/games/{game_id}`: Check `game_videos` table. If rows exist, return `videos` array with presigned URLs. Compute `video_duration` as sum.
- `GET /api/games`: Add `video_count` to list response.
- `get_game_video_url()`: Also check `game_videos` for multi-video games.

### Phase 5: Clip Extraction Changes

**File: `src/backend/app/routers/annotate.py`**

```python
def determine_source_video(segments, start_time, end_time):
    """Given absolute timestamps, return which video + relative times."""
    offset = 0
    for seg in segments:
        seg_end = offset + seg['duration']
        if start_time >= offset and start_time < seg_end:
            return {
                'blake3_hash': seg['blake3_hash'],
                'relative_start': start_time - offset,
                'relative_end': min(end_time - offset, seg['duration']),
            }
        offset = seg_end
```

Boundary-spanning clips: truncate at boundary (clip starts in video where `start_time` falls).

### Phase 6: GameDetailsModal

**File: `src/frontend/src/components/GameDetailsModal.jsx`**

- Add "Video per game" / "Video per half" toggle
- When "per half": show 2 file inputs (First Half, Second Half)
- Validation: both files required for "per half" mode
- Submit: pass `{ files: [file1, file2], videoMode: 'per_half' }` or `{ file, videoMode: 'per_game' }`

### Phase 7: Upload Manager

**File: `src/frontend/src/services/uploadManager.js`**

- New `uploadMultiVideoGame(files, onProgress, options)`:
  1. For each file: `hashFile()` → `prepare-upload` → upload parts → `finalize-upload`
  2. After all uploads: `POST /api/games` with hashes + game details
  3. Progress: file 1 = 0-50%, file 2 = 50-100%
  4. Each file goes through full BLAKE3 dedup (identical to single-video path)
- Refactor `uploadGame()` to also use `POST /api/games` for game creation (DRY)

### Phase 8: Upload Store

**File: `src/frontend/src/stores/uploadStore.js`**

- `startUpload` accepts `File | File[]`
- If array: calls `uploadMultiVideoGame`, tracks combined progress
- `activeUpload.isMultiVideo` flag for UI display

### Phase 9: AnnotateContainer

**File: `src/frontend/src/containers/AnnotateContainer.jsx`**

- New state: `gameVideos` (null for single, array for multi), `activeVideoIndex`
- `handleGameVideoSelect`: if multi-video, create blobs for both, set total duration
- `handleLoadGame`: if `gameData.videos` array, store all URLs + compute offsets
- Video switching: single `<video>` element, switch `src` at boundary
- `absoluteCurrentTime`: computed from `activeVideoIndex` offset + raw `currentTime`
- `multiVideoSeek`: finds correct video for absolute time, switches if needed

## Files to Modify

| File | Change |
|------|--------|
| `src/backend/app/database.py` | Add `game_videos` table + migration |
| `src/backend/app/routers/games_upload.py` | Remove game creation from prepare/finalize |
| `src/backend/app/routers/games.py` | Add POST /api/games, POST /api/games/{id}/videos, update GET endpoints |
| `src/backend/app/routers/annotate.py` | Clip extraction resolves source video |
| `src/frontend/src/components/GameDetailsModal.jsx` | Video mode toggle, dual dropzones |
| `src/frontend/src/services/uploadManager.js` | `uploadMultiVideoGame()`, refactor `uploadGame()` |
| `src/frontend/src/stores/uploadStore.js` | Multi-file support |
| `src/frontend/src/containers/AnnotateContainer.jsx` | Video switching, absolute time |
