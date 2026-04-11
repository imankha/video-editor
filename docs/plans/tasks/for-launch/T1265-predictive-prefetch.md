# T1265: Predictive Prefetch in Annotate

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-09
**Updated:** 2026-04-09
**Parent:** T1260
**Depends on:** T1262 (SW cache to store prefetched data), T1264 (moov index for byte range calculation)

## Problem

T1262 makes **repeat** seeks instant (cache hit). But **first-visit forward seeks** still hit the network. In Annotate, the user mostly watches sequentially and occasionally jumps forward — if we prefetch the next 30s of data ahead of the playhead, those forward jumps become cache hits too.

## Solution

The main thread tells the SW where the playhead is. The SW proactively fetches the next 30 seconds of video data in the background, using the moov index (T1264) to know the exact byte range.

### How it works

```
1. User is watching at 34:00 (sequential playback)
2. useVideo timeupdate fires → throttled to every 5s
3. Main thread → SW: { type: 'PLAYHEAD_UPDATE', hash: 'abc123', currentTime: 2040 }
4. SW calculates: "Do I have bytes for 2040-2070 cached?"
   - Checks moov index: frames 2040-2070 = bytes 1,043,000,000 - 1,060,000,000 (17MB)
   - Checks cache: only have up to 1,050,000,000
   - Issues background fetch for bytes 1,050,000,000 - 1,060,000,000
5. User seeks forward to 34:45 → cache HIT (data was prefetched)
```

**Cancellation:** If user randomly seeks to 67:00, SW cancels the in-flight prefetch for the 34:00 region and starts prefetching from 67:00 instead.

**Bandwidth guard:** Prefetch only runs when no active range requests are in-flight for this video (checked via a counter in the SW). This prevents prefetch from competing with the browser's own buffering.

## How to prove it works

### Playwright-driven measurement

The `e2e/seek-perf.spec.js` test already covers this scenario: it plays 10 seconds, then seeks to 30s (`forward-near`). With prefetch active, the SW should have pre-fetched data for 10-40s during the 10s of playback.

**Before (run with T1262+T1264 but no prefetch):**
```bash
cd src/frontend && npx playwright test e2e/seek-perf.spec.js 2>&1 > /tmp/seek-perf.log; echo "exit: $?"
cp test-results/seek-perf-results.json test-results/seek-perf-before-T1265.json
```

**After:**
```bash
cd src/frontend && npx playwright test e2e/seek-perf.spec.js 2>&1 > /tmp/seek-perf.log; echo "exit: $?"
cp test-results/seek-perf-results.json test-results/seek-perf-after-T1265.json
reduce_log({ file: "/tmp/seek-perf.log", tail: 200, grep: "SeekPerfTest|Prefetch" })
```

**What to compare:**

| Metric | In JSON as | Before T1265 | After T1265 |
|--------|-----------|-------------|-------------|
| Forward seek (30s) | `results[1].totalLatencyMs` (`forward-near`) | 1-5s | <50ms (prefetched) |
| Forward seek source | `results[1].source` | `network` | `sw-cache` |
| Random midpoint | `results[2].totalLatencyMs` | same | same (beyond prefetch window) |

**SW-specific signals in consoleLogs:**
```
[SW] Prefetch: video:abc123 fetching 10-40s (bytes ...MB-...MB, ~17MB)
[SW] Prefetch: complete in 2.1s
```

If no `[SW] Prefetch` lines appear, the playhead update messages aren't reaching the SW — check `updatePlayhead` wiring.

### Vitest unit tests

- **Prefetch trigger logic**: Given playhead at T and cache coverage up to T+10s, verify prefetch request covers T+10s to T+30s
- **Cancellation**: Send two `PLAYHEAD_UPDATE` messages 1s apart with different positions. Verify first prefetch was aborted (AbortController.signal.aborted === true).
- **Bandwidth guard**: Set active fetch count > 0, send `PLAYHEAD_UPDATE`, verify no prefetch issued.

## File Changes

### Modified: `src/frontend/src/hooks/useVideo.js`

| Function | Change |
|----------|--------|
| `handleTimeUpdate()` (or RAF update loop) | **Throttled prefetch signal.** Every 5 seconds of playback, call `updatePlayhead(blake3Hash, currentTime)`. Only when `clipRange` is null (Annotate mode — Framing clips are too short for prefetch to matter). Use a ref to track last-reported time and skip if delta < 5s. |

### Modified: `src/frontend/src/utils/swRegistration.js`

| Function | Change |
|----------|--------|
| `updatePlayhead(blake3Hash, currentTime)` | New function. Send `{type: 'PLAYHEAD_UPDATE', hash, currentTime}` to SW. Called from useVideo every 5s during playback. |

### Modified: `src/frontend/public/sw.js`

| Function | Change |
|----------|--------|
| `message` event | Handle `PLAYHEAD_UPDATE`: call `prefetchAhead(hash, currentTime)`. |
| `prefetchAhead(hash, currentTime)` | New function. Uses moov index (stored when `REGISTER_VIDEO` was received with index data) to calculate byte range for `currentTime` to `currentTime + 30s`. Check which portion of that range is already cached. Fetch the uncached portion with an `AbortController`. Store `currentAbortController` to cancel on next call. Track in-flight fetch count to skip if browser is actively fetching. |
| `handleVideoFetch` | Increment/decrement `activeFetchCount[hash]` around network fetches. Prefetch checks this counter and skips if > 0. |

### Modified: `src/frontend/src/utils/videoIndex.js`

| Function | Change |
|----------|--------|
| `VideoIndex.serialize()` | New method. Serialize the index to a transferable format (compact JSON or ArrayBuffer) for sending to the SW via postMessage. The SW needs the index to calculate prefetch byte ranges. |

### Modified: `src/frontend/src/utils/swRegistration.js`

| Function | Change |
|----------|--------|
| `registerVideo(url, blake3Hash, moovIndex)` | **Add optional `moovIndex` parameter.** If provided, include serialized index in the `REGISTER_VIDEO` message. The SW stores it for prefetch calculations. Called after `buildVideoIndex` completes in cacheWarming. |

## Implementation

### Steps
1. [ ] **Measure before**: Run test protocol with T1262 active (no prefetch). Record forward-seek latencies. Document in Progress Log.
2. [ ] Add `VideoIndex.serialize()` and update `registerVideo()` to accept moov index
3. [ ] Add `updatePlayhead()` to swRegistration.js
4. [ ] Add throttled `updatePlayhead()` call in useVideo.js timeupdate/RAF loop
5. [ ] Implement `prefetchAhead()` in sw.js with AbortController cancellation
6. [ ] Add `activeFetchCount` tracking in `handleVideoFetch` for bandwidth guard
7. [ ] **Measure after**: Run same test protocol. Record forward-seek latencies. Compare with before.
8. [ ] Write Vitest tests for prefetch trigger logic, cancellation, bandwidth guard

### Progress Log

*(Record before/after measurements here)*

## Acceptance Criteria

- [ ] Forward seeks within 30s of playhead are cache hits (<50ms) after 5s of playback
- [ ] Forward seeks beyond 30s are unaffected (still network)
- [ ] Random seeks cancel in-flight prefetch (no wasted bandwidth)
- [ ] Prefetch doesn't compete with active playback buffering
- [ ] Prefetch only active in Annotate mode (no clipRange), not in Framing
- [ ] Measurable improvement in forward-seek latency vs T1262-only baseline
