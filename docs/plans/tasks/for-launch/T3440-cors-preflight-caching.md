# T3440: Cache CORS Preflight Responses

**Epic:** For Launch - Infrastructure
**Priority:** P2
**Complexity:** 1
**Impact:** 5
**Status:** TODO

## Problem

Every cross-origin API request triggers a CORS preflight (OPTIONS) that hits the backend. The browser cannot cache these because the backend does not send `Access-Control-Max-Age`. On a game load, this adds 826ms across 5 preflights (17.8% of total page time).

## Evidence

Production HAR (staging, 2026-06-03):
- OPTIONS /api/health: 32ms
- OPTIONS /api/clips/teammate-tags: 28ms
- OPTIONS /api/games/1: 725ms (thread pool contention with parallel GETs)
- OPTIONS /api/games/1/playback-url: 20ms
- OPTIONS /api/clips/teammate-shares/1: 20ms
- Total preflight overhead: 826ms

The 725ms OPTIONS for games/1 is extreme because it contends with the actual GET on the single-CPU thread pool. But even on a warm machine, each preflight adds 20-30ms of round-trip overhead that's completely unnecessary after the first request to each URL pattern.

## Solution

Add `Access-Control-Max-Age` header to CORS middleware configuration. This tells browsers how long (in seconds) to cache the preflight response for each URL.

Recommended value: `7200` (2 hours). This is the max that Chrome respects (Firefox respects up to 24h, Safari up to 7 days). After the first preflight, subsequent requests to the same URL skip the OPTIONS request entirely for 2 hours.

## Implementation

### Backend

In `src/backend/app/main.py`, find the CORS middleware configuration and add `max_age=7200`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[...],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=7200,  # Cache preflight responses for 2 hours
)
```

This is a one-line change.

### Verification

1. Deploy to staging
2. Open DevTools Network tab, filter by "Method: OPTIONS"
3. First page load: preflights fire normally
4. Navigate to a game, then back, then to a game again
5. Second navigation should show zero preflight requests (cached)
6. Capture HAR, confirm no OPTIONS requests on second game load

## Files

| File | Change |
|------|--------|
| `src/backend/app/main.py` | Add `max_age=7200` to CORSMiddleware |

## Acceptance Criteria

- [ ] `Access-Control-Max-Age: 7200` header present on OPTIONS responses
- [ ] Second game navigation fires zero preflight requests (browser caches them)
- [ ] No regression in cross-origin requests from staging or production origins
