# T1220: Modal Functions Should Use Range Requests for R2 Videos

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

Modal GPU functions download the **entire source video** from R2 before processing, even when only a few seconds of footage are needed. For a 3GB, 90-minute game video where we need a 10-second clip, this wastes:

- **Bandwidth**: ~3GB downloaded per clip instead of ~50MB
- **Time**: Minutes of download time before processing can start
- **Modal compute cost**: GPU container sits idle waiting for download

### Current Architecture

1. Backend passes R2 object keys to Modal (`source_keys` list)
2. Modal function calls `r2.download_file(bucket, key, local_path)` — full download
3. FFmpeg uses post-input seek (`-ss` AFTER `-i`) on the local file — reads from beginning, seeks in memory
4. For multi-clip: each source video downloaded once, but still the entire file

### Where This Happens

- `video_processing.py` `process_clips_ai()`: downloads each source video completely via `r2.download_file()`
- FFmpeg commands use `-ss` after `-i` (post-input seek), meaning FFmpeg reads the full file up to the seek point

## Solution

### Option A: Presigned URL + FFmpeg Pre-Input Seek (Preferred)

Pass presigned R2 URLs instead of object keys. Use FFmpeg's **pre-input seek** (`-ss` BEFORE `-i`):

```bash
ffmpeg -ss 120.5 -to 130.5 -i "https://r2.example.com/video.mp4?presigned..." -c:v copy output.mp4
```

When `-ss` comes before `-i` on an HTTP source, FFmpeg uses HTTP range requests to seek directly to the target timestamp. This downloads only the bytes needed for the clip range.

**Requirements:**
- Backend generates presigned URLs with sufficient expiry for Modal processing time
- R2 must support range requests on presigned URLs (it does — standard S3 behavior)
- Move `-ss`/`-to` before `-i` in all FFmpeg command builders

### Option B: Partial Download via boto3 Range

Download only the byte range needed using boto3's `get_object()` with `Range` header:

```python
response = r2.get_object(Bucket=bucket, Key=key, Range=f'bytes={start}-{end}')
```

This requires knowing the byte offset for a given timestamp, which means parsing the moov atom first (small initial download).

### Recommendation

**Option A** is simpler — FFmpeg handles the range request logic internally. We just need to:
1. Generate presigned URLs on the backend
2. Pass URLs to Modal instead of keys
3. Move `-ss` before `-i` in FFmpeg commands

## Context

### Relevant Files
- `src/backend/app/modal_functions/video_processing.py` — `process_clips_ai()` downloads full videos (~line 2947-2962), FFmpeg commands use post-input seek
- `src/backend/app/services/modal_client.py` — Passes `source_keys` to Modal (~line 823-833); should pass presigned URLs instead
- `src/backend/app/storage.py` — `generate_presigned_url()` already exists for frontend; reuse for Modal

### Related Tasks
- T1210 (Clip-Scoped Video Loading) — same problem on the frontend/browser side
- T1130 (Multi-Clip Stream Not Download) — DONE, fixed exports to use presigned URL range requests; this task applies the same pattern to Modal GPU processing
- T1120 (Framing Video Cold Cache) — R2 edge caching; Modal functions bypass the edge entirely

### Technical Notes
- FFmpeg pre-input seek (`-ss` before `-i`) on HTTP sources uses range requests automatically — this is well-documented FFmpeg behavior
- Presigned URL expiry must account for Modal cold start + processing time (suggest 30 min)
- Multi-clip processing may benefit from a single download if many clips come from the same video — but with range requests, the overhead is low enough that per-clip fetching is fine
- Audio extraction also needs the source video — ensure audio seek range includes a small buffer

## Implementation

### Steps
1. [ ] Generate presigned R2 URLs on backend before calling Modal
2. [ ] Pass URLs to Modal functions instead of R2 keys
3. [ ] Replace `r2.download_file()` with direct URL usage in FFmpeg commands
4. [ ] Move `-ss`/`-to` before `-i` in all FFmpeg command builders (pre-input seek)
5. [ ] Handle audio extraction — ensure presigned URL is used for audio source too
6. [ ] For multi-clip: pass one presigned URL per source video, with per-clip timestamps
7. [ ] Test with large game videos (>1GB) and measure download time reduction
8. [ ] Remove boto3 R2 credentials from Modal function environment (no longer needed for video access)

## Acceptance Criteria

- [ ] Modal functions never download full source videos
- [ ] FFmpeg uses pre-input seek with HTTP range requests on presigned URLs
- [ ] Processing start time reduced by >50% for large videos with short clips
- [ ] Multi-clip processing works correctly with per-clip range fetching
- [ ] No regression in output quality (frame-accurate seeking)
