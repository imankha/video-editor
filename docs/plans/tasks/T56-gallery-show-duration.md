# T56: Gallery Show Duration Instead of "Unknown size"

**Status:** TODO
**Impact:** LOW
**Complexity:** LOW
**Created:** 2026-02-11

## Problem

Gallery displays "Unknown size" for videos. Should show duration instead, which is more useful information.

## Approach

1. Find where gallery items are rendered
2. Replace file size display with duration
3. Format duration nicely (e.g., "1:23" or "1h 23m")

## Files to Check

```
src/frontend/src/screens/GalleryScreen.jsx
src/frontend/src/components/GalleryItem.jsx (if exists)
```

## Acceptance Criteria

- [ ] Gallery shows video duration instead of "Unknown size"
- [ ] Duration is formatted readably (MM:SS or HH:MM:SS)
