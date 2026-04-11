# T1360: Stale Blob URL Causes "Video Format Not Supported"

**Status:** TODO
**Priority:** 4.0 (User-facing bug — video fails to load with misleading error)
**Reported:** 2026-04-10
**Reporter:** sarkarati@gmail.com screenshot + logs
**Environment:** Staging (reel-ballers-staging.pages.dev), build 31dd34e

## Problem

Users see "Video format not supported" error when their video's blob URL becomes invalid. The actual error is `net::ERR_FILE_NOT_FOUND` on a blob URL, but the `<video>` element reports it as a media decode error, which the app surfaces as "Video format not supported."

Error sequence from logs:
```
[VIDEO] Error: Video format not supported.
blob:https://reel-ballers-staging.pages.dev/8a592566-... Failed to load resource: net::ERR_FILE_NOT_FOUND
Access to fetch at '...r2.cloudflarestorage.com/...' blocked by CORS policy
[VIDEO] Error: Video format not supported.  (x3 — retries)
```

## Root Cause

Blob URLs are created by `URL.createObjectURL()` during video upload or `loadVideoFromUrl()`. They become invalid when:
- The source `Blob` is garbage collected
- `URL.revokeObjectURL()` is called (during cleanup or component unmount)
- The page navigates and the blob context is lost

When the video element tries to load a revoked blob URL, it gets `ERR_FILE_NOT_FOUND`, which fires the `error` event with `MEDIA_ERR_SRC_NOT_SUPPORTED` — a misleading error code.

T1262's blob preload (committed on this branch) adds another blob URL creation path that could hit the same issue if the component unmounts during the background download.

## Impact

- User sees alarming "Video format not supported" error
- No automatic recovery — user must navigate away and back
- Error message is misleading (the format IS supported, the URL is just stale)

## Fix

1. **Detect stale blob URLs** — in `handleError`, check if `video.src.startsWith('blob:')` and the error is `MEDIA_ERR_SRC_NOT_SUPPORTED`. If so, the error message should be "Video connection lost" (not "format not supported") and trigger the same retry flow as expired presigned URLs.

2. **Auto-recover from stale blobs** — if the original streaming URL is still available (stored in metadata or state), automatically swap back to it and retry.

3. **T1262 blob preload guard** — ensure `preloadVideoAsBlob` checks `blobPreloadRef.current` before creating/swapping the blob URL, and revokes the blob URL if the component unmounts mid-download (cleanup in useEffect or AbortController).

## Files

- `src/frontend/src/hooks/useVideo.js` — `handleError` (line ~571), `loadVideoFromUrl` (line ~120)
- `src/frontend/src/components/VideoPlayer.jsx` — error overlay (line ~242)
- `src/frontend/src/containers/AnnotateContainer.jsx` — `preloadVideoAsBlob` (T1262)
