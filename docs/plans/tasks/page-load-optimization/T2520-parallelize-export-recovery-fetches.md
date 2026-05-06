# T2520: Parallelize Export Recovery Fetches

**Epic:** [Page Load Optimization](EPIC.md)
**Priority:** P0
**Complexity:** 2
**Impact:** 6
**Status:** TODO

## Problem

`useExportRecovery.js` fetches `/exports/active` and `/exports/unacknowledged` sequentially:

```
await initSession()                          // wait for auth
await fetch(/api/exports/active)             // wait for active list
await showCompletedExportNotifications()     // THEN fetch unacknowledged
```

The unacknowledged fetch doesn't depend on the active fetch result. This adds ~100ms to the waterfall.

## Evidence

HAR timeline:
- t=157ms: `/exports/active` starts (after auth resolves)
- t=260ms: `/exports/unacknowledged` starts (after active completes)
- t=747ms: unacknowledged completes

With parallelization, unacknowledged would start at t=157ms instead of t=260ms.

## Implementation

Fire both fetches in parallel using `Promise.all`, then process results sequentially:

```javascript
async function loadExportsFromBackend() {
  const session = await initSession();
  if (!session.isAuthenticated) return;

  // Fire both in parallel
  const [activeResponse, unacknowledgedResponse] = await Promise.allSettled([
    fetch(`${API_BASE}/api/exports/active`),
    fetch(`${API_BASE}/api/exports/unacknowledged`),
  ]);

  // Process active exports (existing logic)
  if (activeResponse.status === 'fulfilled' && activeResponse.value.ok) {
    const data = await activeResponse.value.json();
    // ... existing processing, WebSocket connections, etc.
  }

  // Process unacknowledged exports (existing logic)
  if (unacknowledgedResponse.status === 'fulfilled' && unacknowledgedResponse.value.ok) {
    const data = await unacknowledgedResponse.value.json();
    // ... existing notification logic
  }
}
```

## Test Plan

- [ ] HAR: exports/active and exports/unacknowledged start at the same time
- [ ] Active export recovery still connects WebSockets
- [ ] Unacknowledged export notifications still appear
- [ ] Export acknowledgment POST still fires after notifications shown

## Files

- `src/frontend/src/hooks/useExportRecovery.js` (lines 37-157)
