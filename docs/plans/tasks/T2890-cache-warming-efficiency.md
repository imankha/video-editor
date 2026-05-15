# T2890: Cache Warming Efficiency

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-05-15
**Updated:** 2026-05-15

## Problem

The cache warming system (`cacheWarming.js`) uses a single sequential worker that processes one video at a time across all queues (tier1, games, gallery, working). Each warm request takes ~100-350ms. This design was correct when users had 2-3 games, but doesn't scale:

| Queue | Current (8 games) | Projected (50 games) |
|-------|-------------------|---------------------|
| Games | 2.8s sequential | 17.5s sequential |
| Gallery | varies | grows with exports |
| Working | varies | grows with projects |
| **Total warming** | **5.3s** | **20-30s** |

**HAR evidence** (2026-05-15, `app.reelballers.com-annotate.har`): R2 game videos load one-by-one from 3.2s to 8.5s. Same game URL fetched up to 6 times. All queues drain through the single worker bottleneck.

Three root causes:

### 1. Single worker (sequential processing)
`worker()` (line 412-431) loops through `getNextItem()` one at a time. Comment says "R2 is HTTP/1.1, 6-socket limit" but this is overly conservative -- range requests complete in <350ms, connections are aborted immediately, socket slots free almost instantly. 3-4 concurrent workers would use <4 slots at any moment.

### 2. Duplicate URLs across queues
`/storage/warmup` returns game URLs, project clip URLs, gallery URLs, and working URLs. The same underlying video can appear in multiple lists. `warmedUrls` deduplicates across warmup calls but not within a single response's multiple lists.

### 3. No viewport awareness
All videos warm in backend response order regardless of what the user can see. The 6-8 visible game cards or gallery items should warm first; offscreen items can wait.

## Solution

Upgrade the warming system itself -- all queues benefit, not just games.

### 1. Concurrent workers (4 by default)

Replace single `worker()` call in `runWorkers()` with `Promise.all()` of N workers. `getNextItem()` is already synchronous, so concurrent workers safely share the priority queues with no race condition.

```javascript
const CONCURRENT_WORKERS = 4; // leaves 2 socket slots for foreground

async function runWorkers() {
  const workers = Array.from({ length: CONCURRENT_WORKERS }, () => worker());
  const results = await Promise.all(workers);
  return results.reduce((a, b) => a + b, 0);
}
```

Connection-aware adjustment via `navigator.connection?.effectiveType`:
- `4g` / unknown: 4 workers
- `3g`: 2 workers  
- `2g` / `slow-2g`: 1 worker

### 2. Cross-queue URL deduplication

In `warmAllUserVideos()`, normalize all URLs via `stableUrlKey()` (already exists, line 66) before queuing. Build a `Set` of all URLs across tier1/games/gallery/working and skip duplicates. This prevents the same game video from being warmed via both `game_urls` and `project_clips`.

### 3. Foreground abort signal

When `FOREGROUND_DIRECT` fires, `getNextItem()` returns `null` (existing behavior) preventing new fetches. But up to N workers may have in-flight fetches past the check. Add a module-level `AbortController` that all warm fetches share. When foreground priority fires, abort all in-flight warm fetches immediately -- frees sockets within milliseconds instead of waiting for current range requests to complete (~100-350ms).

```javascript
let warmingAbortController = new AbortController();

function abortAllWarming() {
  warmingAbortController.abort();
  warmingAbortController = new AbortController();
}

// In setWarmupPriority, when FOREGROUND_DIRECT:
abortAllWarming();
```

### 4. Viewport-aware queue promotion

Add `prioritizeUrls(urls)` export that moves matching items to the front of their respective queues. Callers (game list, gallery grid) use `IntersectionObserver` to detect visible items and call this when visibility changes.

This extends the existing `setWarmupPriority()` pattern -- that function picks which *queue* to drain; `prioritizeUrls()` picks which *items within a queue* to drain first.

```
Existing priority system (which queue):
  FOREGROUND_DIRECT > FOREGROUND_PROXY > tier1 > games/gallery > working

New within-queue priority (which items):
  visible items > offscreen items
```

## Context

### Relevant Files

All changes are in `src/frontend/src/utils/cacheWarming.js`:

| Section | Lines | What changes |
|---------|-------|-------------|
| `worker()` | 412-431 | No change (loop stays the same) |
| `runWorkers()` | 436-467 | Spawn N workers via Promise.all |
| `warmAllUserVideos()` | 472-550 | Deduplicate URLs across all lists before queuing |
| `warmUrl()` | 294-356 | Accept shared AbortController signal |
| `setWarmupPriority()` | 157+ | Abort in-flight fetches on FOREGROUND_DIRECT |
| `stableUrlKey()` | 66+ | Already exists, used for dedup |
| New export | - | `prioritizeUrls(urls)` for viewport callers |

Callers that would use `prioritizeUrls()`:
- `src/frontend/src/components/ProjectManager.jsx` - Game cards (line 723)
- `src/frontend/src/components/DownloadsPanel.jsx` - Gallery items (line 112, already sets priority)

### Existing tests
- `src/frontend/src/utils/cacheWarming.test.js` - Tests foreground abort, priority restore, clip range warming. Must pass after changes.

### Related Tasks
- T2040 Connection-Aware Cache Warming (DONE) -- split FOREGROUND_ACTIVE into proxy-aware vs direct modes
- T1890 Multi-Clip Cache Warming (DONE) -- priority-based clip warming, tier1 queue
- T1410 Video Load Regression (DONE) -- warmer aborts on foreground load, StrictMode dedup
- T2880 Backend Presigned URL Cache (TODO) -- cuts `/storage/warmup` response time; warming starts faster

## Implementation

### Steps

1. [ ] Deduplicate URLs in `warmAllUserVideos()`: normalize with `stableUrlKey()`, skip duplicates across all lists
2. [ ] Add module-level `AbortController` shared by all warm fetches; abort on `FOREGROUND_DIRECT`
3. [ ] Change `runWorkers()` to spawn `CONCURRENT_WORKERS` (4) via `Promise.all()`
4. [ ] Add connection-aware concurrency reduction for slow networks
5. [ ] Add `prioritizeUrls(urls)` export for viewport-aware callers
6. [ ] Add `IntersectionObserver` in `ProjectManager.jsx` game list to call `prioritizeUrls()`
7. [ ] Update existing tests; add tests for concurrent workers and dedup
8. [ ] HAR verification: confirm parallel R2 fetches, no duplicates

## Acceptance Criteria

- [ ] HAR shows 3-4 concurrent R2 range requests (not sequential)
- [ ] No duplicate R2 fetches for the same video URL within a warmup cycle
- [ ] 8 games warm in < 1.5s (down from 5.3s)
- [ ] 50 games warm in < 6s (down from projected 17.5s)
- [ ] Visible game videos warm within 1s of warmup start
- [ ] `FOREGROUND_DIRECT` immediately aborts all in-flight warm fetches (< 50ms to free sockets)
- [ ] Foreground video loading is never blocked by background warming
- [ ] All existing `cacheWarming.test.js` tests pass
- [ ] No increase in R2 socket exhaustion errors
- [ ] Slow connection (3g/2g) reduces concurrency automatically
