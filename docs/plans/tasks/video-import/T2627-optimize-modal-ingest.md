# T2627: Optimize Modal Video Ingest Performance

**Status:** TESTING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-05-07
**Updated:** 2026-05-07

## Problem

T2625 moved video ingest to Modal. Testing shows the fresh-upload path for a 3GB Veo video takes **5.5 minutes**. Breakdown from the test run:

| Phase | Duration | Notes |
|-------|----------|-------|
| Download (Veo CDN → Modal disk) | ~1 min | Datacenter bandwidth, hard floor |
| blake3 hash (3GB file read) | ~15-20s | Redundant — file was just written to disk |
| Multipart upload (31 × 100MB parts, sequential) | ~4 min | Biggest bottleneck |
| **Total** | **~5.5 min** | |

Two issues:
1. **Redundant file read**: For direct downloads (Veo), we download the file to disk, then read the entire file again to compute blake3. We already had every byte in memory during download.
2. **Sequential uploads**: 31 parts uploaded one at a time. Each part waits for the previous to complete before starting.

## Solution

Two optimizations targeting **~2 min total** (down from 5.5 min):

### Optimization 1: Hash During Download (~15-20s saved)

For `source_type="direct"` (Veo), compute blake3 incrementally as chunks arrive during the HTTP download. By the time the file is fully written to disk, we already know the hash.

**Before:**
```
download 3GB to disk  →  read 3GB from disk (blake3)  →  upload
        ~1 min                    ~15-20s                  ~4 min
```

**After:**
```
download 3GB to disk + blake3 on each chunk  →  upload
                  ~1 min                          ~4 min → optimized
```

**Scope:** Only applies to `source_type="direct"`. HLS/Trace uses ffmpeg as a subprocess writing to a file — we can't intercept the byte stream, so hash-after-download remains the correct approach for HLS.

**Implementation in `ingest_video_to_r2()`:**
```python
# Before (two passes):
with open(local_path, "wb") as f:
    for chunk in resp.iter_bytes(...):
        f.write(chunk)
# ... later ...
with open(local_path, "rb") as f:
    while data := f.read(100MB):
        hasher.update(data)

# After (single pass):
hasher = blake3.blake3()
with open(local_path, "wb") as f:
    for chunk in resp.iter_bytes(...):
        f.write(chunk)
        hasher.update(chunk)
blake3_hash = hasher.hexdigest()
# Skip the separate hash step entirely
```

### Optimization 2: Parallel Multipart Upload (~3 min saved)

Upload multiple 100MB parts concurrently using `ThreadPoolExecutor`. R2 supports concurrent multipart uploads — parts can arrive in any order as long as the `complete_multipart_upload` call lists them in order.

**Before:** 31 parts × ~8s each = ~4 min (sequential)
**After:** 31 parts / 4 threads × ~8s = ~1 min (parallel)

**Implementation in `ingest_video_to_r2()`:**
```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def upload_part(part_number, data):
    resp = r2.upload_part(
        Bucket=bucket, Key=final_key,
        UploadId=upload_id, PartNumber=part_number,
        Body=data,
    )
    return {"PartNumber": part_number, "ETag": resp["ETag"]}

# Read all chunks first, submit uploads in parallel
chunks = []
with open(local_path, "rb") as f:
    while data := f.read(part_size):
        chunks.append(data)

with ThreadPoolExecutor(max_workers=4) as executor:
    futures = {
        executor.submit(upload_part, i + 1, chunk): i + 1
        for i, chunk in enumerate(chunks)
    }
    parts = []
    for future in as_completed(futures):
        parts.append(future.result())

# Sort by PartNumber for complete_multipart_upload
parts.sort(key=lambda p: p["PartNumber"])
r2.complete_multipart_upload(...)
```

**Memory consideration:** For a 3GB file with 100MB parts, all 31 chunks are in memory simultaneously (~3.1GB). Modal containers have 4GB memory. Options:
- Bump Modal memory to 8GB (`memory=8192`) — safest, ~$0.001 extra per run
- Use a sliding window (only keep N chunks in memory at a time) — more complex
- Increase part size to 200MB (fewer parts, fewer concurrent uploads) — simple

Recommended: bump memory to 8GB. The ingest function runs for minutes; the extra memory cost is negligible.

### Container Resource Adjustment

Bump from 2 vCPU / 4GB to **4 vCPU / 8GB**:
- 4 vCPUs supports 4 concurrent upload threads without contention
- 8GB memory holds the full file in memory for parallel upload
- Cost increase is minimal for a function that runs ~2 min per invocation

```python
@app.function(
    image=ingest_image,
    cpu=4,       # was 2
    memory=8192, # was 4096
    timeout=3600,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
```

### Progress Reporting

Currently progress during upload is per-part sequential. With parallel uploads, progress needs to track total completed parts:

```python
completed_parts = 0
total_parts = len(chunks)
for future in as_completed(futures):
    parts.append(future.result())
    completed_parts += 1
    pct = 70 + int((completed_parts / total_parts) * 25)
    yield {"progress": pct, "phase": "uploading", "message": f"Uploading... {completed_parts}/{total_parts} parts"}
```

**Problem:** Can't `yield` from inside the `ThreadPoolExecutor` context since yields must happen in the generator's own thread. Solution: collect results, yield progress after each `as_completed` iteration (which does happen in the main thread).

## Scope

**Stack Layers:** Backend + Modal
**Files Affected:** 2 files
**LOC Estimate:** ~40 lines changed
**Test Scope:** Backend (integration test via Modal)

## Relevant Files

- `src/backend/app/modal_functions/video_processing.py` — `ingest_video_to_r2()` function
- `src/backend/app/services/local_processors.py` — `local_ingest()` function (same optimizations for consistency)

## Testing

### Regression Test
Run existing tests to verify correctness:
```bash
cd src/backend && MODAL_ENABLED=true .venv/Scripts/python.exe -m pytest tests/test_modal_ingest.py -v -s
```

Must verify:
- blake3 hash matches previous value (same file → same hash, proves hash-during-download is correct)
- Dedup detection still works (hash computed correctly before dedup check)
- Fresh upload produces a valid R2 object
- Both Veo (direct) and Trace (HLS) paths work

### Performance Test
Compare before/after for Veo fresh upload:
1. Delete R2 object for the test Veo video
2. Run `TestModalVeoIngest::test_veo_dedup_then_fresh`
3. Record total time for fresh upload pass
4. **Target: ~2 min** (down from 5.5 min)

### Expected Results

| Metric | Before (T2625) | After (T2627) |
|--------|----------------|---------------|
| Veo 3GB fresh upload | ~5.5 min | ~2 min |
| Trace 1.2GB fresh upload | ~3 min | ~1.5 min |
| Veo dedup | instant | instant (no change) |
| Hash correctness | baseline | must match baseline |

## Risks

- **Memory pressure**: Loading 3GB into memory for parallel upload. Mitigated by bumping to 8GB.
- **R2 rate limiting**: 4 concurrent uploads per multipart. R2 docs don't mention per-upload rate limits; tested implicitly by other tools. Low risk.
- **Progress granularity**: `yield` inside `as_completed` loop works because it's in the main generator thread. Verified by existing pattern in overlay/framing functions.
