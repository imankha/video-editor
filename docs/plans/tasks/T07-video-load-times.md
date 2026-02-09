# T07: Video Load Times

**Status:** TESTING (Phase 1)
**Impact:** MEDIUM
**Complexity:** LOW
**Created:** 2026-02-06
**Completed:** 2026-02-08

## Problem

Sometimes loading a video takes a long time. We need visibility before we can fix it.

## Approach

1. **Always show a preloader** - User should see loading state while video loads
2. **Always log video load times** - Capture timing data for analysis
3. **Investigate once we have data** - Find patterns in slow loads and optimize

## Implementation

### Phase 1: Visibility (DONE)

- [x] Add preloader/spinner when video is loading
- [x] Log video load start time
- [x] Log video load complete time (or error)
- [x] Log video metadata (duration)
- [x] Show error UI if video fails to load

**Changes made:**
- `VideoPlayer.jsx`: Added load timing (performance.now), error handling, error overlay UI
- `AnnotateModeView.jsx`: Now passes `isLoading` to VideoPlayer
- `AnnotateScreen.jsx`: Now extracts and passes `isLoading` from useVideo

### Phase 2: Analysis (after collecting logs)

- [ ] Review logs for patterns (which videos are slow? R2 vs local? File size correlation?)
- [ ] Identify optimization opportunities
- [ ] Implement fixes based on findings

## Logging Format

```javascript
// Frontend
console.log(`[VIDEO] Loading: ${videoUrl.substring(0, 50)}...`);
console.log(`[VIDEO] Loaded in ${elapsed}ms (${fileSizeMB}MB, ${duration}s)`);
console.log(`[VIDEO] Error: ${error.message}`);
```

```python
# Backend (if proxying)
logger.info(f"[VIDEO] Serving {filename} ({size_mb:.1f}MB)")
```

## Context

Videos are served via:
- **R2 presigned URLs** - Direct from Cloudflare, should be fast
- **Local proxy** (dev mode) - Backend streams file

Potential slow points:
- R2 presigned URL generation (already optimized in T05)
- R2 cold start on first video access
- Large file sizes
- Network latency to R2 region

## Acceptance Criteria

- [x] User always sees loading indicator while video loads
- [x] Video load times are logged with enough context to diagnose issues
- [ ] After collecting data, slow loads are investigated and addressed (Phase 2)
