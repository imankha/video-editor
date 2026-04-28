# T443: Background Sync (Export Survives App Close)

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-04-28

## Problem

Exports run on Modal (cloud GPU) and take 30-120 seconds. If a parent closes the browser/PWA during export, the WebSocket connection drops and they lose track of the job. Currently T1520 handles disconnect/retry, but the user still has to keep the app open and manually reconnect. Parents at games want to tap "Export" and put their phone away.

## Solution

Use the Background Sync API + service worker to:
1. Register export jobs with the service worker when initiated
2. Service worker polls for export completion even if the app is closed
3. When export completes, trigger a push notification (T444) and update the gallery

## Architecture

```
User taps Export
       ↓
App registers sync event: navigator.serviceWorker.ready.then(reg => reg.sync.register('export-T123'))
       ↓
User closes app
       ↓
Service worker wakes on connectivity → checks export status via API
       ↓
Export complete → cache the result URL → show notification (T444)
       ↓
User opens app → gallery shows completed reel (no surprise)
```

### Periodic Background Sync (for long exports)

For exports >60s, the one-shot Background Sync API may not be sufficient. Use Periodic Background Sync to poll:

```javascript
// Register periodic sync (Chrome only, requires installed PWA)
const registration = await navigator.serviceWorker.ready;
await registration.periodicSync.register('check-exports', {
  minInterval: 30 * 1000 // 30 seconds minimum
});
```

### Service Worker Export Tracker

```javascript
// In service worker
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-exports') {
    event.waitUntil(checkPendingExports());
  }
});

async function checkPendingExports() {
  const pending = await getPendingExportsFromIDB();
  for (const job of pending) {
    const status = await fetch(`/api/export/${job.id}/status`);
    if (status.complete) {
      await markComplete(job.id);
      await self.registration.showNotification('Reel ready!', { ... });
    }
  }
}
```

### Storage

Pending export jobs stored in IndexedDB (accessible from both app and service worker):
- `job_id`, `project_id`, `reel_name`, `started_at`, `status`

## Key Decisions

- Use IndexedDB (not Cache API) for job tracking — structured data, not HTTP responses
- Periodic Background Sync requires installed PWA + Chrome — fallback is normal reconnect (T1520)
- Poll interval: 30s minimum (browser-controlled, can't go lower)
- Backend needs a lightweight `/api/export/{id}/status` endpoint (may already exist for WS reconnect)
- Don't cache the video file in SW — just track completion and let gallery fetch on open

## Implementation

1. [ ] Add IndexedDB helper for pending export jobs (idb-keyval or raw)
2. [ ] On export initiation: write job to IDB + register sync
3. [ ] Service worker: handle `sync` event — check single job status
4. [ ] Service worker: handle `periodicsync` event — poll all pending jobs
5. [ ] Backend: ensure `/api/export/{id}/status` works without WebSocket (REST endpoint)
6. [ ] On export complete in SW: update IDB, trigger notification (T444)
7. [ ] App open: read IDB on mount, reconcile with gallery store
8. [ ] Fallback: if periodic sync unavailable, rely on existing WS reconnect (T1520)

## Acceptance Criteria

- [ ] Export initiated → user can close app → export still tracked
- [ ] Service worker polls for completion while app is closed
- [ ] On reopen, gallery shows the completed reel without user action
- [ ] Notification fires when export completes in background (requires T444)
- [ ] Graceful degradation: works as today (WS reconnect) on unsupported browsers
- [ ] No duplicate exports — closing and reopening doesn't re-trigger
