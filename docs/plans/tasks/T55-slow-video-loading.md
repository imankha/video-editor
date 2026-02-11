# T55: Slow Video Loading Investigation

**Status:** DONE
**Impact:** HIGH
**Complexity:** MEDIUM
**Created:** 2026-02-11
**Updated:** 2026-02-11

## Problem

Video loading takes 61+ seconds for large videos (89 min game footage). Users see a loading spinner for over a minute before playback starts.

### Evidence

```
useVideo.js:398 [VIDEO] Loading: https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorag...
useVideo.js:413 [VIDEO] Loaded in 61625ms (5362.9s video)
```

- 61.6 seconds to load a 5362.9s (89 minute) video
- Video is served from R2 presigned URL

## Root Cause Identified

**R2/Cloudflare CDN cold cache** - NOT moov atom position.

Evidence:
- First load: 68,525ms (68.5 seconds)
- Second load: 454ms (0.4 seconds) - **150x faster**

When a video hasn't been accessed recently:
1. Cloudflare's edge doesn't have it cached
2. The request goes to R2 origin storage
3. Large files take a long time to fetch from origin

Once cached at the edge, subsequent loads are fast.

## Solution

### 1. Configure R2 CORS (DONE)

Created `src/backend/scripts/configure_r2_cors.py` to enable:
- GET/HEAD requests from frontend origins
- Range header for partial content requests
- Exposed headers: Accept-Ranges, Content-Range, Content-Length

Run: `cd src/backend && .venv/Scripts/python.exe scripts/configure_r2_cors.py`

### 2. Cache Pre-warming on App Init (DONE)

**New approach:** Warm ALL user videos when app initializes (portable to login hook later).

Backend endpoint: `GET /storage/warmup`
- Returns presigned URLs for all user videos (games, final_videos, working_videos)
- Frontend calls this on app mount and warms all URLs

Frontend: `warmAllUserVideos()` in `cacheWarming.js`
- Fetches warmup URLs from backend
- Warms all with small range requests (1KB each)
- Runs in background, doesn't block UI

App.jsx:
```javascript
// Pre-warm R2 cache for all user videos on app init
// TODO(T200): Move this to post-login hook when User Management is implemented
useEffect(() => {
  warmAllUserVideos();
}, []);
```

### 3. Better Progress Feedback (DONE)

Updated loading overlay to show:
- Elapsed time during slow loads
- Message: "First load may be slow. Subsequent loads will be faster."

### 4. Diagnostic Logging (DONE)

Enhanced logging in `useVideo.js`:
- HEAD request to check R2 headers (silently ignores CORS errors)
- Network/ready state tracking during load
- Slow load warning (>5 seconds)

## Acceptance Criteria

- [x] Identify root cause of 61s load time
- [x] Video playback starts quickly for all videos (via cache pre-warming on app init)
- [x] Large videos (1hr+) don't require full download before playback (confirmed - it's CDN cache, not moov atom)
- [x] Better user feedback during slow loads

## Related

- T07: Video Load Times (Phase 1 - visibility, DONE)
- T05: Optimize Load Times (presigned URL caching, DONE)
- T230: Pre-warm R2 on Login (now implemented as part of T55)

## Files Changed

```
src/backend/app/routers/storage.py             # Added /storage/warmup endpoint
src/backend/scripts/configure_r2_cors.py       # CORS configuration script
src/frontend/src/utils/cacheWarming.js         # Added warmAllUserVideos()
src/frontend/src/App.jsx                       # Call warmAllUserVideos on mount
src/frontend/src/hooks/useGames.js             # Removed games-specific warming (now redundant)
src/frontend/src/hooks/useVideo.js             # Elapsed time tracking, diagnostics
src/frontend/src/stores/videoStore.js          # loadingElapsedSeconds state
src/frontend/src/components/VideoPlayer.jsx    # Show elapsed time in overlay
src/frontend/src/modes/AnnotateModeView.jsx    # Pass loadingElapsedSeconds
src/frontend/src/modes/FramingModeView.jsx     # Pass loadingElapsedSeconds
src/frontend/src/modes/OverlayModeView.jsx     # Pass loadingElapsedSeconds
src/frontend/src/screens/AnnotateScreen.jsx    # Pass loadingElapsedSeconds
src/frontend/src/screens/FramingScreen.jsx     # Pass loadingElapsedSeconds
src/frontend/src/screens/OverlayScreen.jsx     # Pass loadingElapsedSeconds
```
