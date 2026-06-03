# T3420: Profile Critical-Path Endpoints (auth/me + bootstrap)

**Epic:** For Launch - Infrastructure
**Priority:** P0
**Complexity:** 3
**Impact:** 9
**Status:** TODO

## Problem

Page load from HTML to interactive is 3.1s. The critical path is:

```
auth/me (1774ms) -> auth/init (400ms) -> bootstrap (741ms) = 2.9s
```

### auth/me is the #1 bottleneck (1774ms)

Production HAR proves this is NOT cold start -- a pending-uploads request 1 second earlier returned in 372ms (warm machine), yet auth/me still took 1774ms. This is consistent across every HAR capture.

auth/me does: `validate_session()` (Postgres), `update_last_seen()` (Postgres write), `update_session()` (analytics), `get_user_by_id()` (Postgres). 1.7s for 3-4 Postgres queries suggests either slow connection acquisition, slow queries, or both.

Target: < 300ms.

### bootstrap is #2 (741ms)

Runs ~10 queries sequentially (profiles, credits, settings, quest progress, projects, games, downloads, exports, pending uploads). No contention (solo request), so all 741ms is pure query time.

Target: < 400ms.

## Evidence

- Production HAR (warm machine): auth/me 1774ms server wait, bootstrap 741ms server wait
- pending-uploads (same machine, 1s earlier): 372ms server wait -- confirms machine is warm
- auth/me is 1.7-1.8s in EVERY production HAR, regardless of machine state
- Combined critical path savings potential: 1774ms -> 300ms + 741ms -> 400ms = 1.8s saved
- Projected page load after optimization: ~1.2s

## Implementation

### Phase 1: Instrument auth/me

Add `time.perf_counter()` timing around each operation in `GET /api/auth/me`:

```
[PROFILE auth/me] validate_session=Xms update_last_seen=Xms update_session=Xms get_user_by_id=Xms total=Xms
```

Suspect causes:
- **Postgres connection acquisition**: `get_pg()` context manager opening a new connection per call. If connection pooling isn't working, each call pays TCP+auth overhead to Fly Postgres.
- **validate_session**: Queries `sessions` table -- check for missing index on session_id
- **update_last_seen**: Write operation -- could be slow on shared Fly Postgres
- **update_session**: Analytics write -- may be unnecessary on the critical path (defer?)

### Phase 2: Instrument bootstrap

Add per-section timing:

```
[PROFILE bootstrap] profiles=Xms credits=Xms settings=Xms quests=Xms projects=Xms games=Xms downloads=Xms exports=Xms pending=Xms total=Xms
```

Suspect causes:
- **list_projects**: Multi-JOIN with game associations, clip details, working clips subquery
- **list_games**: Athlete stats computation per game (per-rating counts)
- **quest progress**: `_check_all_steps` runs multiple queries

### Phase 3: Optimize based on findings

Possible optimizations (depends on profiling):
- Pool Postgres connections (if not already pooled)
- Defer `update_last_seen` and `update_session` to after response (fire-and-forget)
- Add missing indexes
- Simplify JOINs or pre-compute stats
- Use a single SQLite connection for all profile-scoped bootstrap queries

## Files

| File | Change |
|------|--------|
| `src/backend/app/routers/auth.py` | Add per-operation timing to auth/me |
| `src/backend/app/routers/bootstrap.py` | Add per-section timing |
| `src/backend/app/services/auth_db.py` | Optimize based on findings |
| Various query files | Optimize based on profiling findings |

## Acceptance Criteria

- [ ] auth/me logs per-operation timing breakdown
- [ ] Bootstrap logs per-section timing breakdown
- [ ] auth/me server wait < 300ms on warm machine
- [ ] Bootstrap server wait < 400ms on warm machine
- [ ] Total page load (HTML to interactive) < 1.5s on warm machine
- [ ] No regression in data correctness
