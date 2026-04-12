# T1380: Client-Side Moov Atom Faststart on Upload

**Status:** DONE (verified 2026-04-12 on dev R2 with 3GB Trace re-upload)

## Result

| Metric | Before (Trace, moov-at-end) | After (T1380) |
|---|---|---|
| Time to first frame | seconds (multi-round-trip) | **359ms** |
| Seek latency (warm edge, avg) | ~185ms | ~231ms |
| Seek latency (warm edge, p95) | ~282ms | ~320ms |
| Seek network component | unknown | 4–16ms |
| Seek decode component | unknown | 170–320ms |
| Upload wall-clock overhead | n/a | +22ms analysis, 0ms reorder |
| R2 bytes | 3,211,485,488 | 3,211,485,488 (identical) |

Verified on R2: `ftyp@0(32) moov@32(747,150)` — moov successfully relocated from offset 3,210,738,338 to byte 32 through the 31-part multipart upload, stco offsets patched correctly.

**Conclusion:** Time-to-ready is the big user-visible win. Seek latency is now decode-bound, not network-bound — follow-up in T1385.

**Impact:** 7 (eliminates extra round-trip on initial load for non-faststart videos)
**Complexity:** 3 (well-documented algorithm, small code footprint, no backend changes)
**Priority:** 2.3
**Created:** 2026-04-10
**Parent:** T1260
**Cost:** $0 (purely client-side)

## Problem

Some video sources (e.g., Trace cameras) output MP4 files with the `moov` atom at the END of the file, after the entire `mdat` payload. When the browser plays these videos:

1. Fetches bytes 0-N -- gets `ftyp` + `mdat` header, no `moov`
2. Discovers Content-Length, seeks to end of file
3. Fetches `moov` (~730KB at offset ~3GB) -- R2 TTFB is ~420ms at high offsets
4. NOW it can build the seek index and start playback

This adds **400-500ms** to initial video load compared to faststart videos where `moov` is at byte 0.

### Measured on Production Videos

| Video Source | moov Location | moov Size | Initial Load Penalty |
|-------------|---------------|-----------|---------------------|
| VEO (imankh) | **Beginning** (offset 0x14) | 1.8MB | None -- already faststart |
| Trace (sarkarati) | **End** (offset ~3.21GB) | 730KB | ~400ms extra round-trip |

VEO cameras already output faststart MP4s. Trace does not. Other future video sources may or may not. The fix should detect and handle both cases.

## Solution

Relocate the `moov` atom to the beginning of the file **client-side, before upload**. No server, no Modal, no cost.

### Algorithm (from FFmpeg's `qt-faststart.c`)

1. **Scan** top-level MP4 boxes to find `ftyp`, `moov`, and `mdat` positions
2. **Check** if `moov` is already before `mdat` -- if so, skip (no-op)
3. **Read** the `moov` box via `File.slice()` (~730KB into memory)
4. **Patch** all chunk offset tables (`stco`/`co64`) inside `moov` -- add `moovSize` to every offset since `mdat` shifts right
5. **Upload** in new order: `ftyp` + patched `moov` + `mdat` (streamed in 100MB chunks as today)

### Why Client-Side

- **Cost: $0** -- no Modal GPU, no server processing, no bandwidth
- **Speed: <1 second** -- only reads ~730KB, does math, streams the rest
- **Memory: ~2MB** -- moov in memory, mdat streamed via `File.slice()`
- **No backend changes** -- the backend receives a valid MP4 with different byte ordering

## Integration with Upload Pipeline

### Current Flow (uploadManager.js)

```
File selected
  -> hashFile(file)              // BLAKE3 sampled hash (~1s)
  -> prepare-upload(hash, size)  // Dedup check, get presigned URLs
  -> uploadParts(file, parts)    // 100MB chunks via file.slice(start, end+1)
  -> finalize-upload(parts)      // Complete multipart, verify size
```

### New Flow

```
File selected
  -> analyzeMp4Structure(file)   // NEW: Find moov position (<100ms)
  -> hashFile(file)              // Hash ORIGINAL file (unchanged)
  -> prepare-upload(hash, size)  // Same hash, ADJUSTED size
  -> uploadParts(file, parts, faststartInfo)  // NEW: Reordered slicing
  -> finalize-upload(parts)      // Same -- size matches adjusted size
```

### Critical Design Decision: Hash Before or After?

**Hash the ORIGINAL file, upload the reordered file.**

Why: Deduplication is keyed on BLAKE3 hash. If user A uploads a Trace video and we faststart it, user B uploading the same Trace video should dedup. Both users have the same original file, so hashing the original gives the same hash. The R2 object (`games/{hash}.mp4`) will contain the faststarted version.

This means `file_size` sent to `prepare-upload` must be the **new** size (after moov relocation), not `file.size`. The size difference is typically 0 bytes (moov moves, total stays the same) unless `stco` -> `co64` upgrade adds a few bytes.

### Why size is (almost) always identical

Moving moov from end to beginning doesn't add or remove bytes -- it just reorders them. The file is: `ftyp + mdat + moov` -> `ftyp + moov + mdat`. Same total. The only exception is if `stco` (32-bit offsets) overflows and must be upgraded to `co64` (64-bit offsets), which adds 4 bytes per chunk offset entry. For a 3GB file this is unlikely since offsets were already near the 4GB boundary in the original layout.

## File Changes

### New: `src/frontend/src/utils/mp4Faststart.js` (~120 lines)

```javascript
/**
 * Analyze MP4 structure and prepare faststart upload instructions.
 * Does NOT create a new file -- returns slice descriptors for the upload pipeline.
 *
 * @param {File} file - MP4 file to analyze
 * @returns {Promise<FaststartInfo>}
 *
 * FaststartInfo = {
 *   needsRelocation: boolean,
 *   originalSize: number,
 *   newSize: number,           // Same as originalSize unless stco->co64 upgrade
 *   ftypOffset: number,
 *   ftypSize: number,
 *   moovOffset: number,
 *   moovSize: number,
 *   mdatOffset: number,
 *   mdatSize: number,
 *   patchedMoov: ArrayBuffer,  // null if !needsRelocation
 * }
 */
```

| Function | Description |
|----------|-------------|
| `analyzeMp4Structure(file)` | Scan top-level boxes by reading 8-16 bytes at a time via `file.slice()`. Find `ftyp`, `moov`, `mdat` positions and sizes. Return `FaststartInfo` with `needsRelocation: moovOffset > mdatOffset`. |
| `readMoovAtom(file, offset, size)` | Read the moov box into an `ArrayBuffer` via `file.slice(offset, offset + size)`. |
| `patchChunkOffsets(moovBuffer, delta)` | Recursively walk the moov box tree. For each `stco` box: read 32-bit offset count, add `delta` to each 32-bit offset. For each `co64` box: read 32-bit offset count, add `delta` to each 64-bit offset (using `DataView` with two 32-bit ops or `BigInt`). Return patched buffer. |
| `scanBoxes(buffer, offset, end)` | Helper: iterate MP4 boxes within a buffer range. Yields `{type, offset, size}` for each box. Used by `patchChunkOffsets` to find `stco`/`co64` within nested moov structure. |

### Edge Cases Handled

| Case | Handling |
|------|----------|
| moov already at start (VEO) | `needsRelocation: false`, skip entirely |
| `stco` boxes (32-bit offsets) | Add delta, check for overflow (>2^32-1) |
| `co64` boxes (64-bit offsets) | Add delta using DataView 64-bit ops |
| `stco` overflow -> `co64` upgrade | Expand box by 4 bytes per entry, update parent box sizes, recalculate delta with new moov size (two-pass) |
| `free` boxes between moov and EOF | Drop them (same as FFmpeg) |
| Multiple `mdat` boxes | All chunk offsets are absolute -- delta is still just moov size. Concatenate all mdat slices. |
| Fragmented MP4 (`moof` boxes) | Detect during scan, set `needsRelocation: false` (fMP4 doesn't need faststart) |
| File too small (<1MB) | Skip -- not a real video, overhead not worth it |

### Modified: `src/frontend/src/services/uploadManager.js`

#### Change 1: Add faststart analysis before hash (line ~269)

In `ensureVideoInR2()`, add a faststart analysis phase before hashing:

```javascript
// Phase 0: Analyze MP4 structure (< 100ms)
notify(UPLOAD_PHASE.HASHING, 0, 'Analyzing video...');
const faststartInfo = await analyzeMp4Structure(file);

// Phase 1: Hash (uses original file -- for dedup consistency)
notify(UPLOAD_PHASE.HASHING, 0, 'Computing file hash...');
const hash = await hashFile(file, (p) => { ... });
```

#### Change 2: Adjust file_size for prepare-upload (line ~287)

```javascript
const prepareBody = {
  blake3_hash: hash,
  file_size: faststartInfo.needsRelocation ? faststartInfo.newSize : file.size,
  original_filename: file.name,
};
```

#### Change 3: Pass faststartInfo to uploadParts (line ~334)

```javascript
const parts = await uploadParts(
  file,
  prepareData.parts,
  progressCallback,
  prepareData.upload_session_id,
  completedParts,
  faststartInfo.needsRelocation ? faststartInfo.newSize : file.size,
  3,                    // concurrency
  faststartInfo,        // NEW parameter
);
```

#### Change 4: Modify uploadPart slicing logic (line ~105-107)

The current code:
```javascript
async function uploadPart(file, part, onProgress) {
  const { part_number, presigned_url, start_byte, end_byte } = part;
  const blob = file.slice(start_byte, end_byte + 1);
  // ... XHR upload
}
```

Becomes:
```javascript
async function uploadPart(file, part, onProgress, faststartInfo = null) {
  const { part_number, presigned_url, start_byte, end_byte } = part;
  const blob = faststartInfo?.needsRelocation
    ? getReorderedSlice(file, faststartInfo, start_byte, end_byte + 1)
    : file.slice(start_byte, end_byte + 1);
  // ... XHR upload (unchanged)
}
```

#### New helper: `getReorderedSlice(file, info, start, end)`

Maps logical byte ranges in the new layout to source data:

```
New layout (logical bytes):
  [0 .. ftypSize-1]                     -> file.slice(ftypOffset, ftypOffset + ftypSize)
  [ftypSize .. ftypSize+moovSize-1]     -> info.patchedMoov ArrayBuffer
  [ftypSize+moovSize .. newSize-1]      -> file.slice(mdatOffset, mdatOffset + mdatSize)

A 100MB upload part may span boundaries (e.g., part 1 might include
the end of patchedMoov and the start of mdat). This function assembles
the correct Blob by concatenating slices from the appropriate sources.
```

```javascript
function getReorderedSlice(file, info, start, end) {
  const ftypEnd = info.ftypSize;
  const moovEnd = ftypEnd + info.patchedMoov.byteLength;
  const parts = [];

  // Region 1: ftyp (from original file)
  if (start < ftypEnd) {
    const regionStart = info.ftypOffset + start;
    const regionEnd = info.ftypOffset + Math.min(end, ftypEnd);
    parts.push(file.slice(regionStart, regionEnd));
  }

  // Region 2: patched moov (from ArrayBuffer)
  if (start < moovEnd && end > ftypEnd) {
    const bufStart = Math.max(0, start - ftypEnd);
    const bufEnd = Math.min(info.patchedMoov.byteLength, end - ftypEnd);
    parts.push(new Blob([info.patchedMoov.slice(bufStart, bufEnd)]));
  }

  // Region 3: mdat (from original file)
  if (end > moovEnd) {
    const mdatLocalStart = Math.max(0, start - moovEnd);
    const mdatLocalEnd = end - moovEnd;
    parts.push(file.slice(
      info.mdatOffset + mdatLocalStart,
      info.mdatOffset + mdatLocalEnd
    ));
  }

  return new Blob(parts);
}
```

### No Backend Changes Required

The backend is byte-agnostic:
- `prepare-upload` receives `file_size` and generates sequential part ranges -- works the same
- `uploadPart` receives a Blob and PUTs it to R2 -- doesn't care what bytes are inside
- `finalize-upload` verifies `ContentLength` matches `file_size` -- matches because we adjusted `file_size`
- R2 reassembles parts by `part_number` order -- produces the reordered file correctly

### Modified: `src/frontend/src/stores/uploadStore.js` (optional)

Add a `ANALYZING` sub-phase for the progress bar if desired, or fold it into the existing `HASHING` phase since it takes <100ms.

## Testing

### Unit Tests (Vitest)

New test file: `src/frontend/src/utils/__tests__/mp4Faststart.test.js`

| Test | Description |
|------|-------------|
| `scanBoxes finds ftyp, mdat, moov` | Feed it a minimal MP4 header, verify box positions |
| `detects moov-at-end` | File with ftyp+mdat+moov -> `needsRelocation: true` |
| `skips moov-at-start` | File with ftyp+moov+mdat -> `needsRelocation: false` |
| `patches stco offsets` | Create a moov buffer with known stco values, verify delta is added |
| `patches co64 offsets` | Same but with 64-bit offsets |
| `getReorderedSlice maps regions correctly` | Verify byte ranges spanning ftyp/moov/mdat boundaries produce correct blobs |
| `handles fMP4 (moof present)` | File with moof box -> `needsRelocation: false` |

### E2E Validation

1. Upload a Trace video (moov at end) through the app
2. Download the uploaded file from R2 (`aws s3 cp`)
3. Verify moov is now at the beginning: `ffprobe -v trace <file> 2>&1 | head -20`
4. Verify video plays correctly in browser
5. Verify seek performance matches VEO baseline (no extra round-trip)

### Regression

- Upload a VEO video (moov already at start) -- should be identical to current behavior
- Deduplication still works: re-upload same file -> `status: exists`
- Resume support still works: interrupt upload, resume -> completes correctly
- Multi-video upload (`uploadMultiVideoGame`) still works

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| stco overflow (32-bit -> 64-bit upgrade) | Low (only if offsets near 4GB boundary AND moov shift pushes them over) | Implement co64 upgrade path; test with synthetic 4GB+ offset values |
| Exotic MP4 variants (cmov, wide atom) | Very low (only old QuickTime) | Skip relocation for unrecognized box structures |
| Hash mismatch on dedup | None if done correctly | Hash original file, not reordered; same original = same hash |
| Browser File API performance | None | `file.slice()` is O(1) -- returns a reference, not a copy |

## Acceptance Criteria

- [ ] Trace videos uploaded through the app have moov at the beginning in R2
- [ ] VEO videos are unchanged (moov already at start, no-op)
- [ ] Upload time increase is <1 second for 3GB files
- [ ] No additional memory usage beyond ~2MB (moov buffer)
- [ ] Deduplication still works (same file -> same hash)
- [ ] Seek performance on uploaded Trace videos matches VEO baseline
- [ ] No backend changes required
- [ ] Cost: $0 per video
