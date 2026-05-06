# T2510: Add Store Fetch Dedup Guards

**Epic:** [Page Load Optimization](EPIC.md)
**Priority:** P0
**Complexity:** 2
**Impact:** 5
**Status:** TODO

## Problem

`creditStore.fetchCredits()` and `authStore.checkAdmin()` have no dedup logic. Every other store (profileStore, projectsStore, gamesDataStore, questStore, settingsStore, galleryStore) uses a module-level `_fetchPromise` to prevent concurrent duplicate requests. These two are unprotected.

## Evidence

`creditStore.js:21-33` — raw fetch with no promise dedup.
`authStore.js:27-36` (`checkAdmin`) — raw fetch with no promise dedup.

## Implementation

Add the same `_fetchPromise` pattern used by other stores:

```javascript
// creditStore.js
let _fetchPromise = null;

fetchCredits: async () => {
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/credits`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      set({ balance: data.balance, loaded: true });
    } catch { /* best-effort */ }
    finally { _fetchPromise = null; }
  })();
  return _fetchPromise;
},
```

Same pattern for `checkAdmin()` in `authStore.js`.

## Test Plan

- [ ] Calling `fetchCredits()` twice rapidly results in only 1 API call
- [ ] Calling `checkAdmin()` twice rapidly results in only 1 API call
- [ ] Credit balance still loads correctly on page load
- [ ] Admin panel still works for admin users

## Files

- `src/frontend/src/stores/creditStore.js`
- `src/frontend/src/stores/authStore.js`
