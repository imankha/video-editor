# T15280: analytics.sqlite store module (carved out of T7400 so the visit beacon can start)

**Status:** WIP
**Impact:** 7
**Complexity:** 3
**Tier:** M (backend only, new flat SQLite store; no Postgres change)
**Created:** 2026-11-07
**Updated:** 2026-11-07

## Ruling

Owner approved 2026-11-07 (spend-readiness decision page, decision 2, option B): split T7400. The
store module ships now so T7410 (visit beacon) and T14960 (Visited node, spend gate 1) can start;
the rollup sweep stays in T7400 and comes later. Reason: visits cannot be backfilled, so every week
without the beacon is lost for good, while the sweep is a full rebuild from each user's
`user_action_log` and loses nothing by starting later.

## Problem

T7410 depends only on T7400's `analytics_store.py` (schema, open/create, R2 persistence), but T7400
also carries the cohort rollup sweep (complexity 5). Bundled, the beacon waits on the sweep.

## Solution

Build exactly the store half of T7400, as specified in
[investor-analytics/T7400-analytics-sqlite-rollup.md](investor-analytics/T7400-analytics-sqlite-rollup.md)
("Schema" and the store rules): flat `analytics.sqlite`, env-prefixed R2 key, single writer,
etag-asserted upload (drip.sqlite precedent), created lazily, `PRAGMA user_version` with a
migration ladder inside the module, `rollup_meta` table. NOT one of the three migration tracks,
no `_SCHEMA_DDL` change. The rollup tables and the sweep stay in T7400.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_store.py` (NEW) - schema, open/create, R2 persistence, user_version ladder
- `src/backend/tests/test_analytics_store.py` (NEW)
- `docs/plans/tasks/investor-analytics/T7400-analytics-sqlite-rollup.md` - the spec this carves from (read only)

### Related Tasks
- Carved from: T7400 (keeps the sweep and the rollup tables, now depends on this).
- Unblocks: T7410 (adds `visit_daily`, user_version 2), then T14960.

## Acceptance Criteria

- [ ] `analytics_store` opens or creates `analytics.sqlite`, persists to the env-prefixed R2 key, and refuses an upload whose etag changed underneath it (test).
- [ ] `user_version` ladder: a fresh file and a version-1 file both reach the current version (test).
- [ ] No Postgres DDL diff; no per-user or per-event rows in the store.
