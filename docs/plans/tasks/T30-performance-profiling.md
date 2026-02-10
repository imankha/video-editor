# Task 16: Performance Profiling & Optimization

## Overview
Profile the production deployment to identify memory usage patterns and slow endpoints, then fix any performance issues found.

## Owner
**Claude** - Analysis and optimization task

## Prerequisites
- Task 12 complete (Production deployment live)
- Real traffic or realistic test data

## Testability
**After this task**: All endpoints respond quickly, memory usage is predictable, no performance regressions.

---

## Why Profile After Deployment?

Local development hides production-specific issues:
- Cold starts on Fly.io
- R2 latency from different regions
- Database sync overhead under load
- Memory pressure with scale-to-zero

---

## Profiling Areas

### 1. Endpoint Latency

**Tools:**
- Fly.io metrics dashboard
- `curl -w "@curl-format.txt"` for individual requests
- Backend logging with timing (`[SLOW REQUEST]` tags already exist)

**Targets:**
| Endpoint Type | Target | Local Baseline (2026-02-09) |
|---------------|--------|------------------------------|
| Health check | <50ms | 10ms ✅ |
| List endpoints (games, projects, clips) | <200ms | 16-45ms ✅ |
| Single item GET | <100ms | TBD (staging) |
| Database writes | <300ms | TBD (staging) |
| R2 presigned URL generation | <100ms | TBD (staging) |

**Local Profiling Baseline (2026-02-09):**
| Endpoint | Time | Target | Status |
|----------|------|--------|--------|
| GET /api/health | 10ms | <50ms | ✅ Pass |
| GET /api/games | 16ms | <200ms | ✅ Pass |
| GET /api/projects | 23ms | <200ms | ✅ Pass |
| GET /api/downloads | 45ms | <200ms | ✅ Pass |
| GET /api/clips/raw | ~35ms | <200ms | ✅ Pass |

**Known slow paths to investigate:**
- `/api/games` - loads all games with aggregate counts
- `/api/downloads` - complex query with grouping
- `/api/clips/raw` - may load large JSON blobs
- Database sync on every request

### 2. Memory Usage

**Tools:**
- Fly.io metrics (memory graphs)
- Python `tracemalloc` for detailed analysis
- `memory_profiler` decorator on suspect functions

**Targets:**
| Metric | Target | Notes |
|--------|--------|-------|
| Baseline memory | <256MB | Idle app |
| Per-request overhead | <10MB | Should be released after request |
| Peak during export | <512MB | With video in memory |

**Suspect areas:**
- Video file handling (should stream, not load entirely)
- Large JSON responses (annotations, highlight keyframes)
- Database connection pooling
- AI upscaler model loading (if enabled locally)

### 3. Database Performance

**Tools:**
- SQLite `EXPLAIN QUERY PLAN`
- Timing logs for sync operations
- Query count per request

**Targets:**
- No N+1 queries (one query per entity type, not per row)
- Database sync <500ms (already have warning threshold)
- Indexes on frequently filtered columns

**Queries to audit:**
```sql
-- Check for missing indexes
EXPLAIN QUERY PLAN SELECT * FROM games WHERE id = ?;
EXPLAIN QUERY PLAN SELECT * FROM raw_clips WHERE game_id = ?;
EXPLAIN QUERY PLAN SELECT * FROM annotations WHERE game_id = ?;
```

---

## Profiling Process

### Step 1: Baseline Measurement

```bash
# 1. Deploy with profiling enabled
fly deploy --env PROFILE_ENABLED=true

# 2. Run load test
ab -n 100 -c 10 https://api.reelballers.com/api/health
ab -n 50 -c 5 https://api.reelballers.com/api/games
ab -n 50 -c 5 https://api.reelballers.com/api/downloads

# 3. Capture metrics
fly logs --app reel-ballers-api | grep -E "(SLOW|timing|memory)"
```

### Step 2: Identify Bottlenecks

Add timing middleware (if not already present):

```python
# app/middleware/timing.py
import time
import logging

logger = logging.getLogger(__name__)

async def timing_middleware(request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start

    if duration > 0.2:  # 200ms threshold
        logger.warning(f"[SLOW REQUEST] {request.method} {request.url.path} - {duration:.2f}s")

    return response
```

### Step 3: Fix Issues

Common fixes:

**Slow list endpoints:**
```python
# Before: N+1 query
games = get_all_games()
for game in games:
    game['annotations'] = get_annotations(game['id'])  # N queries!

# After: Single query with JOIN or batch load
games = get_all_games_with_annotations()  # 1 query
```

**Large JSON responses:**
```python
# Before: Return everything
return {"games": [full_game_dict(g) for g in games]}

# After: Paginate or return summary
return {"games": [game_summary(g) for g in games[:50]], "has_more": len(games) > 50}
```

**Memory leaks:**
```python
# Before: Hold video in memory
video_data = await video.read()  # Entire file in RAM

# After: Stream to disk
with tempfile.NamedTemporaryFile() as f:
    async for chunk in video.stream():
        f.write(chunk)
```

### Step 4: Verify Improvements

```bash
# Re-run load tests
ab -n 100 -c 10 https://api.reelballers.com/api/games

# Compare metrics
# - p50, p95, p99 latencies
# - Memory usage over time
# - Error rates
```

---

## Deliverables

| Item | Description |
|------|-------------|
| Profiling report | Document with baseline measurements |
| Identified issues | List of slow endpoints and memory problems |
| Fixes implemented | PRs with optimizations |
| Before/after metrics | Proof of improvement |

---

## Success Criteria

- [x] All list endpoints <200ms at p95 (local)
- [ ] Memory stays flat over 1 hour of requests (staging)
- [x] No [SLOW REQUEST] warnings in normal operation (local)
- [x] Database sync stays under 500ms threshold
- [ ] Cold start <3s (Fly.io constraint) (staging)

---

## Implementation Log

### T30 Local Profiling (2026-02-09)

**Infrastructure Changes:**
1. `app/middleware/db_sync.py`: Lowered `SLOW_REQUEST_THRESHOLD` from 2.0s to 0.2s (200ms)
2. `app/database.py`: Added query timing to `TrackedCursor.execute()` with 100ms threshold
   - Logs `[SLOW QUERY]` warnings for queries exceeding 100ms
   - Uses `time.perf_counter()` for high-resolution timing

**Query Pattern Analysis:**
| Endpoint | Queries | Pattern | N+1 Risk |
|----------|---------|---------|----------|
| `/api/games` | 1 | Single SELECT | None ✅ |
| `/api/projects` | 4 | Main + 3 batch | None ✅ |
| `/api/downloads` | 3 | Main + 2 batch | None ✅ |
| `/api/clips/raw` | 1 | Single JOIN | None ✅ |

**Indexes Verified:**
- `idx_raw_clips_game_id` - game filtering
- `idx_raw_clips_game_end_time` - natural key lookup
- `idx_working_clips_project_version` - version queries
- `idx_export_jobs_project/status` - job lookups
- `idx_modal_tasks_status/game_id` - task filtering

**Findings:**
- All endpoints well within targets for local profiling
- No N+1 query patterns detected
- Comprehensive indexes in place
- Need staging deployment for network latency, R2 latency, cold start testing

---

## Next Step
Task 13 - User Management (optional) or Task 14 - Wallet & Payments (optional)
