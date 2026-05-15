# T2880: Backend Presigned URL Cache + Query Optimization

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-14
**Updated:** 2026-05-15

## Problem

`GET /api/games` takes 2-3.4s TTFB in production. Root cause: `list_games()` generates a presigned R2 URL **per game, serially** -- each call is a network round-trip to Cloudflare R2 (~200-300ms). For 50 games, this would be 10-15s.

Secondary contributors:
- `get_grace_deletion_hashes()` and `get_all_ref_hashes()` do full-table Postgres scans (no user_id filter)
- `/api/games` is not in `SKIP_SYNC_PATHS` despite being read-only, so db_sync middleware runs unnecessary sync checks

## Solution

### Primary: TTL cache for presigned URLs

Presigned URLs are generated with `expires_in=14400` (4 hours). Cache them in-memory keyed on `blake3_hash` with a ~3.5 hour TTL. Second and subsequent `list_games()` calls return cached URLs in ~0ms regardless of game count.

### Secondary: Parallelize cache misses

On cold cache (first load or after TTL expiry), use `asyncio.gather()` to generate all presigned URLs concurrently instead of serially. Reduces cold-cache cost from N*300ms to ~300ms.

### Tertiary: Filter full-table Postgres queries

Add `WHERE user_id = %s` filter to `get_grace_deletion_hashes()` and `get_all_ref_hashes()` to avoid scanning all users' storage refs.

### Optional: Add /api/games to SKIP_SYNC_PATHS

`list_games()` is read-only. Adding it to `SKIP_SYNC_PATHS` skips the post-response R2 sync check (~100-200ms). Evaluate whether any write side-effects exist before adding.

## Context

See [EPIC.md](EPIC.md) for the full performance analysis and HAR evidence.

### Relevant Files

- `src/backend/app/routers/games.py` - `list_games()` endpoint (lines 705-805), `get_game_video_url()` (lines 53-77)
- `src/backend/app/storage.py` - `generate_presigned_url_global()` (lines 1827-1857)
- `src/backend/app/services/auth_db.py` - `get_storage_refs_for_user()`, `get_grace_deletion_hashes()`, `get_all_ref_hashes()`
- `src/backend/app/middleware/db_sync.py` - `SKIP_SYNC_PATHS` allowlist (lines 269-278)

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
- Presigned URL cache should be module-level (not per-request) since URLs are valid for 4 hours
- Cache key: `blake3_hash` (unique per game video)
- Consider `cachetools.TTLCache` or a simple dict + timestamp
- The per-user SQLite sync on first access (500-1000ms) is a separate issue -- that's the "warmup" cost, not addressable here
- `generate_presigned_url_global` uses `TIER_3` retry config (max_attempts=2, initial_delay=0.5s)

### Related Tasks
- T1530 Comprehensive Profiling Strategy (DONE) - instrumentation that produced the SLOW FETCH/TIMING logs
- T1539 R2 Concurrent-Write Rate Limit (DONE) - R2 retry tiers used by presigned URL generation

## Implementation

### Steps

1. [ ] Add TTL cache for presigned URLs in `games.py` (keyed on blake3_hash, ~3.5h TTL)
2. [ ] Replace serial loop with `asyncio.gather()` for cache misses
3. [ ] Add user_id filter to `get_grace_deletion_hashes()` and `get_all_ref_hashes()`
4. [ ] Evaluate and optionally add `/api/games` to `SKIP_SYNC_PATHS`

## Acceptance Criteria

- [ ] `GET /api/games` TTFB < 500ms on warm cache (any game count)
- [ ] `GET /api/games` TTFB < 1s on cold cache with 50 games (parallel generation)
- [ ] `games:fetch` timing log stays under 1000ms threshold on repeat loads
- [ ] No regression in presigned URL validity (URLs still work for 4 hours)
- [ ] Backend tests pass
