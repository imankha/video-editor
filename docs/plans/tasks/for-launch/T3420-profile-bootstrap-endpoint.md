# T3420: Profile Critical-Path Endpoints

**Epic:** For Launch - Infrastructure
**Priority:** P0
**Complexity:** 3
**Impact:** 9
**Status:** TODO

## Problem

Every API request has a ~375ms server-wait floor -- even `/api/health` (which does no DB work) takes 375ms. This per-request overhead dominates both page load and in-app navigation.

### Evidence: 375ms baseline across all endpoints

| Endpoint | Server wait | Likely overhead | Likely query cost |
|----------|-------------|-----------------|-------------------|
| /api/health | 375ms | ~375ms | ~0ms |
| /api/auth/me | 1774ms | ~375ms | ~1400ms |
| /api/bootstrap | 741ms | ~375ms | ~366ms |
| /api/games/1 | 733ms | ~375ms | ~358ms |
| /api/clips/teammate-tags | 739ms | ~375ms | ~364ms |
| /api/games/1/playback-url | 378ms | ~375ms | ~3ms |

auth/me's 1774ms is NOT cold start -- a pending-uploads request 1s earlier on the same machine returned in 372ms.

### Impact

- Page load critical path: auth/me (1774ms) + auth/init (400ms) + bootstrap (741ms) = 2.9s
- Game load: 4 sequential requests, each paying 375ms overhead = 2.3s
- Fixing the baseline from 375ms to ~50ms would cascade across every endpoint in the app

## Implementation

### Phase 1: Profile /api/health to isolate baseline overhead

health is the simplest endpoint (no auth, no DB). If it takes 375ms, the overhead is in the middleware/framework layer. Instrument:

```
[PROFILE health] middleware_entry=Xms handler=Xms middleware_exit=Xms total=Xms
```

Instrument the middleware itself (RequestContextMiddleware in db_sync.py):
```
[PROFILE middleware] cors=Xms auth_resolve=Xms session_init=Xms sync_check=Xms handler=Xms r2_sync=Xms total=Xms
```

Suspect causes:
- **Middleware overhead**: RequestContextMiddleware runs on every request (CORS, auth, sync)
- **Postgres connection per request**: Even allowlisted paths may pay connection pool overhead
- **Python/uvicorn thread pool**: sync handlers run in threadpool; acquisition delay on 1-CPU VM

### Phase 2: Profile /api/auth/me

```
[PROFILE auth/me] validate_session=Xms update_last_seen=Xms update_session=Xms get_user=Xms total=Xms
```

Suspect causes:
- **Postgres connection acquisition**: get_pg() opening new connection per call
- **validate_session**: Missing index on session_id?
- **update_last_seen + update_session**: Writes on the critical path (could defer)

### Phase 3: Profile /api/bootstrap

```
[PROFILE bootstrap] profiles=Xms credits=Xms settings=Xms quests=Xms projects=Xms games=Xms downloads=Xms exports=Xms pending=Xms total=Xms
```

Suspect causes:
- **list_projects**: Multi-JOIN with game associations
- **list_games**: Athlete stats computation
- **quest progress**: Multiple queries in _check_all_steps

### Phase 4: Optimize based on findings

Possible optimizations (depends on profiling):
- Fix whatever causes the 375ms baseline (middleware? connection pool? thread pool?)
- Pool Postgres connections if not already pooled
- Defer update_last_seen and update_session to after response (fire-and-forget)
- Add missing indexes
- Use a single SQLite connection for all profile-scoped bootstrap queries

## Files

| File | Change |
|------|--------|
| `src/backend/app/middleware/db_sync.py` | Add per-phase timing to middleware |
| `src/backend/app/routers/health.py` | Add timing instrumentation |
| `src/backend/app/routers/auth.py` | Add per-operation timing to auth/me |
| `src/backend/app/routers/bootstrap.py` | Add per-section timing |
| Various | Optimize based on profiling findings |

## Acceptance Criteria

- [ ] /api/health logs middleware timing breakdown
- [ ] Middleware logs per-phase timing for all requests
- [ ] auth/me logs per-operation timing breakdown
- [ ] Bootstrap logs per-section timing breakdown
- [ ] Identify root cause of 375ms per-request baseline
- [ ] auth/me server wait < 300ms on warm machine
- [ ] Bootstrap server wait < 400ms on warm machine
- [ ] Total page load (HTML to interactive) < 1.5s on warm machine
- [ ] No regression in data correctness
