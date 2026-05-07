# T2625: Move Video Ingest to Modal

## Problem

Game imports (Veo + Trace) currently run all heavy work on Fly.io:
- **Trace**: ffmpeg remux (17+ min on staging's shared CPU) + blake3 hash + R2 multipart upload
- **Veo**: blake3 hash on 1-5GB stream + R2 multipart upload + R2 CopyObject (2.5-7.8 min for 3GB)

Fly.io servers are designed for lightweight API serving. Running 17-minute ffmpeg processes or hashing multi-GB files degrades the API for all users and risks OOM kills. Staging testing confirmed this — Trace import took 20+ minutes and saturated the shared CPU.

Additionally, both paths upload to a temp R2 key (`games/_import_{id}.mp4`), then do a server-side R2 CopyObject to the final key (`games/{hash}.mp4`) because the blake3 hash isn't known until all bytes are read. R2 CopyObject is extremely slow (469 seconds for 3GB on staging).

## Solution

Move all video I/O to a single unified Modal function. Fly.io only orchestrates: URL resolution, credit checks, DB writes. Modal handles: download, optional ffmpeg remux, blake3 hash, R2 upload.

**Key insight**: On Modal, we download to local disk first, compute blake3, then upload directly to `games/{hash}.mp4`. This eliminates the temp key and the slow R2 CopyObject entirely.

## Scope

**Stack Layers:** Backend + Modal
**Files Affected:** ~5 files
**LOC Estimate:** ~200 lines
**Test Scope:** Backend (staging deploy test)

## Implementation

### Part 1: Modal function — `ingest_video_to_r2()`

**File: `app/modal_functions/video_processing.py`**

New lightweight image (no GPU, no torch):
```python
ingest_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("boto3", "blake3")
)
```

New function `ingest_video_to_r2()`:
- **No GPU** — CPU-only, 2 vCPUs, 4GB memory
- `source_type`: `"direct"` (Veo — download URL as-is) or `"hls"` (Trace — ffmpeg remux)
- Process:
  1. Download to temp dir:
     - `direct`: `httpx` stream to local file
     - `hls`: `ffmpeg -i <m3u8> -c copy -movflags +faststart output.mp4`
  2. Compute blake3 hash of local file (read in 100MB chunks)
  3. Check R2 for dedup: if `games/{hash}.mp4` exists, skip upload
  4. Multipart upload to `games/{hash}.mp4` directly (no temp key, no copy)
  5. Return `{blake3_hash, file_size, status}`
- Yields progress updates (same generator pattern as overlay/framing)
- Timeout: 3600s (1 hour — covers large HLS streams)
- Secrets: `r2-credentials`

### Part 2: Client wrapper — `call_modal_ingest()`

**File: `app/services/modal_client.py`**

New wrapper following existing pattern:
```python
async def call_modal_ingest(
    source_url: str,
    source_type: str,  # "direct" | "hls"
    progress_callback=None,
) -> dict:
```

- When `MODAL_ENABLED=false`: local fallback in `local_processors.py`
- When `MODAL_ENABLED=true`: calls Modal `ingest_video_to_r2.remote_gen()`
- Returns `{"status": "success", "blake3_hash": "...", "file_size": int}` or error

### Part 3: Local fallback — `local_ingest()`

**File: `app/services/local_processors.py`**

Local simulation for dev (same interface as Modal function):
1. `direct`: stream URL to temp file via httpx
2. `hls`: run local ffmpeg to remux
3. Compute blake3 hash
4. Upload to R2 via existing `upload_file_to_r2()` or similar
5. Return same `{blake3_hash, file_size, status}` dict

This is essentially what the current code does, refactored into the standard local-fallback pattern.

### Part 4: Refactor `game_import.py`

**File: `app/services/game_import.py`**

Simplify `_import_veo()`:
```
Before: resolve → credits → stream_to_r2 (Fly.io) → R2 copy → create game
After:  resolve → credits → call_modal_ingest(url, "direct") → create game
```

Simplify `_import_trace()` / `_process_half()`:
```
Before: resolve → credits → [ffmpeg remux (Fly.io) → upload_file_to_r2 (Fly.io) → R2 copy] per half → create game
After:  resolve → credits → [call_modal_ingest(m3u8_url, "hls")] per half → create game
```

Remove from game_import.py:
- `_r2_copy_and_delete()` — no longer needed (no temp keys)
- All `r2_head_object_global` / `r2_delete_object_global` dedup logic — moved into Modal function
- All `asyncio.to_thread` wrappers for upload/hash — Modal handles it

### Part 5: Clean up dead code

After refactor, these functions in `veo_import.py` and `trace_import.py` become unused by the import path:
- `veo_import.stream_to_r2()` — was the Fly.io streaming upload
- `trace_import.upload_file_to_r2()` — was the Fly.io file upload
- `trace_import.remux_hls_to_mp4()` — was the Fly.io ffmpeg call

Keep these functions (they're still useful for testing or future use), but `game_import.py` no longer calls them.

## Architecture After

```
Fly.io (lightweight orchestration):
  POST /api/games/import-url
    → detect_platform(url)
    → resolve_veo_download_url(url)  OR  resolve_trace_videos(url)
    → _check_and_deduct_credits()
    → call_modal_ingest(url, "direct"|"hls")   ← Modal does all heavy work
    → _create_game_record(blake3_hash, file_size)

Modal (heavy I/O):
  ingest_video_to_r2(source_url, source_type)
    → download / ffmpeg remux  → local temp file
    → blake3 hash              → compute on local file
    → multipart upload to R2   → direct to games/{hash}.mp4
    → return {blake3_hash, file_size}
```

## What This Eliminates

| Before (Fly.io) | After (Modal) | Impact |
|---|---|---|
| ffmpeg remux on Fly.io (17+ min) | ffmpeg on Modal (2-4 CPU, fast) | Fly.io stays responsive |
| blake3 hash on Fly.io (CPU-bound) | blake3 on Modal | No CPU load on API server |
| R2 CopyObject (2.5-7.8 min) | Direct upload to final key | Eliminates slowest step entirely |
| 100MB multipart uploads from Fly.io | Uploads from Modal (datacenter) | Faster, no memory pressure |

## Risks

- **Modal cold start**: ~10-30s for lightweight image. Negligible in a multi-minute import.
- **Modal container disk space**: Need enough for temp file (max ~5GB). Modal containers have 10GB+ by default.
- **httpx in Modal image**: Need to add httpx to `ingest_image` pip_install for direct downloads. Or use urllib3/requests (already available via boto3 deps).
- **Progress visibility**: Modal yields progress, but granularity changes. Currently Veo shows byte-level progress during stream. Modal will show phase-level progress (downloading → hashing → uploading). This is fine since the UI (T2630) isn't built yet.
- **Dedup race condition**: Two concurrent imports of the same video could both upload. Low risk — dedup check happens before upload, and R2 overwrites are idempotent (same content, same key).
