# T2880: Backend Presigned URL Cache + Query Optimization

**Status:** TESTING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-14
**Updated:** 2026-05-15

## Problem

`GET /api/games` takes 2-3.4s TTFB in production. Root cause: `list_games()` generates a presigned R2 URL **per game, serially** -- each call is a network round-trip to Cloudflare R2 (~200-300ms). For 50 games, this would be 10-15s.

Secondary contributors:
- `get_all_ref_hashes()` does a full-table Postgres scan on `game_storage_refs` (no user_id filter). Note: `get_grace_deletion_hashes()` scans `r2_grace_deletions` which has no `user_id` column, so it cannot be filtered.
- `GET /api/games` is not in `SKIP_SYNC_PATHS`, so db_sync middleware runs unnecessary R2 sync checks on a read-only endpoint

## Solution

### Primary: TTL cache for presigned URLs

Presigned URLs are generated with `expires_in=14400` (4 hours). Cache them in-memory inside `generate_presigned_url_global()` (storage.py) keyed on `(key, expires_in)` with a ~3.5 hour TTL. This benefits all callers: `list_games()`, `/storage/warmup`, clips, and exports. Second and subsequent calls for the same R2 object return cached URLs in ~0ms.

### Secondary: Parallelize cache misses

On cold cache (first load or after TTL expiry), use `asyncio.gather()` to generate all presigned URLs concurrently instead of serially. Reduces cold-cache cost from N*300ms to ~300ms.

Note: `generate_presigned_url_global()` is synchronous (boto3). Use `asyncio.to_thread()` to wrap each call for concurrent execution within `asyncio.gather()`.

### Tertiary: Filter `get_all_ref_hashes()` by user_id

Add `WHERE user_id = %s` filter to `get_all_ref_hashes()` in `auth_db.py`. The `game_storage_refs` table has a `user_id` column with an index (`idx_game_refs_user`). This avoids scanning all users' refs when only the current user's hashes matter for the `can_extend` check.

`get_grace_deletion_hashes()` cannot be filtered -- `r2_grace_deletions` schema is `(blake3_hash PK, grace_expires_at, created_at)` with no user_id column.

### Optional: Add `GET /api/games` to SKIP_SYNC_PATHS

`list_games()` is read-only, but `SKIP_SYNC_PATHS` uses prefix matching (`path.startswith(prefix)`) with no HTTP method filter. Adding `'/api/games'` would also skip sync for POST/PUT/DELETE game routes (create, update, delete, upload, share, etc.), which DO write to SQLite and need R2 sync.

Options:
- Add a narrow prefix like `'/api/games/tournaments'` for known read-only sub-routes (minimal win)
- Modify the middleware to support method-aware skip (e.g., `(prefix, methods)` tuples) — more invasive
- Skip this optimization — the sync overhead (~100-200ms) is minor compared to the presigned URL win

## Context

See [EPIC.md](EPIC.md) for the full performance analysis and HAR evidence.

### Relevant Files

- `src/backend/app/routers/games.py` - `get_game_video_url()` (lines 54-78), `list_games()` endpoint (lines 706-806)
- `src/backend/app/storage.py` - `generate_presigned_url_global()` (lines 1827-1858, synchronous/boto3) -- **cache goes here**
- `src/backend/app/routers/storage.py` - `/storage/warmup` endpoint (lines 202-396) also calls `generate_presigned_url_global()` serially (lines 267-269); benefits from the cache
- `src/backend/app/services/auth_db.py` - `get_all_ref_hashes()` (line 404, full-table scan, filterable), `get_grace_deletion_hashes()` (line 454, no user_id column)
- `src/backend/app/middleware/db_sync.py` - `SKIP_SYNC_PATHS` (lines 269-278, prefix match, no method filter)
- `src/backend/app/services/pg.py` - `game_storage_refs` schema (line 72, has user_id + index), `r2_grace_deletions` schema (line 85, no user_id)

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

### Technical Notes
- Presigned URL cache should be module-level in `storage.py` (not per-request) since URLs are valid for 4 hours
- Cache key: `(key, expires_in)` tuple -- `key` is the R2 path (e.g., `games/{hash}.mp4`), `expires_in` differentiates 4h vs 1h URLs
- `cachetools==6.2.2` is already in requirements.txt -- use `cachetools.TTLCache`
- The per-user SQLite sync on first access (500-1000ms) is a separate issue -- that's the "warmup" cost, not addressable here
- `generate_presigned_url_global` uses `TIER_3` retry config (max_attempts=2, initial_delay=0.5s)
- `get_game_video_url` is also called from `clips.py` (lines 1199, 1699) and other `games.py` endpoints (lines 1056, 1197) -- all callers benefit from the cache automatically
- **`/storage/warmup` also generates presigned URLs serially** via direct `generate_presigned_url_global()` calls (storage.py lines 267-269), NOT via `get_game_video_url()`. Place the cache in `generate_presigned_url_global()` itself (in storage.py) so both `/api/games` and `/storage/warmup` benefit. The warmup endpoint uses `expires_in=3600` (1h, from query param default) vs games' `expires_in=14400` (4h) -- cache key must include `expires_in` to avoid serving a 1h URL when a 4h one was requested.
- Tests that mock `generate_presigned_url_global` exist in `test_t1690_stream_proxy_probe.py` and `test_auto_export.py` -- since the cache is inside `generate_presigned_url_global`, mocks that patch the function at the import site will bypass the cache entirely (correct behavior for tests)

### Related Tasks
- T1530 Comprehensive Profiling Strategy (DONE) - instrumentation that produced the SLOW FETCH/TIMING logs
- T1539 R2 Concurrent-Write Rate Limit (DONE) - R2 retry tiers used by presigned URL generation
- T2890 Cache Warming Efficiency (DONE) - frontend concurrent workers + dedup + viewport priority. The warmup endpoint (`/storage/warmup`) also generates presigned URLs serially via `generate_presigned_url_global()` -- the cache in T2880 speeds up warmup responses too, reducing the gap between API response and first video warm

## Implementation

### Steps

1. [ ] Add module-level `cachetools.TTLCache` in `storage.py` (maxsize=1000, ttl=12600). Add cache check/populate inside `generate_presigned_url_global()`. Cache key = `(key, expires_in)` tuple -- needed because `/storage/warmup` uses `expires_in=3600` while `/api/games` uses `expires_in=14400`.
2. [ ] In `list_games()`, collect blake3 hashes with cache misses, generate presigned URLs concurrently via `asyncio.gather(*[asyncio.to_thread(generate_presigned_url_global, ...) for ...])`, populate cache, then build response using cached URLs.
3. [ ] Add `user_id` param to `get_all_ref_hashes()` in `auth_db.py`, add `WHERE user_id = %s` filter. Update caller in `list_games()` (line 744).
4. [ ] Evaluate SKIP_SYNC_PATHS -- likely skip this step since prefix matching would affect write routes (see Solution § Optional above).

## Acceptance Criteria

- [ ] `GET /api/games` TTFB < 500ms on warm cache (any game count)
- [ ] `GET /api/games` TTFB < 1s on cold cache with 50 games (parallel generation)
- [ ] `games:fetch` timing log stays under 1000ms threshold on repeat loads
- [ ] No regression in presigned URL validity (URLs still work for 4 hours)
- [ ] Backend tests pass
