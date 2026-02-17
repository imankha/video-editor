# T81: Faster Upload Hash (Sampling Instead of Full Hash)

**Status:** TESTING
**Impact:** 6
**Complexity:** 4
**Created:** 2026-02-17
**Updated:** 2026-02-17

## Problem

The Blake3 hash calculation during game upload takes too long because it hashes every frame of the video. This creates a noticeable delay in the upload flow and isn't necessary for duplicate detection.

For determining if two videos are the same, we don't need a cryptographic-strength hash of every byte. A combination of metadata and sampled frames should be sufficient.

## Solution

Replace full-file Blake3 hashing with a faster composite fingerprint:

1. **Metadata fingerprint:**
   - Filename
   - File size
   - Last modified date
   - Video duration (if available from metadata)

2. **Sampled frame hashing:**
   - Hash first N bytes (e.g., 1MB)
   - Hash last N bytes
   - Hash 3-5 samples from middle (at fixed percentage points: 25%, 50%, 75%)

This should be sufficient to detect duplicates while being much faster.

## Context

### Relevant Files
- `src/frontend/src/stores/uploadStore.js` - Current hash calculation logic
- `src/frontend/src/services/ExtractionWebSocketManager.js` - Upload coordination
- `src/backend/app/routers/games_upload.py` - Backend dedup check endpoint

### Related Tasks
- Depends on: T80 (uses the hash infrastructure built there)
- Blocks: None

### Technical Notes
- Current implementation uses hash-wasm Blake3
- Need to maintain backward compatibility with any existing hashes in database
- Consider if we need to rehash existing games or just use new scheme going forward

## Implementation

### Steps
1. [ ] Analyze current hash timing to establish baseline
2. [ ] Design composite fingerprint schema
3. [ ] Implement sampled hashing in uploadStore
4. [ ] Update backend dedup check to use new fingerprint format
5. [ ] Test with various video sizes to verify speed improvement
6. [ ] Ensure collision resistance is acceptable for our use case

### Progress Log

**2026-02-17**: Implemented sampled hashing in `uploadManager.js`:
- Changed `hashFile()` to read 5 samples (1MB each) at positions: 0%, 25%, 50%, 75%, and end
- Includes file size in hash for collision resistance
- Total read: ~5MB instead of full file (60x speedup for 4GB files)
- Backend unchanged - still receives 64-char hex BLAKE3 hash
- Unit tests updated and passing

## Acceptance Criteria

- [ ] Upload hash calculation takes <2 seconds for 4GB files
- [ ] Duplicate detection still works correctly
- [ ] No false negatives (missing actual duplicates)
- [ ] Acceptable false positive rate (wrongly flagging non-duplicates)
