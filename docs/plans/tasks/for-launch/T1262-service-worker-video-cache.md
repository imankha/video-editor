# T1262: Service Worker Video Cache

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-04-09
**Updated:** 2026-04-09
**Parent:** T1260
**Depends on:** T1261 (need instrumentation to prove impact)

## Problem

Every video range request goes to R2 origin. Seeking back to a previously-viewed timestamp re-downloads the same bytes. The browser's internal buffer is discarded on large seeks, so even data fetched 30 seconds ago may be gone.

## Solution

A Service Worker intercepts video range requests and caches responses locally. Repeat seeks serve from the Cache API instead of the network.

### How it works

```
1. <video> seeks → browser requests Range: bytes=X-Y from presigned URL
2. SW fetch event fires, matches R2 domain pattern
3. SW looks up blake3 hash for this URL (from urlToHashMap)
4. SW checks Cache API for "video:{hash}"

   HIT:  Slice cached response to requested range → return 206
   MISS: Fetch from R2 → clone → store in cache → return original response
```

### Cache key normalization

Presigned URLs change every 1-4 hours (new signature params). The SW must cache by a stable identifier.

**Approach:** Main thread calls `registerVideo(url, blake3Hash)` when loading a video. SW strips query params from intercepted URLs and matches against registered URLs to find the hash. Cache key is `video:{hash}`.

### Progressive caching

The SW doesn't download the full 3 GB file. It caches each range response as it arrives. Over a viewing session:
- Sequential playback fills the cache progressively
- Each seek to a new position adds that range to the cache
- Seeking back to any previously-visited position is a cache hit

### What this does NOT solve

- **First-visit seek latency** — still hits the network (same as today)
- **Imprecise cache warming** — that's T1264 (moov parsing)
- **Forward seeks beyond buffered data** — that's T1265 (prefetch)

## How to prove it works

### Playwright-driven measurement

The `e2e/seek-perf.spec.js` test performs 6 seeks including two "return-to-viewed" seeks that specifically test cache effectiveness. The test also captures `[SW]` console logs showing HIT/MISS status.

**Before (T1261 baseline already saved):**
```bash
# Already saved as seek-perf-before-T1262.json from T1261
cat src/frontend/test-results/seek-perf-before-T1262.json
```

**After:**
```bash
cd src/frontend && npx playwright test e2e/seek-perf.spec.js 2>&1 > /tmp/seek-perf.log; echo "exit: $?"
cp test-results/seek-perf-results.json test-results/seek-perf-after-T1262.json
reduce_log({ file: "/tmp/seek-perf.log", tail: 200, grep: "SeekPerfTest|\\[SW\\]" })
```

**What to compare (read both JSON files):**

| Metric | In JSON as | Before T1262 | After T1262 |
|--------|-----------|-------------|-------------|
| Return to viewed position | `results[0].totalLatencyMs` (`backward-to-viewed`) | 1-5s | <50ms |
| Return to midpoint | `results[4].totalLatencyMs` (`return-to-midpoint`) | 1-5s | <50ms |
| First visit to midpoint | `results[2].totalLatencyMs` (`random-midpoint`) | 1-5s | ~same (cache miss) |
| Cache hit rate | `summary.cacheHitRate` | 0% | ~33% |

**SW-specific signals in consoleLogs:**

Look for these in the `consoleLogs` array of the results JSON:
```
[SW] MISS video:abc123 range=... (first-visit seeks)
[SW] HIT  video:abc123 range=... (return-to-viewed seeks)
```

If no `[SW]` lines appear, the SW isn't intercepting video requests — check registration.

**Screenshots:** Read `test-results/seek-perf-return-to-midpoint.png` — should show a video frame, not black. This confirms the SW served valid video data.

### Vitest unit tests

- `handleVideoFetch` with mock cache (hit path): returns 206 with correct Content-Range header
- `handleVideoFetch` with mock cache (miss path): calls fetch, stores in cache, returns response
- `stripQueryParams`: correctly strips `X-Amz-*` params, preserves path
- URL-to-hash lookup: registered URLs resolve correctly
- Range header parsing: extracts start/end bytes correctly

### Regression check

Compare the "after" JSON with baseline. For first-visit seeks (`random-midpoint`, `random-75pct`, `forward-near`), latency should be within 10ms of baseline. If it's significantly worse, the SW is adding overhead on cache misses — investigate.

## File Changes

### New: `src/frontend/public/sw.js`

| Function | Description |
|----------|-------------|
| `install` event | `skipWaiting()` — activate immediately, no waiting for other tabs to close. |
| `activate` event | `clients.claim()` — take control of all open tabs. Delete any old cache versions. |
| `fetch` event | Match requests by URL pattern (R2 domain). For matches, call `handleVideoFetch()`. For non-matches, `fetch(event.request)` passthrough. |
| `handleVideoFetch(request)` | Extract URL path (strip query params). Look up blake3 hash from `urlToHashMap`. If no hash registered, passthrough to network. If hash found: check `caches.open('video-cache')` for key `video:{hash}`. On hit: call `sliceCachedResponse(cachedResponse, request)` to extract requested Range. On miss: `fetch(request)`, clone, `cache.put()`, return original. Log cache hit/miss with timing. |
| `sliceCachedResponse(cached, request)` | Parse `Range` header from request. Read cached response as ArrayBuffer (or use workbox-range-requests `createPartialResponse()`). Slice to requested range. Return new `Response` with status 206, headers `Content-Range`, `Content-Length`, `Content-Type`. |
| `message` event | Handle `REGISTER_VIDEO`: add `{urlPath → hash}` to `urlToHashMap`. Handle `UNREGISTER_VIDEO`: remove entry. Handle `GET_CACHE_STATS`: respond with cache sizes per hash. |
| `urlToHashMap` | Module-level `Map<urlPath, blake3Hash>`. Populated by main thread via postMessage. URL path is the presigned URL with query params stripped. |

### New: `src/frontend/src/utils/swRegistration.js`

| Function | Description |
|----------|-------------|
| `registerServiceWorker()` | `navigator.serviceWorker.register('/sw.js', {scope: '/'})`. Log registration status. Handle `updatefound` event for SW updates. Return the registration object. No-op if `serviceWorker` not in `navigator` (SSR, unsupported browser). |
| `registerVideo(presignedUrl, blake3Hash)` | Strip query params from URL. Send `{type: 'REGISTER_VIDEO', urlPath, hash}` to active SW via `navigator.serviceWorker.controller.postMessage()`. If no active SW yet (first load), queue the message and send after `controllerchange` event. |
| `unregisterVideo(blake3Hash)` | Send `{type: 'UNREGISTER_VIDEO', hash}` to SW. Called when switching games in Annotate (old game's URL mapping is no longer needed, but cache data stays). |
| `getCacheStats()` | Send `{type: 'GET_CACHE_STATS'}` and await response via `MessageChannel`. Returns `{totalBytes, videos: [{hash, bytes, lastAccessed}]}`. Used by quota management (T1266). |
| `stripQueryParams(url)` | Parse URL, remove all query params, return origin + pathname. Handles R2 presigned URLs which have `X-Amz-Algorithm`, `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires`, `X-Amz-SignedHeaders`, `X-Amz-Signature`. |

### Modified: `src/frontend/src/hooks/useVideo.js`

| Function | Change |
|----------|--------|
| `loadVideoFromStreamingUrl(url, preloadedMetadata, clipRange)` | After `setVideoLoaded()`, call `registerVideo(url, preloadedMetadata?.blake3Hash)` if blake3Hash is present and URL is not a blob URL. This tells the SW about the URL→hash mapping for this video. |
| No other functions change | The SW intercepts at the fetch level — `useVideo` doesn't need to change how it triggers seeks or handles events. |

### Modified: `src/frontend/src/containers/AnnotateContainer.jsx`

| Function | Change |
|----------|--------|
| `handleLoadGame(gameId)` (~line 338-366) | When constructing `videoMetadata`, add `blake3Hash: gameData.blake3_hash`. The field is already available on `gameData` from the games store. This flows through to `loadVideoFromStreamingUrl` via `setAnnotateVideoMetadata`. |

### Modified: `src/frontend/src/screens/FramingScreen.jsx`

| Function | Change |
|----------|--------|
| Clip metadata construction | When building metadata for `loadVideoFromStreamingUrl`, include `blake3Hash` from the clip's parent game data. Thread it through `getClipVideoConfig` or the metadata object. |

### Modified: `src/frontend/src/screens/OverlayScreen.jsx`

| Function | Change |
|----------|--------|
| Video load effect (~line 354-374) | Working videos use a different hash (the working video's own hash, not the game's). If `workingVideo` data includes a hash, pass it through metadata. If not, the SW falls back to passthrough (no caching for unhashed URLs — still works, just no cache benefit). |

### Modified: `src/frontend/src/App.jsx`

| Location | Change |
|----------|--------|
| Top-level useEffect | Call `registerServiceWorker()` on mount. Call `navigator.storage.persist()` (best-effort, prevents browser from evicting our cache). |

### Modified: `src/frontend/package.json`

| Dependency | Why |
|-----------|-----|
| `workbox-range-requests` | Construct correct 206 responses from cached data. Handles edge cases (invalid ranges, multipart). |

## Implementation

### Steps
1. [ ] **Measure before**: With T1261 instrumentation in place, run the test protocol below WITHOUT the SW. Record 5 seeks (2 backward to previously-viewed positions, 3 to new positions). Document all latencies in Progress Log as "before" baseline.
2. [ ] Add `workbox-range-requests` to package.json
3. [ ] Create `sw.js` with fetch intercept, `handleVideoFetch`, `sliceCachedResponse`
4. [ ] Create `swRegistration.js` with `registerServiceWorker()`, `registerVideo()`, `stripQueryParams()`
5. [ ] Register SW from `App.jsx`, call `navigator.storage.persist()`
6. [ ] Add `blake3Hash` to video metadata in AnnotateContainer, FramingScreen, OverlayScreen
7. [ ] Call `registerVideo()` from `useVideo.loadVideoFromStreamingUrl`
8. [ ] Add SW logging: `[SW] HIT/MISS hash range bytes timing`
9. [ ] Write Vitest unit tests for `handleVideoFetch`, `stripQueryParams`, `sliceCachedResponse`
10. [ ] **Measure after**: Run the SAME test protocol WITH the SW. Record all latencies in Progress Log as "after". Compare: backward seeks to previously-viewed positions should drop from 1-5s to <50ms. New-position seeks should be within 10ms of baseline (no regression).

### Progress Log

*(Record before/after measurements here)*

## Acceptance Criteria

- [ ] SW registers and intercepts video range requests (visible in DevTools Network tab as "ServiceWorker")
- [ ] Cache miss: response served from network, stored in Cache API. Latency within 10ms of pre-SW baseline.
- [ ] Cache hit: response served from Cache API. Latency <50ms (vs 1-5s baseline for same seek).
- [ ] `window.__seekPerf.cacheHitRate` > 0% after seeking to a previously-viewed position
- [ ] Presigned URL refresh doesn't invalidate cache (cache key is blake3 hash)
- [ ] Non-video requests (API calls, static assets) pass through unaffected
- [ ] No audio/video sync issues, no playback regressions
- [ ] Works in Chrome and Firefox. Safari: SW works but cache may be evicted after 7 days.
