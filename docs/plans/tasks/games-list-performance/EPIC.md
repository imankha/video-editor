# Epic: Games List Performance

**Status:** TODO
**Created:** 2026-05-15
**Priority:** P1

## Goal

Cut games list load time from 8.5s to under 4s. Eliminate the 3.2s backend presigned URL bottleneck and the frontend blink on navigation. Scales to 50 games.

The sequential video warming chain (5.3s) is fixed by T2890 (Cache Warming Efficiency), a standalone warming system upgrade that benefits all video types. This epic handles the games-specific pieces.

## Evidence

**HAR file:** `Downloads/app.reelballers.com-annotate.har` (2026-05-15)

- 47 requests | 50MB | 8515ms page load
- **Backend bottleneck:** `/api/games` TTFB 3.2s (serial presigned URL generation, one R2 round-trip per game)
- **Frontend blink:** Games disappear and reload on every screen navigation (6+ redundant `fetchGames()` calls)

### Scale Projection (50 games)

| Metric | Current (8 games) | Projected (50 games) |
|--------|-------------------|---------------------|
| Backend `/api/games` TTFB | 3.2s | 10-15s (serial presigned URL gen) |
| Frontend blink duration | 2-3s | 10-15s |

## Sequencing

| # | ID | Task | Why This Order |
|---|----|------|----------------|
| 1 | T2880 | [Backend Presigned URL Cache](T2880-backend-presigned-url-cache.md) | Foundation: cuts /api/games from 3.2s to <300ms. Blink fix depends on fast API response. |
| 2 | T2885 | [Games Blink Fix](T2885-games-blink-fix.md) | With fast API, stale-while-revalidate makes refetches invisible. |

## Dependencies

- **T2890** [Cache Warming Efficiency](../T2890-cache-warming-efficiency.md) -- Standalone warming system upgrade (concurrent workers + dedup + viewport priority). Fixes the 5.3s sequential video warming chain that accounts for most of the 8.5s page load. Can be implemented in parallel with this epic.

## Shared Context

### Key architectural facts
- **Presigned URLs are valid for 4 hours** (`expires_in=14400`). Caching them server-side with ~3.5h TTL is safe.
- **`fetchGames()` blink** is caused by `isLoading: true` blanking the list even when valid data exists.
- **6+ call sites** trigger `fetchGames()`: App init, auth transition, screen mounts, finish-annotation, share resolution, profile switch.
- **Gesture-based persistence**: All changes here are read-only (fetch + cache). No persistence concerns.

### Files affected

| File | T2880 | T2885 |
|------|-------|-------|
| `src/backend/app/routers/games.py` | **PRIMARY** | |
| `src/backend/app/storage.py` | review | |
| `src/backend/app/services/auth_db.py` | **PRIMARY** | |
| `src/backend/app/middleware/db_sync.py` | review | |
| `src/frontend/src/stores/gamesDataStore.js` | | **PRIMARY** |
| `src/frontend/src/App.jsx` | | review |
| `src/frontend/src/screens/FramingScreen.jsx` | | review |
| `src/frontend/src/screens/ProjectsScreen.jsx` | | review |

## Completion Criteria

- [ ] `GET /api/games` TTFB < 500ms warm, < 1s cold (any game count)
- [ ] No visual blink when navigating between screens
- [ ] No redundant `GET /api/games` calls after finish-annotation
- [ ] Combined with T2890: page load under 4s for 8 games, under 6s for 50 games
