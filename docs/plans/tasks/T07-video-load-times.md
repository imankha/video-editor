# T07: Video Load Times

**Status:** TODO
**Impact:** MEDIUM
**Complexity:** LOW
**Created:** 2026-02-06

## Problem

Sometimes loading a video takes a long time. We need visibility before we can fix it.

## Approach

1. **Always show a preloader** - User should see loading state while video loads
2. **Always log video load times** - Capture timing data for analysis
3. **Investigate once we have data** - Find patterns in slow loads and optimize

## Implementation

### Phase 1: Visibility

- [ ] Add preloader/spinner when video is loading
- [ ] Log video load start time
- [ ] Log video load complete time (or error)
- [ ] Log video metadata (size, duration, source type: R2 presigned URL vs local)

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

- [ ] User always sees loading indicator while video loads
- [ ] Video load times are logged with enough context to diagnose issues
- [ ] After collecting data, slow loads are investigated and addressed
