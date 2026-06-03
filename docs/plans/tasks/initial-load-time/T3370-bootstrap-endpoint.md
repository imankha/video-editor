# T3370: Bootstrap Endpoint

**Epic:** [Initial Load Time](EPIC.md)
**Priority:** P0
**Complexity:** 5
**Impact:** 10
**Status:** TODO

## Problem

After auth completes, the frontend fires 9+ separate API calls that all hit the same Fly.io machine. Each request has per-request overhead: server-side auth validation, middleware session check, SQLite file open/close, and HTTP round-trip. With all requests on a single 1-CPU VM, they contend for the same threadpool -- evidenced by all 9 endpoints returning within 20ms of each other (3625-3645ms) regardless of query complexity.

## Evidence

| # | Endpoint | Server Wait | Query Cost |
|---|----------|-------------|------------|
| 1 | GET /api/profiles | 3625ms | Very light (2 queries) |
| 2 | GET /api/games | 3632ms | Heavy (multi-JOIN + presigned URLs) |
| 3 | GET /api/projects | 3625ms | Heavy (multi-JOIN + game assoc) |
| 4 | GET /api/quests/progress | 3625ms | Medium |
| 5 | GET /api/downloads/count | 3642ms | Light (1 query) |
| 6 | GET /api/exports/active | 3641ms | Light |
| 7 | GET /api/exports/unacknowledged | 3641ms | Light |
| 8 | GET /api/games/pending-uploads | 3644ms | Light + R2 HEAD per upload |
| 9 | GET /storage/warmup | 3644ms | Medium (SQLite + R2) |

20ms spread across 9 endpoints = thread pool convoy, not individual endpoint slowness.

## Implementation

### Backend: Create GET /api/bootstrap

New file: `src/backend/app/routers/bootstrap.py`

```python
GET /api/bootstrap -> {
    "profiles": [...],
    "projects": [...],
    "games": [...],           # metadata only, no presigned URLs (T3380)
    "quests_progress": [...],
    "exports": {
        "active": [...],
        "unacknowledged": [...]
    },
    "downloads": {
        "count": N,
        "unwatched_count": N
    },
    "pending_uploads": [...],  # raw list, no R2 validation (T3380-style lazy)
    "warmup": {
        "r2_enabled": bool,
        "project_clips": [...],
        "game_urls": [...]
    }
}
```

Key implementation details:
- Open profile SQLite ONCE, run all queries, close
- Call each data source's existing query function (reuse, don't duplicate)
- Skip R2 HEAD validation for pending uploads (just return raw list)
- Return game metadata without presigned URLs (see T3380)
- Run in a single thread -- no threadpool contention

### Frontend: Consume bootstrap response

After auth/init resolves (or after T3360's Phase B):
- Call `GET /api/bootstrap` once
- Distribute response fields to each Zustand store via new `setFromBootstrap(data)` methods
- Remove individual `fetch*()` calls from the page-load path

### Keep individual endpoints

Individual endpoints remain for:
- Refresh/polling (e.g., polling exports during active export)
- Store-specific refetch after mutations
- Bootstrap is initial-load only

## Files

| File | Change |
|------|--------|
| `src/backend/app/routers/bootstrap.py` | New: bootstrap endpoint |
| `src/backend/app/main.py` | Register bootstrap router |
| `src/frontend/src/App.jsx` | Replace 9 individual fetches with single bootstrap call |
| `src/frontend/src/stores/profileStore.js` | Add `setFromBootstrap()` |
| `src/frontend/src/stores/gamesDataStore.js` | Add `setFromBootstrap()` |
| `src/frontend/src/stores/projectsStore.js` | Add `setFromBootstrap()` |
| `src/frontend/src/stores/questStore.js` | Add `setFromBootstrap()` |
| `src/frontend/src/stores/galleryStore.js` | Add `setFromBootstrap()` |
| `src/frontend/src/hooks/useExportRecovery.js` | Read from bootstrap instead of separate fetch |

## Acceptance Criteria

- [ ] Single GET /api/bootstrap replaces 9+ individual data fetch calls
- [ ] Response time < 1s on warm machine (vs 3.6s for 9 concurrent calls)
- [ ] All stores populated from bootstrap response identically to individual fetches
- [ ] Individual endpoints still work for refresh/polling
- [ ] No CORS preflight explosion (1 preflight vs 9+)
- [ ] HAR shows single data call after auth, not 9 parallel calls
