# T55: Slow Video Loading Investigation

**Status:** TODO
**Impact:** HIGH
**Complexity:** MEDIUM
**Created:** 2026-02-11

## Problem

Video loading takes 61+ seconds for large videos (89 min game footage). Users see a loading spinner for over a minute before playback starts.

### Evidence

```
useVideo.js:398 [VIDEO] Loading: https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorag...
useVideo.js:413 [VIDEO] Loaded in 61625ms (5362.9s video)
```

- 61.6 seconds to load a 5362.9s (89 minute) video
- Video is served from R2 presigned URL

## Analysis Needed

### Potential Causes

1. **Full video download before playback**
   - Check if `loadVideoFromUrl` downloads entire file
   - Should use streaming/range requests instead

2. **Metadata extraction blocking**
   - `extractVideoMetadataFromUrl` may download significant portion
   - Check if moov atom is at end of file (requires full download)

3. **Video element loading behavior**
   - Check `preload` attribute setting
   - May be set to `auto` instead of `metadata`

4. **R2 performance**
   - First byte latency from Cloudflare
   - Large file transfer speeds

### Where to Look

```
src/frontend/src/hooks/useVideo.js           # Main video loading logic
src/frontend/src/utils/videoMetadata.js      # Metadata extraction
src/frontend/src/components/VideoPlayer.jsx  # Video element setup
```

## Approach

1. **Profile the load** - Add timing breakpoints to identify which phase is slow
2. **Check video loading mode** - Ensure streaming, not full download
3. **Check metadata extraction** - May need to skip for large files or use backend
4. **Optimize as needed** - Based on findings

## Acceptance Criteria

- [ ] Identify root cause of 61s load time
- [ ] Video playback starts within 5 seconds for R2-hosted videos
- [ ] Large videos (1hr+) don't require full download before playback

## Related

- T07: Video Load Times (Phase 1 - visibility, DONE)
- T05: Optimize Load Times (presigned URL caching, DONE)
