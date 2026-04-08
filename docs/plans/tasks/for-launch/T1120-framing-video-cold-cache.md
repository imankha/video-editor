# T1120: Framing Video Slow Load (R2 Cold Cache)

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

Loading a video into the Framing editor can take a very long time on first access. Users experience long waits before they can start editing.

## Investigation Findings

The Framing editor IS streaming via HTTP range requests (not downloading the full file). The bottleneck is **R2 cold cache latency**:

- `loadVideoFromStreamingUrl()` in `useVideo.js` sets the video src to a presigned R2 URL
- The `<video>` element uses `preload="auto"` — browser fetches via range requests (streaming)
- First access to an R2 video hits a cold Cloudflare edge cache (5-60s first-byte time)
- Cache warming (`cacheWarming.js`) only runs at **app init**, not when entering Framing mode
- For non-faststart MP4s, the moov atom is at the end of the file, adding extra latency

## Solution

Extend cache warming to trigger when entering Framing mode:

1. When user selects a project/clip to edit, immediately fire cache warming requests for the source video(s)
2. Warm both the start bytes (for quick playback start) and tail bytes (for moov atom)
3. This primes the R2 edge cache before the `<video>` element starts its own range requests

## Context

### Relevant Files
- `src/frontend/src/services/cacheWarming.js` — Current warmup logic (start + tail range requests, 5 concurrent workers)
- `src/frontend/src/hooks/useVideo.js` — `loadVideoFromStreamingUrl()` (line 169), slow load warning at 5s (line 519)
- `src/frontend/src/screens/FramingScreen.jsx` — Where clips are loaded (lines 455, 525, 731)
- `src/frontend/src/components/VideoPlayer.jsx` — `preload="auto"` (line 220)
- `src/backend/app/storage.py` — Presigned URL generation, `/storage/warmup` endpoint (lines 198-307)

### Technical Notes
- Cache warming currently makes `Range: bytes=0-1023` for start, last 5MB for large videos (>100MB)
- `useVideo.js` already logs "SLOW LOAD" warning if load takes >5s (line 519)
- Working videos are rendered outputs that may not exist in cache yet (freshly exported)
- Game source videos may already be warm from the annotate step

## Acceptance Criteria

- [ ] Cache warming triggers when entering Framing mode for selected clip(s)
- [ ] Source video URLs are warmed before the video element starts loading
- [ ] Measurably reduces first-load time in Framing editor
