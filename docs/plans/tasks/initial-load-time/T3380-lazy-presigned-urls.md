# T3380: Lazy Presigned URLs for Games

**Epic:** [Initial Load Time](EPIC.md)
**Priority:** P1
**Complexity:** 3
**Impact:** 7
**Status:** TODO

## Problem

`/api/games` generates R2 presigned URLs for every game using `asyncio.gather` over all unique game hashes. Each cache-miss URL costs ~200-300ms to R2. For a user with 10+ games, this alone can be 1-2s. These presigned URLs are only needed when the user navigates to a specific game, not on page load.

## Evidence

- games.py:828-831 -- `asyncio.gather(*[asyncio.to_thread(generate_presigned_url_global, ...) for h in unique_hashes])`
- storage.py:35 -- `_PRESIGNED_URL_CACHE` TTLCache with 3.5h TTL
- On cold cache (machine boot): every game hash = 200-300ms R2 call
- 10 games = 10 threads competing with 8 other Phase 3 endpoint threads

## Implementation

### Option A: Return games without URLs, lazy-load on navigation

1. In the bootstrap endpoint (T3370), return game metadata without presigned URLs
2. Add `GET /api/games/{game_id}/urls` that returns presigned URLs for a single game
3. Frontend calls this when user opens a specific game's detail view
4. Pre-fetch URLs for visible game cards only (intersection observer or viewport-based)

### Option B: Server-side URL cache warming (background)

1. After `user_session_init()` completes (T3340), kick off a background task that pre-generates presigned URLs for all games
2. By the time the frontend calls /api/games (or bootstrap), URLs are in `_PRESIGNED_URL_CACHE`
3. The bootstrap response includes URLs if cached, omits if not yet warmed

### Recommendation: Option A

Option A is simpler and eliminates the cost entirely from page load. Users only pay the presigned URL cost when they actually navigate to a game. The warmup endpoint (App.jsx:165) already handles video cache warming separately.

## Files

| File | Change |
|------|--------|
| `src/backend/app/routers/games.py` | Skip presigned URL generation in list_games when called from bootstrap |
| `src/backend/app/routers/bootstrap.py` | Return games without presigned URLs |
| `src/frontend/src/stores/gamesDataStore.js` | Lazy-fetch URLs when game detail is opened |

## Acceptance Criteria

- [ ] Page load does not trigger presigned URL generation for any game
- [ ] Games list renders immediately with metadata (name, date, stats)
- [ ] Presigned URLs load on demand when user views a specific game
- [ ] No visible delay when opening a game (URLs fetched while transition animates)
