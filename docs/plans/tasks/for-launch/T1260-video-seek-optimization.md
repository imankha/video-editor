# T1260: Video Seek Optimization

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-09
**Updated:** 2026-04-09

## Problem

In Annotate mode, users watch full 60-90 min VEO game videos and randomly seek to find when their kid enters/leaves the game. Each seek stalls for 1-5+ seconds because:

1. **No local caching** — every range request goes to R2 origin. Seeking back to a timestamp the browser already fetched re-downloads it from scratch.
2. **Imprecise cache warming** — `cacheWarming.js` estimates byte ranges proportionally (`timestamp/duration * fileSize`). This is wrong for VBR content and wastes warming on the wrong bytes.
3. **No shared caching infrastructure** — Annotate, Framing, and Overlay each rely on the browser's built-in buffering with no persistent local cache. A video fetched in Annotate must be re-fetched in Framing.

### What's NOT the problem

VEO cameras output **2.5s keyframe intervals** (GOP=75 at 29.97fps). Decode time from nearest keyframe is ~150-250ms — well within the <500ms target. The bottleneck is **network**, not decode. Re-encoding with tighter GOP is not cost-justified.

CDN edge caching also doesn't help: Cloudflare's 512 MB file size limit (non-Enterprise) means our 1-3 GB game videos are never cached at the edge.

## Solution

Three layers, each building on the previous. All are client-side ($0 per video).

### Layer 1: Service Worker Video Cache (Primary — biggest impact)

A Service Worker intercepts all video range requests and serves from a local Cache API store. This makes **repeat seeks instant** and persists across mode transitions.

**How it works:**

```
Browser seeks → <video> requests Range: bytes=X-Y →
  Service Worker intercepts →
    Cache HIT:  serve from local cache (<1ms)
    Cache MISS: fetch from R2, store full response, serve range
```

**Key design decisions:**

- **Cache key normalization**: Presigned URLs expire and change signature params. The SW strips query params and uses a canonical key: `video:{blake3_hash}`. The hash is embedded as a custom header or URL path segment by the frontend when making requests.
- **Full-response caching with range slicing**: Store the complete response body from R2, then serve arbitrary Range requests from it locally. Use Workbox's `workbox-range-requests` module for correct 206 response construction.
- **Progressive caching**: Don't block on caching the full file. Cache each range response as it arrives. Build up a complete local copy over time as the user watches/seeks.
- **Shared across modes**: Video cached during Annotate is available in Framing and vice versa. Working videos cached in Framing are available in Overlay.
- **Quota management**: Evict oldest videos when approaching storage quota (check `navigator.storage.estimate()`). Game videos are large — keep the 3-5 most recent.

**What this solves per mode:**

| Mode | Benefit |
|------|---------|
| **Annotate** | Seeking back to any previously-viewed timestamp is instant. Sequential playback builds up cache naturally. |
| **Framing** | Clip ranges warm during Annotate are already cached locally. Switching between clips in the same game is instant. |
| **Overlay** | Working videos (small, ~5-50 MB) are cached on first load. Re-entering Overlay is instant. |

### Layer 2: Moov Atom Parsing for Precise Cache Warming

Replace proportional byte estimation in `cacheWarming.js` with exact timestamp-to-byte mapping from the MP4 index.

**How it works:**

1. Fetch moov atom via range request (bytes 0 to ~5 MB for faststart videos)
2. Parse with **mp4box.js** — extract sample table (stts, stco, stsz boxes)
3. Build a lookup: `getByteRange(startTime, endTime) → {startByte, endByte}`
4. Use exact ranges for all cache warming (Tier 1 clip ranges and Tier 2 game warming)

**Shared utility** — `videoIndex.js`:

```javascript
// Used by cacheWarming.js for precise byte range estimation
// Used by Service Worker for predictive prefetch
// Used by any future feature needing timestamp→byte mapping

async function buildVideoIndex(url) → { getByteRange, getKeyframeTimes, totalDuration }
```

This benefits all modes by making cache warming accurate regardless of VBR bitrate variation.

### Layer 3: Predictive Prefetch in Annotate

Since Annotate is mostly sequential with occasional random seeks, the Service Worker can **prefetch ahead** of the playhead:

- On each range request, also fetch the **next 30 seconds** of video data in the background
- Use the moov atom index (Layer 2) to calculate exact byte range for the prefetch window
- Prefetch runs at idle priority (requestIdleCallback) to avoid competing with active playback
- On random seek, cancel pending prefetch and start a new one from the new position

This means by the time the user seeks forward (which is the common case — watching a game), the data is already local.

## Context

### Relevant Files

**Service Worker (new):**
- `src/frontend/public/sw.js` — New Service Worker file
- `src/frontend/src/utils/swRegistration.js` — New SW registration utility
- `src/frontend/vite.config.js` — Configure SW asset handling (or use vite-plugin-pwa)

**Moov parsing (new):**
- `src/frontend/src/utils/videoIndex.js` — New moov atom parser using mp4box.js

**Existing files to modify:**
- `src/frontend/src/utils/cacheWarming.js` — Replace proportional estimation with videoIndex lookups
- `src/frontend/src/hooks/useVideo.js` — Pass video hash to fetch requests for SW cache key
- `src/frontend/src/components/VideoPlayer.jsx` — Add hash-based header to video element requests (or use SW URL rewriting)
- `src/frontend/package.json` — Add mp4box.js, workbox-range-requests dependencies

### Related Tasks

- **T1210** (Clip-Scoped Video Loading) — DONE. Established clip-scoped loading for Framing. This task adds the caching layer underneath.
- **T440** (PWA) — TODO. Service Worker from this task is a prerequisite for PWA. Design SW with future offline capability in mind.
- **T1250** (Live Scrub in Annotate) — TODO. Live scrubbing benefits enormously from local video cache (every scrub position is a seek).

### Technical Notes

- **Safari Cache API quirk**: Safari evicts origin data after 7 days without interaction. Not a concern for active users, but don't depend on long-term persistence.
- **Presigned URL expiry**: URLs expire after 1-4 hours. The SW must handle cache key independently of URL signature. Using blake3 hash (already stored in games table) as canonical identifier.
- **mp4box.js size**: ~80 KB minified. Only loaded when needed (dynamic import on first cache warm).
- **Storage quotas**: Chrome allows up to 60% of disk per origin. For a 256 GB disk, that's ~150 GB — fits dozens of game videos. Call `navigator.storage.persist()` on login to prevent eviction.
- **workbox-range-requests**: Handles the complexity of serving correct 206 responses from cached full responses. Well-tested, used in production by YouTube's PWA.
- **VEO camera specs confirmed**: H.264 High profile, 1920x1080, 29.97fps, ~4.5 Mbps, 2.5s keyframe interval, ~3 GB per 90-min game.

### Research Basis

Full research conducted across 5 dimensions (R2/CDN behavior, encoding best practices, transcoding strategies, hybrid loading, industry approaches). Key findings that shaped this task:

- CDN caching is ineffective for files >512 MB (Cloudflare non-Enterprise limit)
- VEO source GOP of 2.5s means decode time is already acceptable (~150-250ms)
- Re-encoding to tighter GOP costs ~$0.05/video on Modal GPU — not justified given 5% monetization rate
- Industry standard (Frame.io, Hudl, Descript) is proxy generation, but all are at scale where per-video cost is amortized. For our alpha with cost sensitivity, client-side caching achieves 80% of the benefit at $0/video.
- Service Worker + Cache API is the only approach that makes repeat seeks truly instant (<1ms) without server-side processing

## Implementation

### Steps

**Layer 1: Service Worker Video Cache**
1. [ ] Add workbox-range-requests dependency
2. [ ] Create `sw.js` with fetch event listener that intercepts video requests (match on URL pattern or custom header)
3. [ ] Implement cache key normalization: strip presigned URL params, use `video:{hash}` key
4. [ ] On cache miss: fetch from R2, store response in Cache API, return requested range
5. [ ] On cache hit: construct 206 response from cached data using workbox-range-requests
6. [ ] Create `swRegistration.js` — register SW on app init, handle updates
7. [ ] Pass blake3 hash from frontend to SW (via URL rewrite, custom header, or message channel)
8. [ ] Add quota management: track cached video sizes, evict LRU when estimate > 80% of quota

**Layer 2: Moov Atom Parsing**
9. [ ] Add mp4box.js dependency
10. [ ] Create `videoIndex.js`: fetch moov atom, parse sample table, expose `getByteRange(start, end)`
11. [ ] Cache parsed indexes in memory (Map keyed by blake3 hash) — moov only needs parsing once per session
12. [ ] Update `cacheWarming.js`: for each warm target, build video index first, then use exact byte ranges
13. [ ] Fallback: if moov parsing fails, use existing proportional estimation

**Layer 3: Predictive Prefetch**
14. [ ] In SW, on video range request: schedule background fetch for next 30s of data (use videoIndex byte mapping)
15. [ ] Cancel pending prefetch on seek (new range request to a non-contiguous position)
16. [ ] Rate-limit prefetch to avoid saturating bandwidth during active playback

### Progress Log

*(empty)*

## Acceptance Criteria

- [ ] Seeking to a previously-viewed timestamp in Annotate serves from local cache (<50ms)
- [ ] Sequential playback in Annotate progressively caches video data for future seeks
- [ ] Cache warming uses exact byte ranges from moov atom (not proportional estimation)
- [ ] Video cached during Annotate is available when entering Framing (no re-download of clip ranges)
- [ ] Working videos cached in Framing/Overlay persist across mode transitions
- [ ] Presigned URL expiry does not invalidate local cache (cache key is hash-based)
- [ ] Storage quota is managed: old videos evicted when quota pressure is high
- [ ] Moov parsing failure degrades gracefully to proportional estimation
- [ ] No regression in first-visit load time (SW adds <10ms overhead on cache miss)
- [ ] Works in Chrome and Firefox; Safari works but may lose cache after 7 days of inactivity
