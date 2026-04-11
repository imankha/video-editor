# T1370: Blob Preload Size Gate

**Status:** TODO
**Priority:** 3.0 (Performance — T1262 blob preload is counterproductive for large videos)
**Depends:** T1262 (committed)

## Problem

T1262's blob preload downloads the entire video as a blob for instant seeks. This works great for small videos (<200MB) but is counterproductive for real user videos (~3GB):

- **Memory**: 3GB blob in browser memory will crash mobile and stress desktop
- **Bandwidth**: downloading 3GB in background competes with streaming playback
- **Time**: even on fast connections, 3GB takes minutes — user has already moved on

Benchmarks on real 3GB VEO videos show streaming seek latency of 244-369ms average, which is acceptable. The blob preload is unnecessary for these.

## Fix

Add a size gate to `preloadVideoAsBlob` in `AnnotateContainer.jsx`:

```javascript
const MAX_BLOB_PRELOAD_SIZE = 200 * 1024 * 1024; // 200MB

if (videoUrl && !videoUrl.startsWith('blob:') && videoMetadata?.size && videoMetadata.size < MAX_BLOB_PRELOAD_SIZE) {
  blobPreloadRef.current = videoUrl;
  preloadVideoAsBlob(videoUrl);
}
```

Videos above the threshold continue using streaming range requests (the existing path). The size threshold should be tuned based on real-world data — 200MB covers short clips but excludes full-game recordings.

## Files

- `src/frontend/src/containers/AnnotateContainer.jsx` — `preloadVideoAsBlob` call site (~line 420)

## Benchmarks

| Video | Size | Blob Preload | Streaming |
|-------|------|-------------|-----------|
| Test video (46MB) | 46MB | avg 38ms | avg 207ms |
| VEO game 1 (3GB) | 3.07GB | N/A (impractical) | avg 244ms |
| VEO game 2 (3GB) | 2.93GB | N/A (impractical) | avg 369ms |
