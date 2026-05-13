# T449: Offline Reel Playback

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-05-13

## Problem

Parents want to show highlight reels to grandparents, coaches, or friends at the field -- places with spotty or no cell signal. Currently, reels stream from R2 and won't play offline.

## Solution

Cache exported reels locally using the Cache API so they play without a network connection. Request `navigator.storage.persist()` to prevent the browser from evicting cached videos.

This is NOT offline editing -- just viewing finished reels and browsing the clip library.

## Architecture

```
Export completes -> cache reel video in Cache API (SW)
               -> request persistent storage (one-time)
               -> gallery marks reel as "available offline" (checkmark icon)

Offline -> gallery loads from cache -> video plays normally
        -> app shell loads from SW cache
        -> API calls fail gracefully (cached gallery metadata)
```

### What's Cached

- **App shell**: JS, CSS, fonts, images (from T441 service worker)
- **Exported reels**: video/mp4 files, cached on export completion
- **Gallery metadata**: last-fetched reel list (for offline gallery display)

### What's NOT Cached

- Raw game videos (too large: 1-3GB)
- Editing state (framing/overlay/annotation data)
- API endpoints (no offline editing)

## Key Decisions

- Cache only the LATEST 5 exported reels (cap total cache at ~500MB)
- LRU eviction: oldest cached reel removed when over limit
- `navigator.storage.persist()` requested after first export (user just got value)
- Offline indicator in app header when network unavailable
- Gallery shows "available offline" badge on cached reels

## Dependencies

- T441 (PWA Install) -- requires service worker

## Implementation

1. [ ] Request `navigator.storage.persist()` after first export
2. [ ] On export complete: cache reel video in Cache API via service worker
3. [ ] Implement LRU cache with 5-reel / 500MB cap
4. [ ] Cache gallery metadata (reel list) for offline display
5. [ ] Gallery UI: "available offline" indicator on cached reels
6. [ ] Offline detection: show banner when navigator.onLine is false
7. [ ] Service worker: serve cached reels when network unavailable
8. [ ] Storage quota check before caching (skip if insufficient space)

## Acceptance Criteria

- [ ] Exported reels play without network connection (airplane mode test)
- [ ] Gallery shows which reels are available offline
- [ ] App shell loads offline (not a blank page)
- [ ] Oldest reels evicted when cache is full
- [ ] Works on Android Chrome and desktop -- graceful no-op on unsupported browsers
