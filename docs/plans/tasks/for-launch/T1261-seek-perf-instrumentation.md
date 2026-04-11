# T1261: Seek Performance Instrumentation

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-04-09
**Updated:** 2026-04-09
**Parent:** T1260

## Problem

We can't prove any optimization helped without measuring seek latency before and after. Currently there's no instrumentation — we just "feel" that seeks are slow. We need hard numbers.

## Solution

Add lightweight performance measurement to the video pipeline that logs every seek with timing breakdowns. This gives us:
1. A **baseline** of current seek latency across real usage
2. An **ongoing metric** that proves (or disproves) each subsequent subtask's impact
3. A **regression detector** if future changes make things worse

### What to measure

For every seek event, capture:

```
Seek #14 to 34:12.5
  Request → First Byte:  1,240ms  (network latency + R2 cold cache)
  First Byte → Decode:     180ms  (keyframe decode time — GOP dependent)
  Total Seek Latency:    1,420ms
  Source: network          (vs "sw-cache" after T1262)
  Bytes fetched: 1.4MB    (range size)
```

### How to measure

**`useVideo.js` timing points:**

| Event | What it means | How to capture |
|-------|--------------|----------------|
| `seek()` called | User initiated seek | `performance.now()` at top of `seek()` |
| `handleSeeking` fires | Browser started seeking in the `<video>` element | `performance.now()` in handler |
| `handleSeeked` fires | Browser decoded the target frame | `performance.now()` in handler |
| `handleWaiting` fires | Browser stalled waiting for data | Marks a "buffering" period within the seek |
| `handleCanPlay` fires | Enough data buffered to resume | End of buffering period |

The key metric is **seek-to-frame time**: `performance.now()` delta from `seek()` call to `handleSeeked` event.

**Service Worker timing (for T1262+):**

Once the SW exists, it can add a `X-Cache-Status` header to responses (`hit` or `miss`) and a `X-Cache-Time` header (ms spent in SW). The main thread reads these from the `<video>` element's resource timing entries via `PerformanceObserver`.

### Output format

Log to console with a structured prefix so we can filter:

```
[SeekPerf] seek=14 target=2052.5s latency=1420ms network=1240ms decode=180ms source=network bytes=1.4MB
```

Also accumulate a session summary accessible via `window.__seekPerf`:

```javascript
window.__seekPerf = {
  seeks: [...],           // Array of all seek events with timing
  avgLatency: 1350,       // Running average in ms
  p95Latency: 2100,       // 95th percentile
  cacheHitRate: 0,        // 0% before T1262, should climb after
  totalSeeks: 14,
}
```

This lets us check metrics from DevTools console at any time during a session.

## How to prove it works

**Playwright E2E test: `e2e/seek-perf.spec.js`**

This test already exists. It loads a game in Annotate, performs 6 standardized seeks, reads `window.__seekPerf`, takes screenshots, and writes results to `test-results/seek-perf-results.json`.

Before T1261, the test skips (`window.__seekPerf` doesn't exist). After T1261, it produces real data. Run it:

```bash
cd src/frontend && npx playwright test e2e/seek-perf.spec.js 2>&1 > /tmp/seek-perf.log; echo "exit: $?"
```

Read results:
```bash
reduce_log({ file: "/tmp/seek-perf.log", tail: 200, grep: "SeekPerfTest" })
```

Check screenshots (verify video frame rendered, not black):
```bash
ls src/frontend/test-results/seek-perf-*.png
```

Save this output as the baseline for all subsequent subtasks:
```bash
cp src/frontend/test-results/seek-perf-results.json src/frontend/test-results/seek-perf-before-T1262.json
```

**Vitest unit test** for `createSeekPerfTracker`:
- Feed mock event sequence (startSeek → onSeeking → onWaiting → onCanPlay → onSeeked)
- Verify correct latency calculation, source detection, and accumulator stats

**Expected baseline values (VEO, 3GB, streaming from R2):**
- Cold seek (never-visited position): 1-5s
- Warm seek (recently buffered by browser): 100-500ms
- Sequential playback stall: rare (browser buffers ahead)

## File Changes

### `src/frontend/src/hooks/useVideo.js`

| Function | Change |
|----------|--------|
| `seek(time)` | Record `performance.now()` as `seekStartTime` in a ref. Increment seek counter. |
| `handleSeeking()` | Record `performance.now()` as `seekingStartTime`. |
| `handleSeeked()` | Calculate total latency (`now - seekStartTime`), decode time (`now - seekingStartTime`), network time (total - decode). Log structured `[SeekPerf]` line. Push to `seekPerfLog` array. Update running averages on `window.__seekPerf`. |
| `handleWaiting()` | Record buffering start time. |
| `handleCanPlay()` | Record buffering end time, accumulate buffering duration for current seek. |
| New: `seekPerfRef` | useRef holding `{seekStartTime, seekingStartTime, bufferingStart, seekCount}`. Reset per seek. |

### `src/frontend/src/utils/seekPerf.js` (new)

| Function | Description |
|----------|-------------|
| `createSeekPerfTracker()` | Returns tracker object with `startSeek()`, `onSeeking()`, `onSeeked()`, `onWaiting()`, `onCanPlay()` methods. Encapsulates all timing logic outside of useVideo. |
| `getSeekPerfSummary()` | Returns `{avgLatency, p95Latency, cacheHitRate, totalSeeks, seeks}` from accumulated data. Exposed via `window.__seekPerf`. |
| `recordSeek(entry)` | Push a seek entry to the log. Entry: `{seekId, targetTime, totalLatencyMs, networkMs, decodeMs, source, bytesTransferred, timestamp}`. |

## Implementation

### Steps
1. [ ] Create `seekPerf.js` with `createSeekPerfTracker()` and `window.__seekPerf` exposure
2. [ ] Integrate tracker into `useVideo.js` — hook into seek/seeked/waiting/canplay events
3. [ ] Write Vitest unit test for `createSeekPerfTracker` (mock event sequence → correct latency calculation)
4. [ ] Verify the Playwright test user (`e2e_seekperf_stable`) has a game video — set up if needed
5. [ ] Run `npx playwright test e2e/seek-perf.spec.js` — should now produce real timing data instead of skipping
6. [ ] Read `test-results/seek-perf-results.json` — verify all 6 seeks have timing data
7. [ ] Check screenshots — verify video frames rendered (not black)
8. [ ] Save as baseline: `cp test-results/seek-perf-results.json test-results/seek-perf-before-T1262.json`
9. [ ] Record key numbers in Progress Log below

### Progress Log

*(Record baseline measurements here after implementation)*

## Acceptance Criteria

- [ ] Every seek logs a `[SeekPerf]` line to console with latency breakdown
- [ ] `window.__seekPerf` returns session summary (avg, p95, count, hit rate)
- [ ] No visible UI change — purely diagnostic
- [ ] <1ms overhead per seek (just `performance.now()` calls)
- [ ] Baseline measurements recorded for comparison with T1262+
