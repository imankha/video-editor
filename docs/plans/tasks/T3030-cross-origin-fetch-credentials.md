# T3030: Cross-Origin Fetch Missing Credentials

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Priority:** 4.0
**Created:** 2026-05-20

## Problem

Most `fetch()` calls to `API_BASE` are missing `credentials: 'include'`. In dev (Vite proxy, same-origin) this works because cookies are sent by default. On staging/prod, the frontend (`reel-ballers-staging.pages.dev`) and backend (`reel-ballers-api-staging.fly.dev`) are different origins, so cookies are NOT sent without explicit `credentials: 'include'`.

The backend has `allow_credentials=True` in CORS middleware, confirming cross-origin auth is expected.

### Immediate bugs fixed (pre-task):
- **"Failed to move to My Reels: Failed to fetch"** -- `ProjectManager.jsx` publish call missing credentials. Session cookie not sent, backend auth fails.
- **Gallery badge count silent failure** -- `galleryStore.js` fetchCount missing credentials.
- **Report Problem button invisible behind My Reels panel** -- button blends into panel (both bg-gray-800). Now shifts to left side when gallery is open.

### Systemic issue (this task):
~40 fetch calls across stores, hooks, services, and components are missing `credentials: 'include'`. These all work in dev but may fail on staging/prod.

## Affected Files

**Stores (~16 calls):**
- `profileStore.js` -- 5 calls (list, switch, create, update, delete profiles)
- `projectsStore.js` -- 5 calls (list, get, create, delete, update, discard)
- `projectDataStore.js` -- 2 calls (get clips, create clip)
- `settingsStore.js` -- 3 calls (get, update, delete settings)
- `gamesDataStore.js` -- 5 calls (list, create, get, update, delete games + annotations)

**Hooks (~7 calls):**
- `useDownloads.js` -- 2 calls (count, download file)
- `useExportRecovery.js` -- 5 calls (active, unacknowledged, acknowledge, modal-status, resume)

**Services (~6 calls):**
- `uploadManager.js` -- 6 calls (upload parts, prepare, finalize, create game, add video, activate)

**Components/Screens (~6 calls):**
- `DownloadsPanel.jsx` -- 3 calls (restore, before-after status, before-after create)
- `OverlayScreen.jsx` -- 3 calls (outdated-clips, overlay-data x2)
- `ProjectContext.jsx` -- 2 calls (get project x2)

**APIs (~2 calls):**
- `framingActions.js` -- 1 call (clip actions)
- `overlayActions.js` -- 1 call (overlay actions)

## Solution

Add `credentials: 'include'` to every `fetch()` call that targets `API_BASE`. Consider creating a thin wrapper (`apiFetch`) that includes credentials by default to prevent recurrence.

## Implementation Plan

1. **Option A (quick):** Find-and-replace all raw `fetch(` calls to add `credentials: 'include'`
2. **Option B (structural):** Create `src/frontend/src/utils/apiFetch.js` wrapper that defaults credentials, then migrate all calls

Option B prevents recurrence and is only ~10 LOC for the wrapper.

## Testing

- Build check (no runtime errors)
- Manual test on staging: verify profile switch, project CRUD, game upload, export, downloads all work
- The issue is invisible in dev due to Vite proxy (same-origin)
