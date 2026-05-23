# Test Handoff: getGame() Request Storm Fix

**Bug:** Video playback fails on games with many clips  
**Commits:** `a8f27108`, `0f52c37b`  
**Branch:** `master`  
**Files changed:**
- `src/frontend/src/stores/gamesDataStore.js`
- `src/frontend/src/containers/AnnotateContainer.jsx`
- `src/frontend/src/modes/annotate/hooks/useMultiVideoScrub.js`

---

## Problem

When a multi-video game's presigned URLs expired (or any video element error occurred), the app created 100-150+ concurrent `GET /api/games/{id}` requests that saturated the backend, causing 20-30 second response times, cascading failures, and total playback breakdown. Confirmed across 5 separate user reports on games 4, 5, 6, and 7 -- all games with many clips.

### Root Cause Chain

Three bugs combined into a request storm:

1. **No in-flight deduplication on `getGame()`** -- Each caller fired its own HTTP request. Compare to `fetchGames()` which already had dedup via `_fetchPromise`. With N video elements each calling `refreshMultiVideoUrls()` on error, N concurrent requests fired.

2. **Retry counter reset on every URL refresh** -- `useMultiVideoScrub.js` had a `useEffect` watching `gameVideos` that reset `retryCountRef.current = 0` whenever new URLs arrived. This defeated `MAX_RETRY_ATTEMPTS = 2`, creating an infinite loop: video error -> refresh URLs -> getGame -> new URLs set -> retry counter resets to 0 -> video loads with new URL -> if still errors -> cycle repeats forever.

3. **No coalescing of concurrent refresh calls** -- Multiple video elements (2 in multi-video mode) each fired `onRefreshUrls()` independently on error, doubling the request volume per error cycle.

### Reproduction Evidence (from logs)

| Report | Game | Concurrent Requests | Peak Latency | Outcome |
|--------|------|---------------------|--------------|---------|
| 1 | game 7 | 150+ | 28s | "Failed to fetch" errors, playback dead |
| 2 | game 6 | 120+ | 20s (climbing linearly) | Spinner, no playback |
| 3 | game 6 | 115+ | 31s | Backend saturated, home screen "Failed to load games" |
| 4 | game 4 | 51+ | 35s | "Failed to fetch" errors |
| 5 | games 4,5,6 | 60+ each | 24s | Top 4 games broken, bottom 2 (few clips) fine |

---

## Solution (2 commits)

### Fix 1: `getGame()` in-flight deduplication (`gamesDataStore.js:189-216`)

Added a module-level `Map` (`_getGameInflight`) keyed by `gameId`. If a request for the same game is already in-flight, return the existing promise. The promise is removed from the map in `finally` so the next call after completion fires a fresh request.

```javascript
// Before: every call = new HTTP request
getGame: async (gameId) => {
  const response = await apiFetch(`/api/games/${gameId}`);
  // ...
}

// After: concurrent calls share one promise
getGame: async (gameId) => {
  const inflight = _getGameInflight.get(gameId);
  if (inflight) return inflight;
  const promise = (async () => {
    try { /* fetch */ }
    finally { _getGameInflight.delete(gameId); }
  })();
  _getGameInflight.set(gameId, promise);
  return promise;
}
```

This is the same pattern `fetchGames()` already uses with `_fetchPromise` (line 61).

### Fix 2: Retry counter enforcement (`useMultiVideoScrub.js:329-336`)

Removed `retryCountRef.current = 0` from the `useEffect` that watches `gameVideos`. The error display is still cleared (so the UI updates), but the retry counter is preserved. The counter only resets on:
- User-initiated retry via the "Retry" button (`clearError()` at line 317-320)
- Component remount (ref initializes to 0)

```javascript
// Before: infinite retry loop
useEffect(() => {
  if (gameVideos) {
    setError(null);
    retryCountRef.current = 0;  // <-- REMOVED: defeated MAX_RETRY_ATTEMPTS
  }
}, [gameVideos]);

// After: error clears, retry limit holds
useEffect(() => {
  if (gameVideos) {
    setError(null);
  }
}, [gameVideos]);
```

### What was NOT changed

`refreshMultiVideoUrls` in `AnnotateContainer.jsx` was restored to its original form (no debounce). The `getGame()` dedup makes debouncing unnecessary -- concurrent calls from multiple video error handlers all resolve to the same promise.

---

## Test Plan

### Unit Tests: `gamesDataStore.test.js` (NEW FILE)

Create `src/frontend/src/stores/gamesDataStore.test.js`.

**Test framework:** Vitest + `vi.fn()` for fetch mocking  
**Pattern to follow:** `src/frontend/src/utils/cacheWarming.test.js` (deferred fetch mock pattern)

#### Setup

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let useGamesDataStore;

async function loadModule() {
  vi.resetModules();
  const mod = await import('./gamesDataStore');
  useGamesDataStore = mod.useGamesDataStore;
}

function makeDeferredFetch() {
  const pending = [];
  const fetchMock = vi.fn((url, init = {}) => {
    return new Promise((resolve, reject) => {
      pending.push({ url, resolve, reject });
    });
  });
  return { fetchMock, pending };
}

function resolveWithGame(entry, gameId = 1) {
  entry.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: gameId, name: 'Test Game', videos: [] }),
  });
}
```

#### Test Cases

**1. `getGame() returns cached in-flight promise for same gameId`**
- Call `getGame(7)` -- do NOT resolve the fetch yet
- Call `getGame(7)` again immediately
- Assert `fetchMock` was called exactly once (not twice)
- Assert both calls return the same promise (reference equality)
- Resolve the fetch, assert both callers get the same data

**2. `getGame() fires fresh request after previous completes`**
- Call `getGame(7)`, resolve the fetch
- Await the result
- Call `getGame(7)` again
- Assert `fetchMock` was called twice (dedup cleared after first completed)

**3. `getGame() deduplicates per gameId independently`**
- Call `getGame(7)` -- do NOT resolve
- Call `getGame(8)` -- do NOT resolve
- Assert `fetchMock` was called twice (different game IDs, no dedup)
- Call `getGame(7)` again
- Assert `fetchMock` still called twice (deduped with first call to game 7)

**4. `getGame() clears inflight on error`**
- Call `getGame(7)`, reject the fetch with an error
- Catch the error
- Call `getGame(7)` again
- Assert `fetchMock` was called twice (inflight cleared after error)

**5. `getGame() concurrent callers all receive the error`**
- Call `getGame(7)` twice concurrently (promise1, promise2)
- Assert `fetchMock` was called once
- Reject the fetch
- Assert both promise1 and promise2 reject with the same error

**6. `reset() clears in-flight promises`**
- Call `getGame(7)` -- do NOT resolve
- Call `useGamesDataStore.getState().reset()`
- Call `getGame(7)` again
- Assert `fetchMock` was called twice (inflight cleared by reset)

### Unit Tests: `useMultiVideoScrub.test.js` (NEW FILE)

Create `src/frontend/src/modes/annotate/hooks/useMultiVideoScrub.test.js`.

**Test framework:** Vitest + `@testing-library/react` `renderHook` + `act()`  
**Pattern to follow:** `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.test.js`

#### Setup

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiVideoScrub } from './useMultiVideoScrub';

const MOCK_GAME_VIDEOS = [
  { sequence: 0, url: 'https://r2.example.com/video0.mp4', duration: 300, width: 1920, height: 1080 },
  { sequence: 1, url: 'https://r2.example.com/video1.mp4', duration: 300, width: 1920, height: 1080 },
];
```

**Note:** This hook creates video refs (`videoARef`, `videoBRef`) but doesn't attach them to real DOM video elements in unit tests. Tests for error handling behavior can simulate errors by calling `handleVideoError` directly (it's exposed via the return value's `videoHandlers.onError`). However, since `handleVideoError` reads `e.target.error.code`, you'll need to construct a mock event.

#### Test Cases

**7. `retry counter is NOT reset when gameVideos changes`**
- Render hook with `gameVideos = MOCK_GAME_VIDEOS` and `onRefreshUrls = vi.fn()`
- Simulate 2 video errors (call `handleVideoError` with NETWORK_ERROR events)
- Assert `onRefreshUrls` called twice (MAX_RETRY_ATTEMPTS = 2)
- Rerender with new `gameVideos` (simulating a successful URL refresh)
- Simulate another video error
- Assert `onRefreshUrls` NOT called again (retry counter was NOT reset, still at 2)
- Assert the error message is set (fell through to error display)

**8. `retry counter resets on user-initiated retry`**
- Render hook, exhaust retry count (2 errors)
- Call the returned `retry()` function (simulates user clicking Retry)
- Simulate another video error
- Assert `onRefreshUrls` called again (counter was reset by `retry()`)

**9. `error display clears when gameVideos changes`**
- Render hook, trigger a video error that exceeds retry limit (so error is set)
- Assert error is displayed
- Rerender with new `gameVideos`
- Assert error is now null (cleared by the useEffect)

**10. `ABORTED errors are ignored`**
- Render hook with `onRefreshUrls = vi.fn()`
- Simulate an ABORTED video error (code 3 / `MEDIA_ERR_ABORTED` equivalent)
- Assert `onRefreshUrls` NOT called
- Assert no error message set

### E2E Test: `request-storm-regression.spec.js` (NEW FILE)

Create `src/frontend/e2e/request-storm-regression.spec.js`.

**Test framework:** Playwright  
**Pattern to follow:** `src/frontend/e2e/game-loading.spec.js`

This test verifies that opening a multi-clip game does NOT create a request storm. It doesn't need to trigger actual video errors -- it just needs to verify that loading a game with clips results in a bounded number of `GET /api/games/{id}` requests.

#### Setup

Use the standard E2E test setup pattern:
- Unique `TEST_USER_ID` per run
- `setupTestUserContext(page)` for header isolation
- Upload the test video, create clips via TSV import (use `full-workflow.spec.js` as reference)

#### Test Cases

**11. `opening a game with clips does not create request storm`**
- Set up a game with the test video and import clips via TSV
- Navigate to home, then click the game to open annotate mode
- Use `page.on('request', ...)` to count requests matching `/api/games/\\d+$` (GET only)
- Wait for video to be visible / playable
- Assert total `GET /api/games/{id}` requests <= 5 (generous bound -- normal is 1-2)
- This catches the storm regression (was 100+)

**12. `navigating between games loads fresh data each time`**
- Open game A, wait for load
- Go back, open game B, wait for load  
- Assert game B's data loaded (not stale from game A)
- Assert no request storm on either navigation

**13. `video playback works on multi-clip game`**  
- Open a game with clips
- Wait for video element to be visible
- Assert video `readyState >= 2` (HAVE_CURRENT_DATA)
- Click play, verify `paused === false`
- This is a basic smoke test that the fix didn't break normal playback

---

## Key Files Reference

| File | Lines | What Changed |
|------|-------|--------------|
| `src/frontend/src/stores/gamesDataStore.js` | 25-26 | `_getGameInflight` Map declaration |
| `src/frontend/src/stores/gamesDataStore.js` | 189-216 | `getGame()` with in-flight dedup |
| `src/frontend/src/stores/gamesDataStore.js` | 355 | `reset()` clears inflight map |
| `src/frontend/src/modes/annotate/hooks/useMultiVideoScrub.js` | 329-336 | Removed `retryCountRef.current = 0` |
| `src/frontend/src/containers/AnnotateContainer.jsx` | 95-114 | `refreshMultiVideoUrls` (restored, no debounce) |

## Existing Tests to Verify Still Pass

```bash
cd src/frontend && npm test    # All unit tests
cd src/frontend && npm run test:e2e   # All E2E tests (requires backend running)
```

No existing tests should break -- the changes only affect request volume and retry behavior, not data shape or component rendering.
