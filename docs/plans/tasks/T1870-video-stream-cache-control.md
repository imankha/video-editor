# T1870: Video Stream Cache-Control Headers

**Status:** TESTING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-04-25

## Problem

If a video stream request fails (server restart, R2 timeout, deploy), the browser caches the error response at that URL. Subsequent loads serve the cached error — the browser never re-fetches, and the video element reports "Video format not supported." Users must hard-refresh (Ctrl+Shift+R) to clear the cache and recover.

This was observed during local dev (uvicorn `--reload` restarted mid-stream, Vite proxy returned a 502, browser cached it), but can also happen in production during Fly.io deploys or transient R2 failures.

## Solution

Add `Cache-Control: no-store` to all video stream proxy responses:

- Clip streams: `/api/clips/projects/{id}/clips/{id}/stream`
- Working video streams: `/api/projects/{id}/working_video/stream`
- Game video streams: `/api/games/{id}/stream`

With `no-store`, the browser always re-fetches on retry, so the existing "Retry Loading Video" button works without a hard refresh.

## Relevant Files

- `src/backend/app/routers/projects.py` — working video stream endpoint
- `src/backend/app/routers/clips.py` — clip stream endpoint
- `src/backend/app/routers/games.py` — game video stream endpoint (if exists)

## Acceptance Criteria

- [ ] All video stream endpoints include `Cache-Control: no-store` header
- [ ] After a transient stream failure, clicking "Retry Loading Video" loads the video without hard refresh
- [ ] No impact on video playback performance (range requests still work)
