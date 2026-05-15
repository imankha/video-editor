# T2880: Games List Performance + Blink Fix

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-14
**Updated:** 2026-05-14

## Problem

Two issues with the games list:

### 1. Slow backend (2-3.4s TTFB)

`GET /api/games` takes 2-3.4s TTFB in production. For users with 30 games, this would be 6-9s. Root cause: `list_games()` generates a presigned R2 URL **per game, serially** -- each call is a network round-trip to Cloudflare R2 (~200-300ms).

Secondary contributors:
- `get_grace_deletion_hashes()` and `get_all_ref_hashes()` do full-table Postgres scans (no user_id filter)
- `/api/games` is not in `SKIP_SYNC_PATHS` despite being read-only, so db_sync middleware runs unnecessary sync checks

### 2. Visual blink on navigation (games disappear and reload)

Every time the user navigates between screens, the game list flashes: games are visible, then disappear, then reload 1-3s later. Root cause is two-fold:

**Store clears UI during fetch:** `fetchGames()` sets `isLoading: true` (gamesDataStore.js:66) which blanks the list even when valid data already exists in the store.

**Redundant fetches from 6+ call sites:** Production log shows 7 `GET /api/games` calls in a single session:

| Trigger | Caller | Why redundant |
|---------|--------|---------------|
| Page load | `App.jsx:138` | Needed (first fetch) |
| Screen mount | `FramingScreen.jsx:124` | Refetches on every mount via useEffect |
| Screen mount | `ProjectsScreen.jsx:115` | Refetches on every mount via useEffect |
| After annotation | `gamesDataStore.js:325` | `finishAnnotation()` calls `fetchGames()` unconditionally |
| Auth login | `App.jsx:264` | Fires on auth transition |
| Shared view | `SharedAnnotationView.jsx:92,212` | On share resolution |
| Profile switch | `profileStore.js:229` | On profile change |

The combination means: navigate to annotate -> come back -> `fetchGames()` fires -> `isLoading: true` blanks the list -> 2s later games reappear.

## Solution

### Primary: TTL cache for presigned URLs

Presigned URLs are generated with `expires_in=14400` (4 hours). Cache them in-memory keyed on `blake3_hash` with a ~3.5 hour TTL. Second and subsequent `list_games()` calls return cached URLs in ~0ms regardless of game count.

### Secondary: Parallelize cache misses

On cold cache (first load or after TTL expiry), use `asyncio.gather()` to generate all presigned URLs concurrently instead of serially. Reduces cold-cache cost from N*300ms to ~300ms.

### Tertiary: Filter full-table Postgres queries

Add `WHERE user_id = %s` filter to `get_grace_deletion_hashes()` and `get_all_ref_hashes()` to avoid scanning all users' storage refs.

### Optional: Add /api/games to SKIP_SYNC_PATHS

`list_games()` is read-only. Adding it to `SKIP_SYNC_PATHS` skips the post-response R2 sync check (~100-200ms). Evaluate whether any write side-effects exist before adding.

### Frontend: Stale-while-revalidate pattern

Fix the visual blink by preserving existing games during refetch:

1. **Don't blank the list during fetch** -- only set `isLoading: true` if `games` array is empty (first load). If games already exist, fetch silently in the background and swap on completion.
2. **Remove redundant fetchGames() calls** -- `FramingScreen` and `ProjectsScreen` mount effects should check if games are already loaded before fetching. `finishAnnotation()` should update the specific game's view progress in the store instead of refetching the entire list.
3. **Targeted update after finish-annotation** -- instead of `fetchGames()`, update just the affected game object in the store with the new view progress data returned from the API.

## Context

### Relevant Files (REQUIRED)

**Backend:**
- `src/backend/app/routers/games.py` - `list_games()` endpoint (lines 705-805), `get_game_video_url()` (lines 53-77)
- `src/backend/app/storage.py` - `generate_presigned_url_global()` (lines 1827-1857)
- `src/backend/app/services/auth_db.py` - `get_storage_refs_for_user()`, `get_grace_deletion_hashes()`, `get_all_ref_hashes()`
- `src/backend/app/middleware/db_sync.py` - `SKIP_SYNC_PATHS` allowlist (lines 269-278)

**Frontend (blink fix):**
- `src/frontend/src/stores/gamesDataStore.js` - `fetchGames()` (line 66 sets isLoading), `finishAnnotation()` (line 325 triggers refetch)
- `src/frontend/src/App.jsx` - Initial fetch (line 138), auth transition fetch (line 264)
- `src/frontend/src/screens/FramingScreen.jsx` - Mount effect fetch (line 124)
- `src/frontend/src/screens/ProjectsScreen.jsx` - Mount effect fetch (line 115)

### Production Profile (2026-05-14)
```
[TIMING] games:fetch duration=3372ms threshold=1000ms
[SLOW FETCH] GET /api/games total=3379ms ttfb=3363ms body=16ms
```

After warmup (SQLite cached locally):
```
[SLOW FETCH] GET /api/games total=939ms ttfb=934ms body=5ms
```

The 940ms "warm" time is still the presigned URL loop cost.

### Related Tasks
- T1530 Comprehensive Profiling Strategy (DONE) - instrumentation that produced the SLOW FETCH/TIMING logs
- T1539 R2 Concurrent-Write Rate Limit (DONE) - R2 retry tiers used by presigned URL generation

### Technical Notes
- Presigned URL cache should be module-level (not per-request) since URLs are valid for 4 hours
- Cache key: `blake3_hash` (unique per game video)
- Consider `cachetools.TTLCache` or a simple dict + timestamp
- The per-user SQLite sync on first access (500-1000ms) is a separate issue -- that's the "warmup" cost, not addressable here
- `generate_presigned_url_global` uses `TIER_3` retry config (max_attempts=2, initial_delay=0.5s)

## Implementation

### Steps

**Backend:**
1. [ ] Add TTL cache for presigned URLs in `games.py` (keyed on blake3_hash, ~3.5h TTL)
2. [ ] Replace serial loop with `asyncio.gather()` for cache misses
3. [ ] Add user_id filter to `get_grace_deletion_hashes()` and `get_all_ref_hashes()`
4. [ ] Evaluate and optionally add `/api/games` to `SKIP_SYNC_PATHS`

**Frontend:**
5. [ ] Change `fetchGames()` to only set `isLoading: true` when `games` array is empty (stale-while-revalidate)
6. [ ] Guard `FramingScreen` and `ProjectsScreen` mount fetches -- skip if games already loaded
7. [ ] Replace `finishAnnotation()` -> `fetchGames()` with targeted store update of the affected game
8. [ ] Deploy and verify: no blink on navigation, games:fetch < 500ms warm

## Acceptance Criteria

- [ ] `GET /api/games` TTFB < 500ms on warm cache (any game count)
- [ ] `GET /api/games` TTFB < 1s on cold cache with 30 games (parallel generation)
- [ ] `games:fetch` timing log stays under 1000ms threshold on repeat loads
- [ ] No visual blink when navigating between screens (games stay visible during background refetch)
- [ ] No redundant `GET /api/games` calls after finish-annotation
- [ ] No regression in presigned URL validity (URLs still work for 4 hours)
- [ ] Backend + frontend tests pass
