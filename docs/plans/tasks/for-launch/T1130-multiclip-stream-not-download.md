# T1130: Multi-Clip Export Downloads Full Game Videos Instead of Streaming

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

Multi-clip framing export downloads the **entire game video** (3+ GB) from R2 to the Fly.io instance's local disk before extracting each clip range. This takes 6+ minutes per game video on a cold R2 cache and blocks the server (see T1110).

Single-clip framing uses **presigned URLs** — FFmpeg/Modal streams only the needed bytes via range requests. Multi-clip should do the same.

## Current Behavior

**Single-clip** (`framing.py:921`):
```python
source_url = generate_presigned_url_global(f"games/{clip['game_blake3_hash']}.mp4")
# FFmpeg streams from URL with range requests — fast
```

**Multi-clip** (`multi_clip.py:1358`):
```python
download_from_r2_global(game_key, game_video_path)  # Downloads FULL 3GB video
# Then extracts clip range from local file
```

## Solution

Use presigned URLs + FFmpeg `-ss`/`-t` stream copy in multi-clip export, same as single-clip. FFmpeg supports HTTP range requests natively — no need to download the full file.

For each clip in the multi-clip export:
1. Generate presigned URL for the source game video
2. Use `ffmpeg -ss {start} -t {duration} -i {presigned_url} -c copy clip_{i}.mp4`
3. This downloads only the needed bytes (~8s clip from a 90min game = ~5MB vs 3GB)

## Context

### Relevant Files
- `src/backend/app/routers/export/multi_clip.py` — Lines 1336-1360 (full download path)
- `src/backend/app/routers/export/framing.py` — Lines 920-923 (presigned URL streaming path)
- `src/backend/app/storage.py` — `generate_presigned_url_global()`, `download_from_r2_global()`

### Technical Notes
- Multiple clips from the same game currently share a single downloaded file (line 1342-1343)
- With presigned URLs, FFmpeg makes separate range requests per clip — slightly more R2 requests but massively less bandwidth
- Presigned URLs expire after 1 hour (3600s) — should be plenty for a multi-clip export
- This also reduces disk usage on Fly.io (no 3GB temp files)
- Related: T1110 (server blocking) — even with async background tasks, downloading 3GB is wasteful

## Acceptance Criteria

- [ ] Multi-clip export uses presigned URLs + FFmpeg stream copy per clip
- [ ] No full game video downloads to local disk
- [ ] Multi-clip export time comparable to single-clip for same total clip duration
- [ ] Works with both Modal and local processing paths
