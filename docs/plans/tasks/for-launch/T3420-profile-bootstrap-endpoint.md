# T3420: Profile Bootstrap Endpoint

**Epic:** For Launch - Infrastructure
**Priority:** P1
**Complexity:** 3
**Impact:** 7
**Status:** TODO

## Problem

GET /api/bootstrap takes 717-819ms server wait on a warm machine. It runs ~10 queries sequentially (profiles, credits, settings, quest progress, projects, games, downloads, exports, pending uploads). Profiling would reveal which queries are slow and where time is spent.

Target: < 400ms server wait.

## Evidence

- Production HAR: bootstrap 816ms total, 819ms ttfb on warm machine
- Staging HAR: bootstrap 748ms total, 717ms server wait
- The endpoint runs sequentially (no thread pool contention) so all 717-819ms is pure query time

## Implementation

### 1. Add server-side profiling to bootstrap

Instrument each query block with `time.perf_counter()` and log the breakdown:

```python
@router.get("/bootstrap")
async def bootstrap():
    t0 = time.perf_counter()
    # ... profiles query ...
    t_profiles = time.perf_counter() - t0

    # ... projects query ...
    t_projects = time.perf_counter() - t0 - t_profiles
    # etc.

    logger.info(f"[bootstrap] profiles={t_profiles*1000:.0f}ms projects={t_projects*1000:.0f}ms ...")
```

### 2. Identify slow queries

Expected suspects based on existing profiling data:
- **list_projects**: Multi-JOIN with game associations, clip details, working clips subquery
- **list_games**: Athlete stats computation per game (filters my_athlete clips, counts per rating)
- **quest progress**: _check_all_steps runs multiple queries per uncompleted quest

### 3. Optimize based on findings

Possible optimizations (depends on profiling results):
- Add missing indexes
- Simplify JOINs (e.g., pre-compute game stats into a column)
- Cache quest step definitions
- Batch queries where possible
- Use a single connection for all profile.sqlite queries (currently opens per-block)

## Files

| File | Change |
|------|--------|
| `src/backend/app/routers/bootstrap.py` | Add per-section timing instrumentation |
| Various query files | Optimize based on profiling findings |

## Acceptance Criteria

- [ ] Bootstrap endpoint logs per-section timing breakdown
- [ ] Identify which queries consume the most time
- [ ] Reduce bootstrap server wait from ~800ms to < 400ms
- [ ] No regression in data correctness
