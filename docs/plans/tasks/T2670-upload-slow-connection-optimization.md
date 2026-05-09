# T2670: Upload Performance for Slow Connections

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-05-08
**Updated:** 2026-05-08

## Problem

Users with slow connections (5-10 Mbps) experience failed uploads and poor progress feedback. The current upload system uses settings tuned for fast connections that punish slow ones:

- **100 MB parts**: On 5 Mbps, each part takes ~2.7 min. If it fails at 95%, user re-uploads 95 MB.
- **No retry**: A single network blip kills the entire upload.
- **Fixed concurrency (3)**: Saturates slow connections, causes timeouts.
- **Part saves batched every 3**: With 100 MB parts, that's 300 MB of progress lost on crash.

## Solution

Four targeted changes to the existing multipart upload system. No new infrastructure, no architectural changes.

### 1. Reduce Part Size: 100 MB -> 25 MB (Biggest Win)

**Backend only** (`games_upload.py:49`). Change `PART_SIZE` constant.

| Connection | 100 MB part | 25 MB part |
|-----------|------------|-----------|
| 5 Mbps | ~2.7 min/part | ~40s/part |
| 10 Mbps | ~80s/part | ~20s/part |
| Wasted on 95% failure | 95 MB | 23.75 MB |

R2 allows max 10,000 parts. At 25 MB, max file = 250 GB (well above our 10 GB limit). `generate_multipart_urls()` in `storage.py` uses the `part_size` passed from the router, so only the constant needs changing.

**Existing uploads in progress**: A pending upload created with 100 MB parts will resume with 100 MB parts (the presigned URLs are already generated). New uploads get 25 MB parts. No migration needed.

### 2. Per-Part Retry with Exponential Backoff

**Frontend only** (`uploadManager.js:108`, `uploadPart()` function).

Wrap the XHR call with retry logic:
- 3 retries max
- Exponential backoff: 1s, 2s, 4s
- Only retry on **network errors** (`xhr.onerror`) and **5xx** responses
- Do NOT retry on 4xx (expired presigned URL, bad request = real problems)
- On final failure after all retries, save completed parts to backend, then throw so the upload can resume later via the existing resume flow

Pseudo-implementation:
```javascript
async function uploadPartWithRetry(file, part, onProgress, faststartInfo, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await uploadPart(file, part, onProgress, faststartInfo);
    } catch (error) {
      const isRetryable = error.message.includes('network error') ||
                          error.message.match(/upload failed: 5\d\d/);
      if (!isRetryable || attempt === maxRetries) throw error;
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

### 3. Adaptive Concurrency

**Frontend only** (`uploadManager.js:180`, `uploadParts()` function).

Current: fixed `concurrency = 3`.

New behavior:
- Start with `concurrency = 2` (safe for slow connections)
- After the first 3 parts complete, calculate average throughput (bytes/sec)
- Adjust:
  - Throughput > 10 MB/s -> concurrency = 4
  - Throughput 2-10 MB/s -> concurrency = 2 (stay)
  - Throughput < 2 MB/s -> concurrency = 1
- Cap at max = 6
- Re-evaluate every 5 completed parts

Track throughput by recording `(end_byte - start_byte + 1) / elapsed_seconds` for each completed part and keeping a rolling average of the last 5.

### 4. Save Completed Parts After Every Part

**Frontend only** (`uploadManager.js:222`).

Change `SAVE_BATCH_SIZE` from 3 to 1. With 25 MB parts, the save request (~200 bytes JSON) is negligible overhead compared to the 25 MB part upload. Maximizes resume fidelity on crash.

## Context

### Relevant Files
- `src/backend/app/routers/games_upload.py` - `PART_SIZE` constant (line 49)
- `src/frontend/src/services/uploadManager.js` - `uploadPart()` (line 108), `uploadParts()` (line 180), `SAVE_BATCH_SIZE` (line 222)

### Related Tasks
- Built on top of original upload system (T80)
- Upload moov faststart (T1380) - unrelated, already shipped
- Gesture persistence during upload (T1540) - unrelated, already shipped

### Technical Notes
- The `generate_multipart_urls()` function in `storage.py` receives `part_size` as a parameter from the router. Changing the constant in `games_upload.py` is sufficient.
- Presigned URLs have 4-hour expiry. With 25 MB parts on a 5 Mbps connection, a 3 GB file = 120 parts x 40s = ~80 min. Well within the 4-hour window.
- The adaptive concurrency should not affect the existing `partProgress` tracking or the overall progress callback.

## Implementation

### Steps
1. [ ] Change `PART_SIZE` from 100 MB to 25 MB in `games_upload.py`
2. [ ] Add `uploadPartWithRetry()` wrapper in `uploadManager.js`
3. [ ] Replace `uploadPart()` calls with `uploadPartWithRetry()` in `uploadParts()`
4. [ ] Add throughput measurement to `uploadParts()` (rolling average)
5. [ ] Replace fixed concurrency with adaptive concurrency logic
6. [ ] Change `SAVE_BATCH_SIZE` from 3 to 1
7. [ ] Test: upload a 500 MB file with Chrome DevTools throttled to "Slow 3G"
8. [ ] Test: resume after killing upload mid-way

## Acceptance Criteria

- [ ] Part size is 25 MB for new uploads
- [ ] Failed parts retry up to 3 times with backoff before failing the upload
- [ ] Concurrency adjusts based on measured throughput
- [ ] Completed parts saved after every part (not batched)
- [ ] Existing resume flow still works
- [ ] No regressions on fast connections (throughput should be same or better)
