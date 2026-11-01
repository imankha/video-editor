# T14170: Downloads are proxied and ffmpeg-stamped on the API machine

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-31
**Updated:** 2026-10-31

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

`routers/downloads.py` ~1027-1049 does a full R2 GET to a temp file, an ffmpeg stamp, and streams the result through the API machine; byte proxies also at `clips.py` ~3153 and `games.py` ~4164. After-game download bursts load the single CPU (T14110), the disk and Fly egress.

## Solution

Stamp once when the export finishes, store the stamped object, and redirect downloads to a presigned R2 URL.

## Context

### Relevant Files
- `src/backend/app/routers/downloads.py`
- `src/backend/app/routers/clips.py`, `src/backend/app/routers/games.py` (byte proxies)
- `src/backend/app/services/export_finalize.py` (stamp at finish)

### Notes
Load: export-pipeline.md. Related: T2570 and the R2 CDN epic (partial overlap; reconcile before starting).

## Acceptance Criteria

- [ ] A download performs no ffmpeg and no byte proxy on the API machine (test)
- [ ] Existing downloads of pre-change exports still work (stamp lazily once)
