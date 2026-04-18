# T1590: PATCH /api/projects/{id}/state Slow (1s+)

## Problem

`PATCH /api/projects/{id}/state` consistently takes 1000-1100ms, visible as a
slow fetch in frontend profiling. The call is made when entering/leaving Framing
mode to persist project state (selected clip, mode, scroll position).

From profiling logs:
```
[SLOW FETCH] PATCH /api/projects/1/state total=1074ms ttfb=1073ms body=0ms
```

Backend REQ_TIMING breakdown from prior sessions shows the time splits between:
- Handler: ~400ms (SQLite write + commit)
- R2 DB sync: ~500-600ms (HeadObject version check + PutObject upload)

## Root Cause (Hypothesis)

The middleware's synchronous R2 sync runs on every mutating request. For a small
metadata update like project state, the R2 round trip dominates. This is the same
pattern that caused `GET /api/games/{id}` to be slow (fixed by removing
`update_global_access_time` in T1530).

## Possible Fixes

1. **Background sync for non-critical writes** -- project state is non-critical
   (worst case: user re-selects their clip). Could skip sync or defer it.
2. **Batch/debounce R2 sync** -- if multiple writes happen in quick succession,
   only sync once at the end.
3. **Per-resource sync** -- T1538 (Per-Resource Locks) may reduce contention
   that adds to sync time.

## Acceptance Criteria

- [ ] `PATCH /api/projects/{id}/state` completes in <300ms
- [ ] No data loss -- state must eventually reach R2

## Priority

P2 -- not blocking but user-visible latency on every mode transition.
