# Epic: Page Load Optimization

**Status:** TODO
**Created:** 2026-05-05
**Priority:** P0

## Goal

Cut page load time in half by eliminating duplicate API requests (every endpoint fires 2x), removing sequential fetch waterfalls, and adding missing DB indexes. Traced via HAR capture + console profiling on production (app.reelballers.com). The duplicate fetch bug alone doubles network traffic on every page load for every user.

## Evidence

**HAR file:** `Downloads/app.reelballers.com-annotate.har` (2026-05-05)

- 34 API requests fired, but only 17 unique endpoints — **every request duplicated**
- `/api/exports/unacknowledged`: 487ms server wait (slowest endpoint)
- Sequential waterfall: auth/me → 12 parallel → exports/active → exports/unacknowledged
- 40-60ms TLS connection overhead per new connection (no HTTP/2 multiplexing)

## Root Cause Analysis

### Duplicate Fetches

Two code paths in `App.jsx` fire the same 7 store fetches:

1. **Auth subscription** (App.jsx:251-262): Zustand `subscribe()` fires when `isAuthenticated` changes false→true
2. **initSession().then()** (App.jsx:128-137): fires after `initSession()` resolves

On page load, `initSession()` calls `setSessionState(true)` which flips `isAuthenticated`, triggering the subscription synchronously. Then the `.then()` callback fires the same calls. Result: every store fetch fires twice.

The subscription's purpose (T1330) is handling same-device login — it shouldn't also fire on initial page load.

### Sequential Export Waterfall

`useExportRecovery.js` chains: `await initSession()` → `await fetch(/exports/active)` → `await fetch(/exports/unacknowledged)`. The two export endpoints could fire in parallel.

### Missing Indexes

`/api/exports/unacknowledged` queries `WHERE status IN (...) AND acknowledged_at IS NULL AND completed_at >= ...` but only `idx_export_jobs_status` exists.

## Sequencing

Fix duplicate fetches first (biggest user-facing impact), then waterfall, then backend.

| # | ID | Task | Why This Order |
|---|----|------|----------------|
| 1 | T2500 | [Deduplicate Page-Load Fetches](T2500-deduplicate-page-load-fetches.md) | Biggest win: cuts 17 wasted requests. Must understand the auth subscription vs .then() interaction before changing fetch orchestration. |
| 2 | T2510 | [Add Store Fetch Dedup Guards](T2510-store-fetch-dedup-guards.md) | Defense in depth: stores that lack dedup (creditStore, authStore.checkAdmin) should have it regardless. |
| 3 | T2520 | [Parallelize Export Recovery Fetches](T2520-parallelize-export-recovery-fetches.md) | Removes 100ms+ waterfall from the export recovery path. |
| 4 | T2530 | [Index Export Jobs for Unacknowledged Query](T2530-index-export-jobs-unacknowledged.md) | Backend: cuts 487ms query to ~50ms with composite index. |
| 5 | T2540 | [Verify HTTP/2 on Fly.io Edge](T2540-verify-http2-fly-edge.md) | Research: confirm whether HTTP/2 multiplexing is active. If not, enable it to eliminate per-request TLS overhead. |

## Shared Context

### Key architectural facts
- **Auth subscription was added in T1330** for same-device login (Google sign-in during session). It correctly fires on login — the bug is that it ALSO fires on page load when `setSessionState` transitions `isAuthenticated` false→true.
- **Store dedup via `_fetchPromise`**: Most stores (profileStore, projectsStore, gamesDataStore, questStore, settingsStore, galleryStore) have module-level promise dedup. `creditStore` and `authStore.checkAdmin()` do not.
- **`initSession()` caches its promise**: calling it from multiple places (App.jsx, useExportRecovery) returns the same promise. The duplicate calls come from the subscription + .then(), not from multiple initSession() callers.
- **Gesture-based persistence**: these are read-only fetches on load, so no persistence concerns.

### Files affected

| File | T2500 | T2510 | T2520 | T2530 | T2540 |
|------|-------|-------|-------|-------|-------|
| `src/frontend/src/App.jsx` | **PRIMARY** | | | | |
| `src/frontend/src/stores/creditStore.js` | | **PRIMARY** | | | |
| `src/frontend/src/stores/authStore.js` | | **PRIMARY** | | | |
| `src/frontend/src/hooks/useExportRecovery.js` | | | **PRIMARY** | | |
| `src/backend/app/database.py` | | | | **PRIMARY** | |
| `src/backend/app/routers/exports.py` | | | | review | |

## Completion Criteria

- [ ] HAR capture shows 17 unique API requests on page load (not 34)
- [ ] `/api/exports/unacknowledged` server wait < 100ms
- [ ] `exports/active` and `exports/unacknowledged` fire in parallel (HAR confirms overlap)
- [ ] Same-device login (Google sign-in during session) still fetches all stores correctly
- [ ] No regressions in cross-device auth recovery flow
