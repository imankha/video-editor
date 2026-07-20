# T5653: Client assemble/trim/concat + resumable dual-asset upload

**Status:** TODO
**Impact:** 7
**Complexity:** 8
**Created:** 2026-07-20
**Epic:** [Multi-File Ingest & Prep](EPIC.md) (task 3/7)

## Epic Context
See [EPIC.md](EPIC.md) + study sections 0, 4-8. The ingest engine that makes 50-200x real. Hardest
task in the epic (browser ffmpeg on multi-GB inputs, resumable upload).

## Problem
Raw footage (62GB) can't be uploaded, and must be assembled + trimmed first. Do it client-side so
only the trimmed result leaves the machine.

## Solution
- **Assemble**: auto-order files by filename timestamp (`DJI_YYYYMMDDHHMMSS_NNNN`), user drag to
  reorder -> one virtual timeline.
- **Trim**: multiple keep-ranges on the combined timeline (manual - drop warm-up/halftime/dead time).
- **Concat + trim by STREAM-COPY** (no re-encode -> fast, lossless, keeps 8K). Libraries:
  **ffmpeg.wasm** (`@ffmpeg/ffmpeg`) or **mp4box.js + WebCodecs**. Do this for BOTH the master (MP4)
  and the proxy (shipped `.LRF`, else generate); keep them frame-aligned so conform offsets hold.
- **Resumable dual-asset upload** (chunked/background) -> write both refs (T5651). Validate the
  browser ceiling on multi-GB / 62GB inputs on the real test files; if a browser can't hold it, fall
  back to a desktop companion or resumable raw-master upload + server trim (documented alternative).

## Context
### Relevant Files
- New client ingest module (ffmpeg.wasm/WebCodecs); Prep container from T5652.
- Upload path: `src/backend/app/routers/games_upload.py` + resumable/chunked upload endpoint (new or
  extend). Reuse T2830-style game reference helpers if applicable.
- Test footage: `formal annotations/ECNL Test - DJI Action 6` (4x 8K HEVC + `.LRF`).

### Related Tasks
- Depends on T5651 (asset refs) + T5652 (Prep shell). Blocks T5654/T5655 (they consume the pair).

### Technical Notes
- Stream-copy requires matching codec/params across concatenated files (all 4 DJI masters match:
  HEVC 7680x4320 29.97). Cross-codec folders need a re-encode branch (flag it, don't silently fail).
- Prove it on the real 62GB folder before committing to a browser-only path (study open questions).

## Acceptance Criteria
- [ ] User assembles + multi-range trims a folder; client produces a trimmed MP4 + aligned proxy.
- [ ] Both upload resumably and land as a linked pair (T5651).
- [ ] Measured reduction on the real DJI folder (<1GB relevant), documented.
- [ ] Cross-codec / browser-ceiling fallbacks handled explicitly, not silently.
