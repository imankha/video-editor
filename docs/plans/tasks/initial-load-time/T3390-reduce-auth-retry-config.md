# T3390: Reduce Auth Retry Config

**Epic:** [Initial Load Time](EPIC.md)
**Priority:** P2
**Complexity:** 1
**Impact:** 4
**Status:** TODO

## Problem

`fetchWithRetry` in sessionInit.js uses 3 retries with exponential backoff (1s, 2s, 4s base delays). On a cold start where the first attempt takes 1.8s and returns 5xx, a single retry adds 1s delay + another 1.8s request = 2.8s extra. Worst case: 3 retries = ~7s of retry overhead on top of the initial attempt.

With T3310 (pre-auth warmup) implemented, the machine should be warm by the time auth/me fires, making retries less likely. But the config should still be optimized for the auth/me case specifically.

## Evidence

- sessionInit.js:31-57 -- `fetchWithRetry()` with `retries=3`, `baseDelay=1000`
- sessionInit.js:203 -- auth/me uses fetchWithRetry
- sessionInit.js:244 -- auth/init uses fetchWithRetry
- If Fly machine is waking, retrying faster is better than waiting

## Implementation

- Reduce retries to 2 for auth/me (the first request on the critical path)
- Use shorter baseDelay for auth/me: 500ms instead of 1000ms
- Keep existing config for auth/init and other requests (they're less latency-sensitive)

This can be done by passing retry config as a parameter to `fetchWithRetry()`.

## Files

| File | Change |
|------|--------|
| `src/frontend/src/services/sessionInit.js` | Accept retry config params; use faster config for auth/me |

## Acceptance Criteria

- [ ] auth/me uses 2 retries with 500ms base delay
- [ ] auth/init and other callers retain existing retry config
- [ ] Retry behavior still recovers from transient 5xx errors
