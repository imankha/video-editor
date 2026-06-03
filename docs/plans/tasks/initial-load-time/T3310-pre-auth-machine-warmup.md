# T3310: Pre-Auth Machine Warmup

**Epic:** [Initial Load Time](EPIC.md)
**Priority:** P0
**Complexity:** 2
**Impact:** 9
**Status:** TODO

## Problem

The `/storage/warmup` endpoint exists to wake the Fly.io machine and pre-warm R2 CDN cache. But it fires in Phase 3 (App.jsx:165) after both auth/me and auth/init have completed. By then, the cold-start penalty (~1.8s) has already been paid by auth/me. The warmup provides zero cold-start benefit.

The warmup also has an auth gate -- `cacheWarming.js:520` awaits an auth check before calling `/storage/warmup`, and the backend endpoint (`storage.py:202`) requires `user_id` to find videos.

## Evidence

- HAR waterfall: `/storage/warmup` fires at 4122ms, well after auth/me completes at 1902ms
- auth/me server wait: 1768ms (Fly.io machine boot + Postgres pool init)
- If warmup fired before auth/me, the machine would be warm by the time auth/me fires

## Implementation

### Backend: Split warmup into two modes

In `src/backend/app/routers/storage.py`, modify `/storage/warmup`:

- **No auth (GET /storage/warmup without session):** Return 200 OK immediately. This just wakes the machine + initializes the Postgres connection pool. No user-specific work.
- **With auth (existing behavior):** Return video URLs for cache warming as it does today.

### Frontend: Fire-and-forget warmup on page load

In `src/frontend/src/services/sessionInit.js`:

- Add a `fireAndForgetWarmup()` function that calls `GET /storage/warmup` with no auth headers, no await, no error handling. Just `fetch()` and discard the promise.
- Call it at the top of `initSession()`, before `fetchWithRetry('/api/auth/me')`.

Keep the existing auth'd warmup call at `App.jsx:165` for video pre-caching (it serves a different purpose -- pre-warming R2 CDN for the user's specific videos).

## Files

| File | Change |
|------|--------|
| `src/backend/app/routers/storage.py` | Allow unauthenticated requests to `/storage/warmup` (return 200 immediately) |
| `src/frontend/src/services/sessionInit.js` | Add `fireAndForgetWarmup()`, call before auth/me |

## Acceptance Criteria

- [ ] `/storage/warmup` fires within 100ms of page load (before auth/me)
- [ ] Unauthenticated warmup returns 200 OK without requiring session
- [ ] auth/me benefits from pre-warmed machine (server wait < 500ms on previously-cold machine)
- [ ] Existing auth'd warmup at App.jsx:165 still works for video cache warming
