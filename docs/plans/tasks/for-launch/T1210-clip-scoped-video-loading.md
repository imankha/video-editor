# T1210: Clip-Scoped Video Loading in Framing

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

Opening a multi-clip project in the Framing editor triggers a 13+ second load for a 90-minute (5390s) game video. The browser downloads far more data than needed because:

1. **`preload="auto"` on the `<video>` element** — the browser aggressively buffers the entire video, not just the clip range
2. **No project-creation-time preloading** — cache warming only runs at app init (`cacheWarming.js`), so R2 edge cache is cold when Framing opens
3. **Full video URL, no time hints** — `loadVideoFromStreamingUrl()` accepts a `clipRange` param but only uses it for logical offset/duration in JS; it doesn't constrain what the browser actually downloads

For a multi-clip project with 5 clips from a 90-minute game, we might need 50 seconds of video total but the browser tries to buffer 5400 seconds.

## Solution

### 1. Clip-scoped `preload` strategy

Change `VideoPlayer.jsx` from `preload="auto"` to `preload="metadata"` when in Framing mode. After metadata loads, seek to the clip's start time — the browser will only buffer from that point forward.

Alternatively, use [Media Fragment URIs](https://www.w3.org/TR/media-frags/) (`#t=start,end`) on the presigned URL to hint the browser about the relevant range:
```
https://r2.example.com/video.mp4?...presigned...#t=120,135
```

### 2. Preload on project creation

When the user creates a project (selects clips for framing), immediately fire cache-warming requests for each source video's clip ranges. This primes the R2 edge cache before the user enters Framing.

### 3. Warm on Framing entry (overlaps with T1120)

When entering Framing, warm the specific byte ranges for each clip's time range (not just start + tail like current cache warming). This requires knowing the byte offset for a given timestamp, which may require the moov atom.

## Context

### Relevant Files
- `src/frontend/src/components/VideoPlayer.jsx:220` — `preload="auto"` (should be scoped)
- `src/frontend/src/hooks/useVideo.js:169` — `loadVideoFromStreamingUrl()` accepts `clipRange` but doesn't constrain browser fetch
- `src/frontend/src/services/cacheWarming.js` — Current warmup logic (start + tail only, runs at app init)
- `src/frontend/src/screens/FramingScreen.jsx` — Where clips are loaded
- `src/backend/app/storage.py` — Presigned URL generation, `/storage/warmup` endpoint

### Related Tasks
- T1120 (Framing Video Cold Cache) — covers cache warming on Framing entry; this task is broader (project creation preload + clip-scoped loading)
- T1130 (Multi-Clip Stream Not Download) — DONE, fixed exports to use range requests; this task fixes playback

### Technical Notes
- Media Fragment URIs (`#t=start,end`) are supported by most browsers but may not work with all presigned URL formats — needs testing with R2
- `preload="metadata"` + seek is the safest approach — browser only buffers from seek position
- For multi-clip framing, each clip switch should cancel buffering of the previous clip's video range
- The `[VIDEO] SLOW LOAD` warning at 5s threshold (useVideo.js:518) confirms this is a real user-facing problem

## Implementation

### Steps
1. [ ] Change `preload="auto"` to `preload="metadata"` in VideoPlayer.jsx for Framing mode
2. [ ] After metadata loads, seek to clip start time so browser buffers from the right position
3. [ ] Test Media Fragment URI approach (`#t=start,end`) with R2 presigned URLs
4. [ ] Add project-creation-time cache warming for selected clip video ranges
5. [ ] Extend Framing entry warming (T1120) to warm specific clip byte ranges
6. [ ] Cancel in-flight buffering when switching between clips in multi-clip mode

## Acceptance Criteria

- [ ] Multi-clip Framing opens in <3s for cached videos (down from 13s+)
- [ ] Browser only buffers the clip's time range, not the full video
- [ ] Project creation triggers cache warming for clip source videos
- [ ] No regression in single-clip Framing performance
- [ ] `[VIDEO] SLOW LOAD` warning no longer triggers for typical clip lengths
