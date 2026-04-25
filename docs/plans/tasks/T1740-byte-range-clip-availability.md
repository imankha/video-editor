# T1740: Byte-Range Clip Availability

## Problem

When a game is uploading, reels that reference clips from that game are completely blocked until the entire upload finishes. A 3GB game upload can take 10+ minutes, but a 10-second clip at minute 5 of the video might only need the first ~100MB of bytes to be available.

Currently, the full-game readiness check (T1740 prerequisite) blocks the entire reel card with "Waiting for upload" until the game status flips from `pending` to `ready`. This is correct but overly conservative — clips whose byte range has already been uploaded to R2 could be playable sooner.

## Goal

Make a reel playable as soon as the bytes required for each of its clips have been uploaded to R2, rather than waiting for the entire game upload to complete.

## Current Architecture

### Upload Flow
1. Game created as `status='pending'` via `POST /api/games`
2. Video bytes uploaded to R2 in parts via `PATCH /api/games/upload/{session}/parts`
3. After all parts uploaded, `POST /api/games/{id}/activate` flips status to `ready`
4. Frontend `invalidateGames()` → gamesDataStore refetches → UI updates

### Clip-to-Byte Mapping
- Each clip has `start_time` and `end_time` (seconds into the game video)
- The game video is MP4 with moov atom at the front (faststart)
- Moov atom contains the `stco`/`co64` (chunk offset) and `stts` (time-to-sample) tables
- Given a time range, we can compute the byte range needed from these tables

### Multipart Upload State
- `game_upload_parts` table tracks uploaded parts per session
- Each part has `part_number`, `start_byte`, `end_byte`, `etag`
- Backend knows exactly which byte ranges have been uploaded

## Implementation Approach

### Backend
1. **New endpoint**: `GET /api/games/{id}/byte-availability`
   - Returns: `{ total_bytes, uploaded_bytes, uploaded_ranges: [[start, end], ...] }`
   - Derived from `game_upload_parts` table

2. **New endpoint or enrichment**: `GET /api/clips/playability?clip_ids=1,2,3`
   - For each clip, determine if its byte range is available
   - Parse moov atom from the first uploaded chunk (moov is at head due to faststart)
   - Map clip time range → byte range using `stco` + `stts` tables
   - Check if that byte range is covered by uploaded parts
   - Returns: `{ clip_id: { playable: true/false, bytes_needed: N, bytes_available: N } }`

3. **Moov parsing**: Can use existing `extractVideoMetadataFromUrl` pattern or a lightweight Python MP4 parser (e.g., `construct` or manual parsing of ftyp/moov boxes)

### Frontend
1. **Polling during upload**: While a game is uploading, periodically check clip playability
2. **Reel card state**: Show per-clip availability progress instead of binary blocked/unblocked
3. **Transition**: When all clips in a reel become byte-available, enable the card immediately (don't wait for full game activation)

### Complexity Considerations
- **Moov at head**: Faststart guarantees moov is in the first chunk, so we can parse it early
- **Non-contiguous ranges**: Multipart uploads may not be sequential — need range coverage check
- **Partial MP4 streaming**: The video player needs the moov atom + the clip's byte range. Since moov is at head and R2 supports range requests, this should work with the existing proxy
- **Race conditions**: Upload progress changes while we're checking — use a snapshot approach

## Risks & Open Questions
- How large is the moov atom for a typical 90-min game? If it's >5MB, parsing it per-request could be expensive
- Does the R2 multipart upload guarantee sequential part uploads, or can parts arrive out of order?
- Will the video player work with a partial MP4 file (moov + clip byte range) served via range requests?
- Should we cache the moov parse results, or is it fast enough to do per-request?
- What happens if the clip spans a boundary between uploaded and not-yet-uploaded bytes?

## Prerequisites
- Full-game readiness check must be implemented first (the "Waiting for upload" card state)
- Moov atom is at head (faststart) — already guaranteed by T1380

## Estimate
- **Impact**: 6 — Saves minutes of waiting per upload session
- **Complexity**: 7 — MP4 parsing, byte range coverage logic, polling, race conditions
- **Priority**: P2 — Nice-to-have optimization after full-game blocking works
