# T1720: Fix Gallery badge showing 0 until panel is opened

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-04-23
**Updated:** 2026-04-23

## Problem

The Gallery badge in the header always shows 0 (no badge) on initial page load, even when the user has completed exports. The correct count only appears after the user opens and closes the Gallery panel.

Root cause: In `DownloadsPanel.jsx:59-63`, a `useEffect` watches `downloads` and calls `setCount(downloads.length)`. On mount, `downloads` is initialized as `[]` (empty array). Since `[]` is truthy in JavaScript, the effect immediately fires `setCount(0)`, **overwriting** the count fetched by `galleryStore.fetchCount()` during app init (`App.jsx:134`).

The actual download data only loads when `isOpen = true` (`useDownloads.js:293`). So the badge stays at 0 until the user opens the Gallery.

**Reported by:** sarkarati@gmail.com -- "Gallery shows no Reels even though two have been created from the first game, might just be UI issue because when I click on Gallery they are present and the red number 2 pops in after I exit the Gallery."

## Solution

Guard the `useEffect` to only sync count when downloads have actually been fetched (not on initial empty state). Check `loadState === 'ready'` instead of just `downloads` being truthy.

```jsx
// Before (buggy):
useEffect(() => {
  if (downloads) {
    setCount(downloads.length);
  }
}, [downloads, setCount]);

// After (fixed):
useEffect(() => {
  if (loadState === 'ready') {
    setCount(downloads.length);
  }
}, [downloads, loadState, setCount]);
```

## Context

### Relevant Files
- `src/frontend/src/components/DownloadsPanel.jsx` - Lines 59-63 (the buggy useEffect)
- `src/frontend/src/hooks/useDownloads.js` - Line 24 (initial `downloads = []`), line 293 (fetch only when `isOpen`)
- `src/frontend/src/stores/galleryStore.js` - Lines 35-53 (`fetchCount` sets correct count on init)
- `src/frontend/src/App.jsx` - Line 134 (calls `fetchCount` on app init)

### Related Tasks
- T635: Original implementation of centralized count fetching

## Implementation

### Steps
1. [ ] Add `loadState` to the destructured values from `useDownloads` in DownloadsPanel
2. [ ] Guard the useEffect with `loadState === 'ready'`
3. [ ] Verify badge shows correct count on initial load

## Acceptance Criteria

- [ ] Gallery badge shows correct count immediately on page load (without opening Gallery)
- [ ] Badge still updates correctly after opening/closing Gallery
- [ ] Badge still updates after new export completes (WebSocket event)
- [ ] Badge resets on profile switch
