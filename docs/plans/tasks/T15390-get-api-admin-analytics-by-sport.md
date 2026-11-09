# T15390: GET /api/admin/analytics/by-sport is slow in this sandbox (~9.5s, dozens of R2 GetObject calls)

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Found by the /dotask verifier on group g-t7400-3 at 3f1d39471, which judged it unrelated to that branch. Impact and complexity are unscored defaults.

**Steps:** Open /admin as admin, click By Sport tab (or GET /api/admin/analytics/by-sport directly) on this dev stack

**Expected:** Fast response (small aggregate table)

**Actual:** Backend log shows ~9.5s total with ~25 sequential R2 GetObject calls (one per accumulated analytics.sqlite shard under the env's R2 prefix) before returning 200; logged as a [SLOW REQUEST] warning. This is the pre-existing T7400 shard-listing/open-every-shard mechanism in analytics_store.newest_action_rollup, not something T14950 introduced, and likely reflects shard accumulation from repeated dev/test runs in this sandbox rather than a code defect. Does not affect the C1 criterion (still one query per shard against only the by-sport table, still no per-user DB access), but the first Playwright run of my verify spec timed out at 60s because of it.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
