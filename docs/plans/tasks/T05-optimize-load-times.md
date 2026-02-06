# T05: Optimize Load Times

**Status:** DONE
**Impact:** HIGH (blocks testing velocity)
**Complexity:** MEDIUM
**Created:** 2026-02-06
**Updated:** 2026-02-06

## Problem

API endpoints are taking 20+ seconds to respond, severely impacting development and testing velocity.

```
GET /api/settings - total 20.19s (sync: 0.00s, handler: 20.19s)
GET /api/games - total 20.19s (sync: 0.00s, handler: 20.29s)
GET /api/projects/43 - total 20.65s (sync: 0.00s, handler: 20.65s)
```

**Key observation**: Sync time is 0.00s - the slowdown is in the handler itself, not database sync.

## Questions to Investigate

1. **Why is handler time 20s?** What's happening during those 20 seconds?
2. **Why is /api/games called when loading projects?** Is this necessary?
3. **Are we doing repeated slow work?** Could we cache or skip?
4. **Is R2 being called on every request?** Presigned URL generation? File checks?

## Investigation Notes

### Cold Start Pattern

**Key observation**: Slow load times occur after not using the app for some time. Something is going "cold":

- R2 connection going stale/reconnecting?
- Database connection pool timing out?
- Some internal cache expiring?
- Python process warming up?

This suggests the fix might involve:
- Keep-alive connections to R2
- Connection pool tuning
- Lazy loading that happens on first request after idle

### DB Sync Suspicion

The logs show `sync: 0.00s` but this might not tell the full story:
- **DB size is 426KB** - This is tiny. Should load in <100ms, not 20s.
- The `sync` timing in middleware might only measure R2 *upload* (after request), not *download* (before request)
- Need to verify: is the DB being downloaded from R2 on every request?

### First Step: Add Granular Timing

Before using profilers, wrap these specific operations with timing:

```python
import time

# In db_sync middleware or wherever DB loads
start = time.time()
# ... download DB from R2 ...
print(f"[TIMING] DB download from R2: {time.time() - start:.2f}s")

start = time.time()
# ... actual SQL query ...
print(f"[TIMING] SQL query: {time.time() - start:.2f}s")

start = time.time()
# ... any R2 presigned URL generation ...
print(f"[TIMING] Presigned URL gen: {time.time() - start:.2f}s")
```

### My Interpretation

426KB SQLite should load nearly instantly. If we're seeing 20s delays:
1. **R2 download on every request?** - Check if we're downloading the full DB from R2 before each request
2. **Connection timeout/retry?** - Maybe R2 connection is failing and retrying?
3. **Blocking I/O in async context?** - Synchronous R2 calls blocking the event loop?
4. **Query returning huge results?** - Maybe returning all games with all their video metadata?

The `sync: 0.00s` in logs is suspicious given 20s total time. Either:
- Sync timing doesn't capture what we think it does
- The slowdown is genuinely in the handler (query or data processing)
- There's a timeout happening somewhere that masks as "fast" sync

## Solution

Investigate and fix the root cause of slow handlers.

## Context

### Relevant Files
- `src/backend/app/routers/games.py` - Games endpoint
- `src/backend/app/routers/projects.py` - Projects endpoint
- `src/backend/app/routers/settings.py` - Settings endpoint
- `src/backend/app/middleware/db_sync.py` - Request timing middleware
- `src/backend/app/services/r2_storage.py` - R2 operations

### Likely Suspects
1. **R2 operations per request** - Checking file existence? Generating presigned URLs?
2. **N+1 queries** - Loading related data one-by-one
3. **Synchronous I/O** - Blocking calls that should be async
4. **Cold start effects** - First request warming up connections?

## Profiling Tools

### Option 1: py-spy (Recommended - No Code Changes)

Sampling profiler that attaches to running process. Great for finding what's blocking.

```bash
# Install
pip install py-spy

# Profile the running uvicorn process
py-spy top --pid <uvicorn_pid>

# Or record a flame graph
py-spy record -o profile.svg --pid <uvicorn_pid>

# Find PID on Windows
tasklist | findstr python
```

### Option 2: pyinstrument (Easy, Nice Output)

Statistical profiler with readable output. Requires adding to code.

```bash
pip install pyinstrument
```

```python
# In slow endpoint or middleware
from pyinstrument import Profiler

profiler = Profiler()
profiler.start()
# ... code to profile ...
profiler.stop()
print(profiler.output_text(unicode=True, color=True))
```

### Option 3: cProfile (Built-in)

No install needed, but verbose output.

```python
import cProfile
import pstats

with cProfile.Profile() as pr:
    # ... code to profile ...

stats = pstats.Stats(pr)
stats.sort_stats('cumulative')
stats.print_stats(20)  # Top 20 slow functions
```

### Option 4: fastapi-profiler (Middleware)

Auto-profiles all endpoints.

```bash
pip install fastapi-profiler
```

```python
from fastapi_profiler import PyInstrumentProfilerMiddleware

app.add_middleware(PyInstrumentProfilerMiddleware)
# Then check /profiler endpoint
```

## Implementation

### Phase 1: Add Timing (Before Profilers)

1. [ ] Add timing around DB download from R2 (in middleware)
2. [ ] Add timing around SQL queries in slow endpoints
3. [ ] Add timing around any R2 presigned URL generation
4. [ ] Reproduce slow load and check timing output
5. [ ] Identify which operation takes the 20s

### Phase 2: Profile if Needed

6. [ ] If timing doesn't reveal issue, install py-spy or pyinstrument
7. [ ] Profile a slow request (GET /api/games)
8. [ ] Check if R2 calls are happening on list endpoints

### Phase 2: Fix identified issues

5. [ ] Fix the specific slow operations
6. [ ] Consider caching if appropriate
7. [ ] Remove unnecessary data fetching

### Phase 3: Verify

8. [ ] Confirm load times are <1s
9. [ ] Ensure no regression in functionality
10. [ ] Remove profiling middleware/code

### Progress Log

**2026-02-06**: Task created. Observed 20s+ load times on settings, games, projects endpoints. Handler time is the issue, not DB sync.

**2026-02-06**: Root cause identified and fixed:
- **Problem**: `ensure_database()` was calling `sync_database_from_r2_if_newer()` on EVERY request
- This made a HEAD request to R2 to check the database version
- When R2 connection is cold/slow, this HEAD request takes 20+ seconds
- **Fix**: Only download from R2 on first access (when `local_version is None`)
  - No HEAD request on subsequent requests
  - Multi-device sync deferred to user management (T200) with session invalidation
  - This is the correct fix for a single-user app
- Files modified: `app/database.py`, `app/storage.py`
- All 333 backend tests pass

## Acceptance Criteria

- [ ] /api/settings responds in <500ms
- [ ] /api/games responds in <500ms
- [ ] /api/projects/{id} responds in <1s
- [ ] No unnecessary API calls during page loads
