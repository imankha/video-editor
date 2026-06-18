# T2580: Faststart Validation on Upload

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-06-02

## Problem

Non-faststart MP4 files (moov atom at end of file) break direct R2 streaming. The browser must download the entire file before it can parse the moov atom and start playback. With T3250's presigned URL approach (no proxy), the bounded-range proxy's moov-head/tail windows no longer protect against this.

All existing game videos are faststart (T1450 migration), but new uploads through any path (game upload, Trace import, manual R2 upload) could introduce non-faststart files with no detection or warning.

## Solution

Validate faststart at upload/ingest time. After FFprobe metadata extraction, check whether the moov atom is at the start of the file. Store the result and reject or warn on non-faststart files.

## Implementation

### 1. Detection

After FFprobe extracts video metadata during game upload, check moov atom position:

```python
# During metadata extraction (already reads the file)
# FFprobe can report atom positions:
ffprobe -v quiet -print_format json -show_format -show_entries format_tags=major_brand <file>

# Or parse the first 32 bytes for ftyp + moov box headers
# If first box is ftyp and second is moov, file is faststart
```

Lightweight alternative: read first 32 bytes of the uploaded file. Parse MP4 box headers:
- Bytes 0-3: box size, bytes 4-7: box type (should be `ftyp`)
- After ftyp box: next box type should be `moov` (faststart) not `mdat`

### 2. Store Result

Add `is_faststart` boolean to `game_videos` table (nullable, NULL = unknown/legacy).

### 3. Action on Detection

- **Faststart = true**: proceed normally
- **Faststart = false**: log warning, attempt auto-remux with `ffmpeg -movflags +faststart` (same as T1450 migration did), then re-upload. If remux fails, store the file but mark it and surface a warning in the admin panel.

### 4. Surface in API

Include `is_faststart` in game video metadata responses so the frontend can detect and warn (or the playback-url endpoints can include it for monitoring).

## Acceptance Criteria

- [ ] New game video uploads are checked for faststart
- [ ] Non-faststart uploads are auto-remuxed to faststart
- [ ] `is_faststart` flag stored in game_videos table
- [ ] Warning logged for any non-faststart file that can't be remuxed
- [ ] Existing NULL values treated as "unknown/assumed faststart" (T1450 migrated all)

## Notes

- **T3760 spike confirmation (2026-06-18):** the prod game video for clip 48 (`1c8a48db…b404.mp4`,
  3.05 GB) was probed directly and is faststart (`ftyp` 0–31, `moov` 32–700421, then `mdat`). This
  corroborates that T1450 held and that the framing deep-offset reads are clip seeks, not moov hunts.
  T2580 remains valid as a **regression guard** for new upload paths — it was never the fix for the
  T3760 "slow load" (which didn't exist). See `../T3760-decision.md`.
- Spawned from T3250 design review: decided to skip runtime faststart probing (adds 50-150ms latency to every playback-url request) in favor of upload-time validation
- T1450 already migrated all existing game videos to faststart
- This task prevents regression: new upload paths must maintain the faststart invariant
