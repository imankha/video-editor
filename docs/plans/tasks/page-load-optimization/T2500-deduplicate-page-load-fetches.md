# T2500: Deduplicate Page-Load Fetches

**Epic:** [Page Load Optimization](EPIC.md)
**Priority:** P0
**Complexity:** 3
**Impact:** 9
**Status:** TESTING

## Problem

Every API endpoint fires twice on page load because two independent code paths in `App.jsx` trigger the same 7 store fetches:

1. **Auth subscription** (App.jsx:251-262): `useAuthStore.subscribe()` fires when `isAuthenticated` transitions false→true via `setSessionState(true)` inside `initSession()`
2. **initSession().then()** (App.jsx:128-137): fires after `initSession()` promise resolves

Both paths call: `fetchProfiles`, `fetchProjects`, `fetchGames`, `fetchDefinitions`, `fetchProgress`, `loadSettings`, `fetchCount`, and `warmAllUserVideos`.

## Evidence

HAR capture (2026-05-05) shows 34 API requests instead of 17. Each endpoint appears exactly twice with start times 1ms apart.

## Desired Behavior

- **Page load (already authenticated):** Store fetches fire exactly once, from the `.then()` callback
- **Same-device login (Google sign-in during session):** Store fetches fire from the auth subscription (since there's no `initSession().then()` in that flow)
- **Cross-device login:** Page reloads entirely (existing behavior, no change needed)

## Implementation

Add a flag that distinguishes "initial page load" from "login during session":

```javascript
// App.jsx — inside the useEffect
let initialLoadHandled = false;

initSession().then((session) => {
  if (!session.isAuthenticated) { ... return; }
  initialLoadHandled = true;   // ← mark that .then() handled the fetches
  warmAllUserVideos();
  const dataFetches = [ ... ];  // existing code
});

const unsubAuth = useAuthStore.subscribe((state, prev) => {
  if (state.isAuthenticated && !prev.isAuthenticated && !initialLoadHandled) {
    // Only fires for login-during-session, not initial page load
    warmAllUserVideos();
    fetchProfiles(); fetchProjects(); ...
  }
});
```

## Test Plan

- [ ] HAR capture: page load shows 17 unique requests (not 34)
- [ ] Google sign-in during session: all stores populated after login
- [ ] Cross-device auth recovery: page reloads and loads normally
- [ ] Preloader dismisses at same timing as before

## Files

- `src/frontend/src/App.jsx` (lines 99-264)
