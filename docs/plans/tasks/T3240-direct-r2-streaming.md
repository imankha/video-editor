# T3240: Direct R2 Streaming Experiment

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-29
**Updated:** 2026-05-29

## Problem

Video streaming proxies every byte through Fly.io (`httpx.AsyncClient` -> R2 -> Fly -> browser). HAR analysis shows 300-500ms TTFB per range request, causing the browser to stall with only 2.3s of buffer ahead (`readyState=2`). The proxy architecture is the fundamental bottleneck -- quick fixes (cache headers, larger chunks) reduce the impact but don't eliminate the round-trip penalty.

### Evidence (2026-05-29 HAR capture)

- Stream request #1: 10MB moov window, wait=305ms, receive=398ms, total=704ms
- Stream request #2: 0.1KB range, blocked=298ms, wait=196ms, total=686ms
- Console: `[VIDEO] Waiting: currentTime=10.6 bufferAhead=2.3s readyState=2` (repeated 3x)
- All API calls during page load: 700-1450ms TTFB (Fly.io cold path)

### Why the proxy exists

The "bounded range" logic in `games.py:1941-2084` restricts which byte ranges are served (moov atoms + clip regions + padding). This prevents users from downloading full game videos via the stream URL. The proxy enforces this server-side.

## Purpose

This is a **low-cost experiment** to validate whether presigned URLs eliminate the TTFB problem. Results determine the scope of the [R2 CDN Video Serving epic](r2-cdn/EPIC.md):

| T3240 Result | CDN Epic Consequence |
|---|---|
| Presigned URLs fix TTFB + playback smooth | CDN epic simplifies: custom domain for HTTP/2 + caching of smaller files. Worker byte-range clamping (T2560) may be unnecessary. |
| Presigned URLs fix TTFB but non-faststart files break | CDN epic keeps T2550 (custom domain) but adds faststart enforcement on upload. T2560 scope shrinks. |
| Presigned URLs don't fix TTFB (R2 origin too slow) | CDN epic proceeds as-is: Worker + CDN caching required to get edge-served TTFB. |
| `Accept-Ranges` header missing or R2 bugs surface | CDN epic must include Worker or transform rules to fix headers. T2550 scope grows. |

## Solution: Presigned URL Experiment (Option A)

Eliminate the proxy for one video type (game clip streaming) behind a feature flag. Backend returns a presigned URL instead of proxying bytes. Browser `<video>` element fetches directly from R2 with native range request support.

**Why presigned URLs over a Worker:**
- Zero new infrastructure (no Worker, no custom domain, no HMAC signing)
- R2 natively supports `Range` requests and returns `206 Partial Content`
- Research shows Workers proxying large R2 files have active reliability issues (stalling 1-2 min on load, `cache_put` taking up to 30s). See: [Worker stalling](https://community.cloudflare.com/t/r2-video-streaming-via-worker-stalling-on-load-for-minutes/861913), [MP4 seeking unreliable](https://community.cloudflare.com/t/mp4-streaming-seeking-from-r2-no-longer-works-reliably-despite-no-config-changes/844957)
- $0 egress — R2 has no egress fees regardless of delivery method

**Trade-off:** Dropping bounded-range enforcement. Game videos belong to the user — preventing download was a soft barrier for bandwidth, not content protection. Presigned URLs with 5-min expiry provide reasonable protection.

## Implementation

### Backend

1. New endpoint: `GET /api/projects/{project_id}/clips/{clip_id}/playback-url`
   ```json
   {
     "url": "https://<account>.r2.cloudflarestorage.com/bucket/path?X-Amz-...",
     "expires_in": 14400,
     "file_size": 2147483648
   }
   ```
2. Reuse `generate_presigned_url_global()` (already has 4hr expiry + TTL cache)
3. Keep existing proxy endpoint unchanged — frontend chooses path via feature flag

### Frontend

1. Feature flag: `?direct_stream=1` URL param or localStorage toggle
2. When enabled: fetch playback URL, set `<video src={presignedUrl}>` directly
3. Browser handles range requests natively — no custom fetch/streaming logic
4. Add URL refresh: fetch new presigned URL at 75% of TTL for long sessions
5. Keep proxy path as fallback (flag off = current behavior)

### Measurement

Capture before/after HAR for the same game video:

| Metric | Current (proxy) | Target (direct) |
|--------|-----------------|-----------------|
| TTFB per range request | 300-500ms | <100ms |
| Time to bufferAhead > 5s | >2s | <1s |
| Seek latency | 700ms+ | <500ms |
| Stall events (readyState=2) | 3+ per session | 0 |

**Reference pattern:** `downloads.py:556-605` already redirects to presigned URLs for final video downloads.

## Research Findings (2026-05-29)

### R2 Range Request Support

R2 natively supports HTTP range requests and returns `206 Partial Content` with proper `Content-Range` headers. The browser `<video>` element handles range-based seeking automatically when given a direct URL. R2 unconditionally returns HTTP 206 on ranged requests for S3 compatibility. Cloudflare has also fixed a prior issue where ranged reads near the end of very large files were slower -- performance is now consistent regardless of file size.

### Known R2 Bugs to Watch For

| Bug | Severity | Status | Mitigation |
|-----|----------|--------|------------|
| Range responses off by 64KB (~0.1-0.5% of requests) | Low | Intermittent, not consistently reproducible | Validate `Content-Range` header matches requested range; retry on mismatch |
| Video ends abruptly during playback | Medium | Active reports | Ensure moov atom at start (faststart); our existing moov-head/tail windows handle this for non-faststart files |
| Public R2 bucket missing `Accept-Ranges: bytes` header | Medium | Reported | Verify header present when testing; may need to add via Worker or transform rule if missing |

Source: [R2 range bug](https://community.cloudflare.com/t/r2-range-responses-rarely-0-5-off-by-64kb/772463), [video ends abruptly](https://community.cloudflare.com/t/r2-mp4-video-streaming-ends-abruptly/759300), [range request support](https://community.cloudflare.com/t/range-request-support-for-videos-in-r2-buckets/776059)

### MP4 faststart Is Critical for Direct Streaming

Without the proxy's moov-head/tail windows, the moov atom MUST be at the start of the file. Without faststart, the browser must download the entire 2GB file to build the sample table. Our existing game videos were migrated to faststart in T1450 (13 moov-at-end files re-muxed). New uploads should be checked.

### CDN Caching Constraints for 2GB Files

| Plan | Max Cacheable File Size |
|------|------------------------|
| Free/Pro/Business | 512 MB |
| Enterprise | 5 GB |
| Cache Reserve | No limit ($0.015/GB/mo) |

Full game videos won't cache on our plan. CDN caching only helps for exported clips (<200MB). This means the CDN epic's value is primarily HTTP/2 multiplexing + caching small files, not caching game videos.

### Presigned URL TTL

Our existing `_PRESIGNED_URL_CACHE` with 3.5hr TTL works. Presigned URL expiry (4hr for global game videos) must exceed typical playback session length since the browser makes new range requests throughout playback using the same URL.

## Relevant Files

- `src/backend/app/routers/games.py:1941-2147` - Game stream endpoint (bounded range proxy)
- `src/backend/app/routers/clips.py:1602-1833` - Clip stream endpoint (same pattern)
- `src/frontend/src/hooks/useVideo.js:561-599` - Video waiting/buffering handlers
- `src/frontend/src/components/VideoPlayer.jsx:207-231` - Video element setup
- `src/backend/app/storage.py:1835-1876` - `generate_presigned_url_global()` (game videos, 4hr, TTL-cached)
- `src/backend/app/routers/downloads.py:556-605` - Download endpoint presigned URL redirect (reference pattern)

## Context

### Quick fixes already deployed (separate commit)

- `Cache-Control: no-store` changed to `private, max-age=300, immutable` (enables browser range caching)
- Chunk size increased from 1MB to 4MB (fewer round-trips per buffer fill)

These reduce stalling but don't eliminate the Fly proxy TTFB.

### Relationship to R2 CDN Epic

T3240 is a **prerequisite experiment** for the [R2 CDN Video Serving epic](r2-cdn/EPIC.md) (T2550/T2560/T2570). This task validates the simplest approach first. The CDN epic's scope adapts based on results — see the decision matrix at the top of this file.

CDN-layer work (custom domain, HMAC auth, Cache Reserve, Worker byte-range clamping) lives in the CDN epic, not here. T3240 deliberately avoids new infrastructure.

## Acceptance Criteria

- [ ] Feature-flagged presigned URL path works for game clip streaming
- [ ] HAR comparison captured: proxy vs direct for the same game video
- [ ] TTFB < 100ms for range requests on direct path
- [ ] Video playback does not stall on initial load (bufferAhead > 5s within 2s of play)
- [ ] Seek operations complete in < 500ms
- [ ] Presigned URL refresh works for sessions longer than URL expiry
- [ ] Non-faststart files detected and logged (not silently broken)
- [ ] Decision document: which CDN epic tasks are still needed based on results
