# T1350: Cache Warming CORS Cleanup

**Status:** TODO
**Epic:** [Video Load Reliability](EPIC.md)
**Priority:** 3 of 3
**Branch:** `feature/T1350-cache-warming-cors-fix`
**Reported:** 2026-04-10 (sarkarati@gmail.com)

## User Value

The browser console is clean on every page load. Today, every user sees a flurry of CORS errors on app start; real errors get buried and the app looks broken even when it isn't. No user-visible behavior changes on the happy path — this is a trust / debuggability win.

## Symptom (before)

```
Access to fetch at 'https://…r2.cloudflarestorage.com/…' from origin
'https://reel-ballers-staging.pages.dev' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

Repeats for every presigned URL warmed by `warmAllUserVideos()` on mount. `warmUrl()` catches the rejection and marks the URL warmed anyway, so the "cache warming" is a functional no-op on CORS-blocked requests.

## Target Behavior (after)

**Option A (preferred, minimal):** change `warmUrl` from `mode: 'cors'` to `mode: 'no-cors'`. The response is opaque, but the edge cache is still warmed (the stated goal). No console errors.

**Option B (if A is insufficient):** remove cache warming entirely. Replace with a measurement in the orchestrator's report confirming it doesn't regress first-load latency.

Orchestrator should prefer A and only fall back to B if a benchmark shows A produces no measurable warmup benefit either.

## Test Plan

### Before-test (must fail against current master)

Playwright E2E `src/frontend/e2e/cache-warming-console.spec.js`:

```
1. Register a page.on('console') listener capturing message text.
2. Navigate to home screen with at least one R2-backed video.
3. Wait for idle + warmAllUserVideos completion.
4. Assert: zero console messages match /blocked by CORS policy/.
```

### After-test

Same test. Plus: assert `[CacheWarming] warmed N videos` log fires with `N > 0` (sanity: the function is still running, just without CORS mode).

### Optional benchmark (only if option A fails)

- Measure first-frame latency with warming on vs off on a cold origin.
- If delta < 50ms, warming is cargo-culted — remove it.

## Files

- `src/frontend/src/utils/cacheWarming.js` — `warmUrl()` ~line 129
- `src/frontend/src/App.jsx` — call site for `warmAllUserVideos()` (only if option B)

## Out of Scope

- Backend CORS configuration on R2 bucket. (Out of scope for frontend-only epic.)
- Any change to range-request / streaming fetches — those already work.

## Result (filled after implementation)

| Metric | Before | After |
|---|---|---|
| CORS console errors per page load | >0 | — |
| Warming still fires | Yes | — |
| First-frame latency delta | baseline | — |
