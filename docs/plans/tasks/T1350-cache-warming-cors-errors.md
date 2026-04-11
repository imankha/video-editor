# T1350: Cache Warming CORS Errors

**Status:** TODO
**Priority:** 3.5 (Infrastructure bug — console errors on every page load, confuses debugging)
**Reported:** 2026-04-10
**Reporter:** sarkarati@gmail.com screenshot + logs

## Problem

`cacheWarming.js` calls `fetch(url, { mode: 'cors' })` against R2 presigned URLs on every page load. R2 does not reliably return CORS headers for presigned URLs, causing browser console errors:

```
Access to fetch at 'https://...r2.cloudflarestorage.com/...' from origin
'https://reel-ballers-staging.pages.dev' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

The `warmUrl()` function catches these errors and marks URLs as warmed anyway (comment: "CORS errors still warm the cache"), so the cache warming is functionally a no-op for CORS-blocked requests.

## Root Cause

R2 presigned URLs don't consistently return CORS headers even when the bucket's CORS configuration includes the requesting origin. This was also confirmed during T1262 development — browser `fetch()` with `mode: 'cors'` to R2 presigned URLs fails despite `curl` with `Origin` header working.

## Impact

- Console spam on every page load (multiple CORS errors per user)
- Confuses debugging — real errors get buried under CORS noise
- Cache warming provides no benefit when CORS is blocked (the edge-cache theory is unverified)

## Fix Options

1. **Remove `mode: 'cors'` from warmUrl** — use `mode: 'no-cors'` instead. The response is opaque but the edge cache still gets warmed (the stated goal). No console errors.
2. **Remove cache warming entirely** — if edge warming doesn't measurably help, remove the complexity.
3. **Proxy through backend** — warm via `/api/video-proxy` same-origin endpoint. Heavier but CORS-free.

## Files

- `src/frontend/src/utils/cacheWarming.js` — `warmUrl()` function (line ~129)
- `src/frontend/src/App.jsx` — calls `warmAllUserVideos()` on mount
