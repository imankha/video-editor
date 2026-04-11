# T1263: Service Worker Quota Management

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-04-09
**Updated:** 2026-04-09
**Parent:** T1260
**Depends on:** T1262

## Problem

T1262 caches video data locally but never evicts it. Game videos are 1-3 GB each. After caching 5-10 games, we could fill 15-30 GB of storage. Without quota management, the browser will eventually refuse to cache or evict unpredictably.

## Solution

Track cached video sizes and evict least-recently-accessed videos when approaching the storage quota limit.

### How it works

```
1. After each cache.put() in SW, update a size tracker in IndexedDB:
   video:abc123 → { bytes: 47200000, lastAccessed: 1712678400000 }

2. After each cache hit, update lastAccessed timestamp

3. Periodically (every 10th cache write), check quota:
   const {usage, quota} = await navigator.storage.estimate()
   if (usage / quota > 0.8) → evict oldest video

4. Eviction: delete cache entry + remove IndexedDB tracking record
   Log: [SW] Evicted video:def456 (2.8GB, last accessed 3 days ago)
```

## How to prove it works

**Test protocol:**
1. Load 3 different game videos in Annotate (switching games)
2. Check `getCacheStats()` — should show 3 videos with sizes
3. Manually trigger eviction (lower threshold to 1% for testing, or call eviction directly)
4. Verify oldest video is evicted, newest two remain
5. Verify evicted video's data is gone from Cache Storage (DevTools → Application → Cache Storage)
6. Load the evicted game again — should be a cache miss (network fetch), confirming eviction worked

**Automated test (Vitest):**
- Mock `navigator.storage.estimate()` to return high usage
- Call `manageQuota()` with mock cache entries
- Verify it deletes the entry with oldest `lastAccessed`
- Verify it stops evicting once under threshold

## File Changes

### Modified: `src/frontend/public/sw.js`

| Function | Description |
|----------|-------------|
| `trackCacheWrite(hash, bytes)` | After `cache.put()`, write `{hash, bytes, lastAccessed: Date.now()}` to IndexedDB store `cache-meta`. Update if exists (add bytes to existing total). |
| `trackCacheAccess(hash)` | After cache hit, update `lastAccessed` in IndexedDB. |
| `manageQuota()` | Check `navigator.storage.estimate()`. If `usage/quota > 0.8`, query IndexedDB for all tracked videos sorted by `lastAccessed` ascending, delete oldest until under 70%. Log each eviction. |
| `handleVideoFetch` | After cache write, increment a counter. Every 10th write, call `manageQuota()`. After cache hit, call `trackCacheAccess()`. |

### Modified: `src/frontend/src/utils/swRegistration.js`

| Function | Description |
|----------|-------------|
| `getCacheStats()` | Send `GET_CACHE_STATS` to SW, await response. Returns `{totalBytes, videoCount, quotaUsage, videos: [{hash, bytes, lastAccessed}]}`. Useful for debugging and UI display. |

## Implementation

### Steps
1. [ ] Add IndexedDB `cache-meta` store in SW (open on activate)
2. [ ] Add `trackCacheWrite()` and `trackCacheAccess()` to SW cache operations
3. [ ] Implement `manageQuota()` with LRU eviction
4. [ ] Wire into `handleVideoFetch` (track after write, check quota periodically)
5. [ ] Add `getCacheStats()` to swRegistration.js
6. [ ] **Prove it**: Load 3 games, verify cache stats, trigger eviction, verify oldest removed

### Progress Log

*(empty)*

## Acceptance Criteria

- [ ] `getCacheStats()` returns accurate byte counts per cached video
- [ ] Videos evicted in LRU order when quota > 80%
- [ ] Current game's cache is never evicted (most recently accessed)
- [ ] Eviction logged in console with video hash, size, and age
