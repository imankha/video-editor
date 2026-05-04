# T2450: Auto-Export FFmpeg Presigned URL Instead of Full Download

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-05-04
**Updated:** 2026-05-04

## Problem

`auto_export.py` downloads the entire game video (3GB+) from R2 to local disk before running FFmpeg to extract short clip segments. A 3GB download over range requests takes 10+ minutes on Fly.io, blocking the sweep scheduler and delaying recap/brilliant clip generation.

FFmpeg natively supports HTTP URLs with seeking. Since we already have presigned R2 URLs, we can pass them directly to `ffmpeg.input()` and let FFmpeg range-request only the bytes it needs.

## Solution

Replace `download_from_r2_global()` calls with presigned R2 URLs passed directly to FFmpeg. This was already done for Modal GPU processing in T1220 — apply the same pattern to auto-export.

### Key details

- `_export_brilliant_clip` uses `c="copy"` (stream copy) — FFmpeg only needs a few keyframe-aligned reads. Should drop from minutes to seconds.
- `_generate_recap` re-encodes to 480p but still only needs clip time ranges, not the full file.
- Both functions currently download the full video per hash. For recap, if multiple clips share a hash, the video is downloaded once — with presigned URLs, no download at all.

## Context

### Relevant Files
- `src/backend/app/services/auto_export.py` — `_export_brilliant_clip` (line 141) and `_generate_recap` (line 200) both call `download_from_r2_global`
- `src/backend/app/storage.py` — `generate_presigned_url_global()` already exists for generating presigned R2 URLs

### Related Tasks
- T1220 (Modal Range Requests) — DONE. Same pattern: replaced full download with presigned URL + FFmpeg pre-input seek for Modal GPU. Copy that approach.
- T1583 (Auto-Export Pipeline) — The auto-export pipeline this task optimizes.

### Technical Notes
- FFmpeg `-ss` before `-i` (pre-input seek) is critical for HTTP sources — it seeks via byte offset rather than decoding from the start.
- Presigned URL expiry: use a generous TTL (e.g., 1 hour) since recap generation processes multiple clips sequentially.
- The `tempfile.TemporaryDirectory` for `source.mp4` download becomes unnecessary for brilliant clips. For recap, the temp dir is still needed for extracted clip files and the concat list.
- Test with a multi-video game to ensure `clips_by_hash` grouping still works with URLs instead of local paths.

## Implementation

### Steps
1. [ ] In `_export_brilliant_clip`: replace `download_from_r2_global` + local path with `generate_presigned_url_global` + URL passed to `ffmpeg.input(url, ss=..., to=...)`
2. [ ] In `_generate_recap`: same replacement per video hash — generate presigned URL, pass to each `ffmpeg.input()` call
3. [ ] Remove the `source_path` download logic from both functions
4. [ ] Test with a real expired game on staging (set expiry to past, restart machine, verify sweep completes in seconds not minutes)

## Acceptance Criteria

- [ ] Auto-export completes in under 60 seconds for a game with 3 clips (was 10+ minutes)
- [ ] Brilliant clips are correctly extracted (stream copy, original resolution)
- [ ] Recap video is correctly generated (480p re-encode, all annotated clips concatenated)
- [ ] No full game video download to local disk during auto-export
- [ ] Sweep scheduler logs show completion without download phase
