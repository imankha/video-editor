# T230: Pre-warm R2 Cache on User Login

**Status:** TODO
**Impact:** MEDIUM
**Complexity:** LOW
**Created:** 2026-02-10
**Updated:** 2026-02-10
**Depends On:** T200 (User Management)

## Problem

R2 videos have slow first-load times (60+ seconds) when not cached at Cloudflare's edge. Currently we pre-warm cache when the games list loads, but this only helps if the user waits on the games list before clicking a game.

## Solution

Pre-warm all of a user's game video URLs immediately after login, ensuring videos are cached at the edge before the user tries to access them.

## Context

### Background (T55)

T55 identified that R2 cold cache is the root cause of slow video loads:
- First load: 60+ seconds (CDN cache miss)
- Second load: <1 second (CDN cache hit)

T55 implemented immediate fixes:
- CORS configuration for R2 bucket
- Cache warming when games list loads
- Better progress feedback during slow loads

This task extends that work to trigger warming on login.

### Relevant Files
- `src/frontend/src/utils/cacheWarming.js` - Cache warming utility (created in T55)
- `src/frontend/src/hooks/useGames.js` - Currently warms cache on fetchGames
- `src/frontend/src/hooks/useAuth.js` - (To be created with T200)

### Related Tasks
- Depends on: T200 (User Management - auth system)
- Related to: T55 (Slow Video Loading - initial fix)

## Implementation

### Steps
1. [ ] Add `warmUserVideos()` function that fetches all games for a user and warms their video URLs
2. [ ] Call `warmUserVideos()` after successful login
3. [ ] Consider also warming on page visibility change (user returns to tab after being away)
4. [ ] Add optional aggressive warming mode that requests first 1MB instead of 1KB

### Optional Enhancements
- Pre-warm on hover over game card (before click)
- Background refresh of cache every 30 minutes for long sessions
- Warm cache during page idle time

## Acceptance Criteria

- [ ] All user's game videos are warmed immediately after login
- [ ] Warming happens in background without blocking UI
- [ ] No redundant warming requests (already-warmed URLs are skipped)
- [ ] Works with the existing `cacheWarming.js` utility
