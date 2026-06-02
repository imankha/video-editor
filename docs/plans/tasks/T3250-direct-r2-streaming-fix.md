# T3250: Direct R2 Video Streaming

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-06-02

## Problem

Video streaming proxies every byte through Fly.io (`httpx.AsyncClient` -> R2 -> Fly -> browser). The backend is a throughput bottleneck -- Fly.io staging machines deliver ~590 KB/s, far too slow for smooth video playback.

### Evidence (2026-06-02 HAR capture)

4 sequential range requests to `/api/games/1/stream`, totaling 23MB over 39 seconds:

| # | Duration | Size | Wait (TTFB) | Receive | Note |
|---|----------|------|-------------|---------|------|
| 1 | 4.4s | 3.9MB | 200ms | 4.2s | Initial chunk |
| 2 | 0.7s | 0.1KB | 196ms | 298ms | Metadata probe |
| 3 | **26.1s** | 19.5MB | 200ms | **25.9s** | Main body -- stall |
| 4 | **8.2s** | 0KB | -- | **8.0s** | Dead time, no data |

Request #3 spends 25.9s of its 26.1s just receiving bytes. Request #4 gets nothing for 8 seconds. The player starves and buffers underrun.

### Prior evidence (2026-05-29 HAR)

Same pattern: 300-500ms TTFB, `readyState=2` stalls, 600KB/s throughput on 9MB game video.

### Why the proxy exists

The bounded-range logic in `games.py:1941-2084` restricts which byte ranges are served (moov atoms + clip regions + padding). This prevents downloading full game videos via the stream URL. However, game videos belong to the user -- this was a soft bandwidth barrier, not content protection. With R2's zero egress fees, the bandwidth concern is moot.

## Solution

Replace the Fly.io video proxy with presigned URL endpoints. Backend returns a presigned R2 URL instead of proxying bytes. The browser `<video>` element fetches directly from R2 with native range request support. Proxy endpoints remain as fallback.

**Why presigned URLs:**
- Zero new infrastructure (no Worker, no custom domain, no HMAC signing)
- R2 natively supports `Range` requests and returns `206 Partial Content`
- Reuses existing `generate_presigned_url_global()` with 4hr TTL + cache
- $0 egress -- R2 has no egress fees regardless of delivery method
- Reference pattern: `downloads.py:556-605` already redirects to presigned URLs for final video downloads

**What we drop:** Bounded-range enforcement (3-window clamping). The browser can request any byte range from the full game video. This is acceptable because:
- Game videos are the user's own content
- R2 has zero egress fees
- Browser native video players only buffer what they need (~30-60s ahead)
- The CDN epic (T2550) can add HMAC auth later if tighter control is needed

## Implementation

### Backend

1. **New endpoint: `GET /api/games/{id}/playback-url`**
   - Returns presigned R2 URL for the game video
   - Response: `{ "url": "https://...", "expires_in": 14400, "file_size": <bytes> }`
   - Reuse `generate_presigned_url_global()` (already has 4hr expiry + TTL cache)
   - Include `file_size` so frontend can set Content-Length expectations

2. **New endpoint: `GET /api/clips/{clip_id}/playback-url`** (or `GET /api/projects/{project_id}/clips/{clip_id}/playback-url`)
   - Same pattern for clip streaming in Framing/Overlay steps
   - Returns presigned URL for the underlying game video
   - Include clip timing metadata (`start_time`, `end_time`) so frontend can seek to the right position

3. **Keep existing proxy endpoints unchanged** -- frontend chooses path based on flag

4. **Faststart detection**: Log a warning if a game video's moov atom is not at the start. Non-faststart files won't seek properly without the proxy's moov-head/tail windows. Our game videos were migrated to faststart in T1450, but new uploads should be checked.

### Frontend

1. **Game video (Annotate step)**: Before setting video src, fetch `/api/games/{id}/playback-url`. Set `<video src={presignedUrl}>` directly. Browser handles range requests natively.

2. **Clip video (Framing/Overlay steps)**: Fetch `/api/clips/{id}/playback-url`. Set video src to presigned URL. Use returned `start_time` to seek to the clip start.

3. **URL refresh**: Set a timer to fetch a new presigned URL at 75% of TTL (3hr mark for 4hr TTL). Swap `video.src` without interrupting playback if possible, or on next seek/load.

4. **Fallback**: If presigned URL request fails or video load errors on the direct URL, fall back to existing proxy endpoint. Log the fallback for monitoring.

5. **No custom streaming logic**: The browser's native video player handles range requests, buffering, and seeking. No fetch/XHR needed for video data.

### Measurement

Capture before/after HAR for the same game video:

| Metric | Current (proxy) | Target (direct) |
|--------|-----------------|-----------------|
| TTFB per range request | 200-500ms | <100ms |
| Throughput | ~590 KB/s | >5 MB/s |
| Time to bufferAhead > 5s | >2s | <1s |
| Seek latency | 700ms+ | <500ms |
| Stall events (readyState=2) | 3+ per session | 0 |

## Known Limitations

1. **HTTP/1.1 connection limit**: R2 S3 endpoint (`*.r2.cloudflarestorage.com`) is HTTP/1.1 -- Chrome caps at 6 connections per origin. Game video playback uses 2-4 connections, leaving room for other R2 operations. If warmup prefetcher also hits R2 directly, connections could compete. The CDN epic (T2550) resolves this with HTTP/2 on a custom domain.

2. **Faststart required**: Without the proxy's moov-head/tail windows, the moov atom MUST be at the start of the file. Non-faststart files would require downloading the entire video before playback starts. All existing game videos should be faststart (T1450 migration), but detect and log violations.

3. **Presigned URL in browser history**: The presigned URL with auth params will be visible in browser dev tools. URLs expire after 4 hours and are scoped to the specific object. This is acceptable for user-owned content; the CDN epic adds HMAC auth for tighter control.

4. **R2 known bugs**: Range responses occasionally off by 64KB (~0.1-0.5% of requests). Video may end abruptly on non-faststart files. `Accept-Ranges: bytes` header may be missing on public bucket responses (verify during testing). Sources: [R2 range bug](https://community.cloudflare.com/t/r2-range-responses-rarely-0-5-off-by-64kb/772463), [video ends abruptly](https://community.cloudflare.com/t/r2-mp4-video-streaming-ends-abruptly/759300)

## Relevant Files

- `src/backend/app/routers/games.py:1941-2147` -- Game stream endpoint (proxy to replace)
- `src/backend/app/routers/clips.py:1602-1833` -- Clip stream endpoint (same proxy pattern)
- `src/backend/app/storage.py:1835-1876` -- `generate_presigned_url_global()` (reuse for playback URLs)
- `src/backend/app/routers/downloads.py:556-605` -- Download endpoint presigned URL redirect (reference pattern)
- `src/frontend/src/hooks/useVideo.js:561-599` -- Video waiting/buffering handlers
- `src/frontend/src/components/VideoPlayer.jsx:207-231` -- Video element setup

## Absorbs

This task absorbs **T3240** (Direct R2 Streaming Experiment) in its entirety. T3240 framed this work as a feature-flagged experiment; this task implements it as the fix for observed playback stalls.

## Relationship to R2 CDN Epic

This task is a **prerequisite** for the [R2 CDN Video Serving epic](r2-cdn/EPIC.md) (T2550/T2560/T2570). Once T3250 is deployed and validated:
- **T2550** (CDN + Auth Worker) scope simplifies to custom domain + HMAC auth + HTTP/2 + CDN caching. No byte proxying in the Worker.
- **T2560** (Edge Byte-Range Clamping) is likely **skipped** since T3250 proves clamping unnecessary.
- **T2570** (Remove Fly.io Proxy) scope is clear: delete the proxy code that T3250 made redundant.

## Acceptance Criteria

- [ ] Game video playback uses presigned R2 URLs (no Fly.io proxy in the data path)
- [ ] Clip video playback uses presigned R2 URLs
- [ ] TTFB < 100ms for range requests on direct path
- [ ] Video playback does not stall on initial load (bufferAhead > 5s within 2s of play)
- [ ] Seek operations complete in < 500ms
- [ ] Presigned URL refresh works for sessions longer than 3 hours
- [ ] Non-faststart files detected and logged (not silently broken)
- [ ] Proxy endpoints remain functional as fallback
- [ ] HAR comparison captured: proxy vs direct for the same game video
