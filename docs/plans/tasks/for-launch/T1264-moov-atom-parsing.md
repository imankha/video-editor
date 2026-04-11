# T1264: Moov Atom Parsing for Precise Cache Warming

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-09
**Updated:** 2026-04-09
**Parent:** T1260
**Depends on:** T1261 (need instrumentation), T1262 (SW caches the warmed ranges)

## Problem

`cacheWarming.js` estimates byte ranges proportionally:
```javascript
startByte = (startTime / videoDuration) * videoSize
```

This assumes constant bitrate. VEO game footage varies: a static wide shot might be 2 Mbps while a close-up goal celebration is 8 Mbps. For a 90-min video, the estimate can be **50-100+ MB off** from the actual byte position. Cache warming fetches the wrong bytes, so the browser still hits the network on seek.

## Solution

Parse the MP4 moov atom (the file's table of contents) to get exact timestamp-to-byte mappings. Replace proportional estimation with precise lookups.

### How it works

```
1. cacheWarming starts warming a game video
2. First: fetch bytes 0-5MB (range request) — the moov atom for faststart MP4s
3. Feed bytes to mp4box.js → parses sample table (stts, stco, stsz)
4. Result: for every frame, we know its exact byte offset and size

5. warmClipRange(url, startTime=2052, endTime=2082, ..., hash)
   Before: (2052/6108) * 3,456,126,194 = byte 1,161,000,000  (WRONG)
   After:  index.getByteRange(2052, 2082) = byte 1,043,291,648  (EXACT)
```

### What the moov atom contains

Every MP4 file has a moov atom — a binary index structure:

| Table | Contents | What it tells us |
|-------|----------|-----------------|
| `stts` | Sample-to-time | Which frame is at which timestamp |
| `stco`/`co64` | Chunk offset | Byte position of each chunk of frames |
| `stsz` | Sample size | Byte size of each individual frame |
| `stss` | Sync sample | Which frames are keyframes (I-frames) |

Together: "frames from 34:12 to 34:42 live at bytes 1,043,291,648 - 1,048,019,776" — with precision.

## How to prove it works

### Accuracy measurement

**Test protocol: compare estimated vs actual byte offsets**

1. Pick 5 timestamps spread across a 90-min VEO game (e.g., 5:00, 20:00, 45:00, 60:00, 80:00)
2. For each, log both:
   - Proportional estimate: `(timestamp / duration) * fileSize`
   - Moov-parsed actual: `index.getByteRange(timestamp, timestamp + 30)`
3. Calculate the error: `|estimated - actual|` in MB
4. Log as:
```
[VideoIndex] Accuracy test for video:abc123
  05:00 → proportional: 142MB, actual: 128MB, error: 14MB (10%)
  20:00 → proportional: 568MB, actual: 491MB, error: 77MB (14%)
  45:00 → proportional: 1278MB, actual: 1043MB, error: 235MB (18%)
  60:00 → proportional: 1704MB, actual: 1612MB, error: 92MB (5%)
  80:00 → proportional: 2272MB, actual: 2198MB, error: 74MB (3%)
```

If errors are consistently >20 MB, moov parsing is clearly justified. If errors are <5 MB, proportional estimation is "good enough" and this subtask has lower value.

**This test runs automatically** when `buildVideoIndex()` is called — it logs the comparison as part of the index-building process.

### Impact on cache warming effectiveness

With T1262 (SW cache) already in place, warmed ranges are cached locally. So precise warming → correct bytes cached → cache hits when the user seeks to those positions.

**Test protocol:**
1. Load a game in Annotate with a project that has 3 clips at varied timestamps
2. Let cache warming run (uses moov-parsed byte ranges)
3. Before touching the video, check SW cache stats — should show cached ranges at the clip positions
4. Seek to each clip's timestamp — should be cache HITs
5. Compare with T1262 results where warming used proportional estimation — the hit rate should be higher

### Playwright-driven measurement

The accuracy comparison is logged to console by `buildVideoIndex`. The Playwright test captures these via `consoleLogs`:

**Before (run seek-perf test with T1262 active):**
```bash
cd src/frontend && npx playwright test e2e/seek-perf.spec.js 2>&1 > /tmp/seek-perf.log; echo "exit: $?"
cp test-results/seek-perf-results.json test-results/seek-perf-before-T1264.json
```

**After:**
```bash
cd src/frontend && npx playwright test e2e/seek-perf.spec.js 2>&1 > /tmp/seek-perf.log; echo "exit: $?"
cp test-results/seek-perf-results.json test-results/seek-perf-after-T1264.json
reduce_log({ file: "/tmp/seek-perf.log", tail: 200, grep: "VideoIndex|CacheWarming" })
```

**What to look for in consoleLogs:**
- `[VideoIndex] Accuracy test` lines showing proportional vs actual byte offsets at 5 positions
- `[CacheWarming] Exact range` vs `[CacheWarming] Proportional estimate` — how many clips used each method
- If all errors are <5 MB → report as marginal improvement, recommend skipping T1265

**Note:** This subtask's impact on seek latency may be indirect — warming happens at startup, not during the test. The primary proof is the accuracy log showing moov-parsed ranges are more accurate.

### Vitest unit tests

- **`buildVideoIndex` unit test**: Feed a small test MP4 file (create a 10-second fixture) to mp4box.js, verify `getByteRange(5, 6)` returns plausible byte offsets
- **`getByteRange` with known index**: Construct a `VideoIndex` from known sample data, verify byte range calculation matches expected values
- **Fallback test**: When `buildVideoIndex` is given a bad URL, it returns null. Verify `warmClipRange` falls back to proportional estimation.

## File Changes

### New: `src/frontend/src/utils/videoIndex.js`

| Function | Description |
|----------|-------------|
| `buildVideoIndex(url, fileSize)` | Fetch moov atom via range request (bytes 0-5MB). Feed to `MP4Box.createFile().appendBuffer()`. On `onReady`, extract video track's sample table. Construct and return a `VideoIndex` instance. Cache in `indexCache` Map keyed by URL path (stripped). On failure (network error, parse error, non-faststart), log warning and return `null`. |
| `VideoIndex` constructor | Takes mp4box.js track info. Extracts sample entries: `[{timestamp, byteOffset, size, isKeyframe}]`. Sorts by timestamp for binary search. |
| `VideoIndex.getByteRange(startTime, endTime)` | Binary-search for first sample at/before `startTime`. Walk backward to nearest preceding keyframe (needed for decodable data). Find last sample at/after `endTime`. Return `{startByte, endByte, keyframeTime}`. |
| `VideoIndex.getKeyframeTimes()` | Return array of all keyframe timestamps. Useful for future keyframe-snapping features. |
| `VideoIndex.logAccuracyComparison(fileSize, duration)` | For 5 evenly-spaced timestamps, log proportional estimate vs actual byte offset. Called once during `buildVideoIndex` to quantify the improvement. |
| `indexCache` (module Map) | `Map<urlPath, VideoIndex>`. Prevents re-fetching and re-parsing the moov atom for the same video within a session. |

### Modified: `src/frontend/src/utils/cacheWarming.js`

| Function | Change |
|----------|--------|
| `warmClipRange(url, startTime, endTime, videoDuration, videoSize)` | **Add `blake3Hash` parameter.** If hash provided, call `buildVideoIndex(url, videoSize)`. If index returned, use `index.getByteRange(startTime, endTime)` for exact `warmStart`/`warmEnd`. If index is null, fall back to current proportional math (zero breakage). Log which method was used: `[CacheWarming] Exact range` vs `[CacheWarming] Proportional estimate`. |
| `warmAllUserVideos()` | **Thread `blake3_hash` through queue items.** When populating `tier1Queue` from `data.project_clips`, include `blake3Hash` from the backend response. When populating `gamesQueue`, include `blake3Hash`. |
| `worker(workerId)` | **Pass `blake3Hash` to `warmClipRange`.** Already passes `item.*` properties — just ensure `blake3Hash` is in the item. |

### Modified: `src/backend/app/routers/storage.py`

| Endpoint | Change |
|----------|--------|
| `GET /storage/warmup` | Add `blake3_hash` field to each game object in the response. Currently returns `[{url, size}]` for games. Change to `[{url, size, blake3_hash}]`. The hash is already in the games table — just include it in the query. |

### Modified: `src/frontend/package.json`

| Dependency | Why |
|-----------|-----|
| `mp4box` | Parse moov atoms client-side. ~80 KB minified. Use dynamic import (`import('mp4box')`) in `buildVideoIndex` so it's not in the initial bundle. |

## Implementation

### Steps
1. [ ] **Measure before (warming accuracy)**: With T1262 active, create a project with 3 clips at varied timestamps (e.g., 10:00, 35:00, 70:00). Let cache warming run (proportional estimation). Then seek to each clip timestamp. Record from `window.__seekPerf`: how many are cache HITs vs MISSes. Record in Progress Log. These will likely be MISSes because proportional estimation warmed the wrong byte ranges.
2. [ ] Add `mp4box` dependency
3. [ ] Create `videoIndex.js` with `buildVideoIndex()`, `VideoIndex` class, accuracy logging
4. [ ] Write Vitest tests for `VideoIndex.getByteRange()` with mock sample data
5. [ ] Update `GET /storage/warmup` to include `blake3_hash` per game
6. [ ] Update `cacheWarming.js`: thread `blake3Hash`, use `buildVideoIndex` in `warmClipRange`
7. [ ] **Measure accuracy**: Load a game, check console for the automatic accuracy comparison log (proportional vs actual byte offsets at 5 timestamps). Record error margins in Progress Log. If errors are consistently <5 MB, this subtask has lower value than expected — document and decide whether to keep.
8. [ ] **Measure after (warming effectiveness)**: Repeat step 1 — same 3 clips, fresh session, let moov-based warming run. Seek to each clip timestamp. Record cache HIT/MISS results. Compare with step 1. Hit rate should be higher because warming now fetches the correct byte ranges.

### Progress Log

*(Record accuracy comparison results here)*

## Acceptance Criteria

- [ ] Moov atom fetched with a single range request (0-5MB) — no full file download
- [ ] Accuracy log shows estimated vs actual byte offsets for 5 timestamps
- [ ] Proportional estimation error is >20 MB for at least some positions (validates the need)
- [ ] Cache warming uses exact byte ranges when moov parsing succeeds
- [ ] Fallback to proportional estimation works when moov parsing fails (no breakage)
- [ ] Parsed index is cached in memory — second call for same video is instant (no re-fetch)
- [ ] mp4box.js is dynamically imported (not in initial bundle)
