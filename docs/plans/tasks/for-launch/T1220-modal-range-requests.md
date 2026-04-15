# T1220: Modal + Local-GPU Processors Should Use Range Requests for R2 Videos

**Status:** DONE
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-08
**Updated:** 2026-04-14

## Precedent (pattern already proven on non-Modal paths)

The presigned-URL + FFmpeg range-seek pattern this task proposes is **already in production** for every code path except the Modal GPU image:

- **f1cb8d8** (T1130 DONE) — multi-clip exports use presigned URLs instead of downloading full game videos.
- **63cc3c8** — local framing processors (`local_framing`, `local_framing_mock`) extract only the clip range via presigned URL + FFmpeg, matching the multi-clip pattern.
- **aa9dfa5 / fb11773** (T1500 DONE) — `app/services/video_probe.py` does boto3 byte-range fetch (1 MB head + 512 KB tail) + ffprobe-from-stdin for dimension capture at upload time. Different mechanism (boto3 range vs. FFmpeg pre-input seek) and not reusable inside the Modal image, but it's a third production data point that range-based R2 access is the right default.

Helpers exist: `src/backend/app/storage.py :: generate_presigned_url()` is already used by the frontend and non-Modal export paths. This task is a port, not a rewrite.

## Problem

Modal GPU functions still download the **entire source video** from R2 before processing, even when only a few seconds of footage are needed. For a 3GB, 90-minute game video where we need a 10-second clip, this wastes:

- **Bandwidth**: ~3GB downloaded per clip instead of ~50MB
- **Time**: Minutes of download time before processing can start
- **Modal compute cost**: GPU container sits idle waiting for download

### Current Architecture

1. Backend passes R2 object keys to Modal (`source_keys` list)
2. Modal function calls `r2.download_file(bucket, key, local_path)` — full download
3. FFmpeg uses post-input seek (`-ss` AFTER `-i`) on the local file — reads from beginning, seeks in memory
4. For multi-clip: each source video downloaded once, but still the entire file

### Where This Happens

`src/backend/app/modal_functions/video_processing.py` has ~15 call sites still using `r2.download_file(bucket, full_input_key, input_path)` (full-file download) with post-input `-ss` after `-i`. Verified 2026-04-14:

- Lines 223, 597, 723, 992, 1393, 1622, 1797, 1893, 2094, 2508, 2520, 2746, 2962 — `r2.download_file()` calls
- `-ss` placement is post-input across all FFmpeg commands in this file

Every non-Modal **export** path has already migrated. The **local GPU substitutes** (used in dev to stand in for Modal) are partially migrated:

- `src/backend/app/services/local_processors.py :: call_local_overlay` (line 171) — still does a full `download_from_r2` for overlay rendering. Not migrated.
- `call_local_framing` (line 325) and `call_local_framing_mock` (line 531) — presigned-URL path landed in 63cc3c8 but retain a full-download fallback branch. Audit whether the fallback is still reachable; if yes, migrate it too, if no, delete it.

These paths run in dev and any environment where Modal is disabled; leaving them on full-download makes the dev loop wasteful and means the two code paths diverge in performance characteristics.

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
9. [ ] Migrate `call_local_overlay` in `local_processors.py` to presigned URL + pre-input seek
10. [ ] Audit and remove (or migrate) full-download fallbacks at `local_processors.py:325` and `:531`

## Acceptance Criteria

- [ ] Modal functions never download full source videos
- [ ] FFmpeg uses pre-input seek with HTTP range requests on presigned URLs
- [ ] Processing start time reduced by >50% for large videos with short clips
- [ ] Multi-clip processing works correctly with per-clip range fetching
- [ ] No regression in output quality (frame-accurate seeking)
