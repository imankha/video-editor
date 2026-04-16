# T1538: Per-Resource Locks (finer-grained write serialization)

**Status:** TODO
**Impact:** 4 (incremental win on top of T1531; meaningful only when contention persists)
**Complexity:** 6
**Created:** 2026-04-16
**Updated:** 2026-04-16

## Problem

T1531 introduced a per-user write lock so concurrent writers can't race on the
R2 db-version. That fixed the user-visible cascade where an in-flight POST
blocked sibling reads. But two writers from the same user still serialize
even when they touch unrelated tables (e.g. `POST /achievements` and
`PATCH /projects/{id}/state` cannot run in parallel).

This is correct but coarse. If we observe sustained writer contention in
`[WRITE_LOCK_WAIT]` logs (the new instrumentation T1531 added), per-resource
locks become attractive: an achievement write should not wait on a project
state update, because the two never read or write each other's data.

## Goal

Reduce per-user writer serialization to per-`(user, table_set)` granularity,
so writers that touch disjoint table sets run in parallel. Preserve the R2
version-race protection for writers that DO overlap.

## Why this is harder than T1531

The R2 version-race is the hard part. Today the entire `profile.sqlite` is
synced to R2 as one blob with a monotonically-increasing `db-version`. Two
writers serialize via the per-user lock so the sync ordering is sequential.
With per-resource locks, two writers complete in parallel and BOTH need to
push to R2 — but the R2 object only has one version slot. We need either:

1. **Version reconciliation on push** — last-writer-wins is broken; we'd
   need a merge step or per-table versioning. SQLite doesn't natively give
   us per-table CRDTs.
2. **Lock R2 push separately** — handlers run in parallel under per-resource
   locks, but the R2 push step takes a per-user mutex. Then either: (a)
   one push includes both writers' changes (we wait for both writers
   before pushing — defeats the parallelism), or (b) writes are pushed
   separately and we accept that two pushes happen back-to-back (but
   they're full-DB pushes, so the second contains the first — wasteful but
   correct).

Option 2(b) is the most surgical: handlers run in parallel; R2 push gates
on a per-user mutex; the second push is redundant but correct (full DB
state is captured each time). The waste is bandwidth, not correctness.

## Pre-requisite: evidence

Do not start this task until `[WRITE_LOCK_WAIT]` logs from T1531 show that
write contention is a real bottleneck (e.g. many requests waiting >100ms).
Likely candidates if it does become real:

- Achievement writes during heavy editing sessions
- Auto-save state PATCHes interleaved with project metadata updates
- Background quest progress updates colliding with foreground writes

## Proposed Approach

1. **Schema-tag each handler** with the table set it writes. A decorator:
   ```python
   @writes_tables("achievements")
   async def record_achievement(...): ...

   @writes_tables("projects", "working_clips")
   async def update_project_state(...): ...
   ```
2. **Per-resource lock dict**: `(user, frozenset(tables)) -> asyncio.Lock`.
   Acquire the union of all locks the request writes to. (Order locks by
   table name to avoid deadlock.)
3. **R2 push lock**: a separate per-user `asyncio.Lock` taken only during
   the post-handler R2 sync phase. Two parallel writers will queue here,
   but only for the push duration — handlers ran in parallel.
4. **Telemetry**: extend `[WRITE_LOCK_WAIT]` with a `tables=...` field so
   we can tell if contention is concentrated on a hot table set.

## Acceptance Criteria

- [ ] `[WRITE_LOCK_WAIT]` evidence collected showing per-user contention is
      a real bottleneck (>1% of writes wait >100ms).
- [ ] Decorator `@writes_tables(*names)` applied to all write handlers.
- [ ] Two writers touching disjoint tables run in parallel (regression test).
- [ ] Two writers touching the same table still serialize (regression test).
- [ ] R2 version monotonicity preserved under parallel writers (regression
      test: assert no version goes backward, no writes lost).
- [ ] Update T1531 task to mark the broader serialization story complete.

## Out of Scope

- Per-row locks. Way too fine-grained for SQLite full-DB sync.
- Cross-user locks. Each user has a separate `profile.sqlite`.
- Replacing R2 full-DB sync with per-table sync (would require a different
  storage shape — track separately if ever needed).

## Notes for AI handoff

- Built on top of T1531's `_USER_WRITE_LOCKS` infra in
  [src/backend/app/middleware/db_sync.py](../../../src/backend/app/middleware/db_sync.py).
- The decorator approach lets us declare write scope close to the handler;
  alternative (sniffing TrackedConnection writes) is more magical but loses
  the upfront declaration.
- The hard part is making sure the R2 push lock doesn't reintroduce the
  T1531 serialization. Measure before and after with `[REQ_TIMING]`.
