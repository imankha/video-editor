# T15390: By-sport and action-rollup reads download every analytics shard from R2 on every request (~9.5s)

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Tier:** M (backend read path only; no schema change, no new endpoint)
**Created:** 2026-11-09
**Updated:** 2026-11-09

Auto-filed by the /dotask verifier on g-t7400-3 (3f1d39471); scoped by the owner's request
2026-11-09 ("file and work on the slow by-sport endpoint").

## Problem

`GET /api/admin/analytics/by-sport` took ~9.5s on the g-t7400-3 dev stack (`[SLOW REQUEST]`), with
~25 sequential R2 `GetObject` calls, one per `analytics.sqlite` shard under `{env}/analytics/shards/`.
The first Playwright run of the verify spec timed out at 60s because of it.

Cause (code, not just the sandbox): `analytics_rollup.load_newest_action_rollup` (T7400) LISTs the
prefix and then GETs **every** shard blob, serially, on **every** request, with no cache. Both
`GET /api/admin/analytics/by-sport` and the action-rollup endpoint call it. Its sibling
`analytics_journey_rollup.load_newest_rollup` already keeps an ETag-keyed blob cache
(`_shard_blobs`) so unchanged shards are not re-downloaded. `load_visit_totals` has a third copy of
the LIST+GET loop, behind a 300s TTL cache.

It is not sandbox-only. Production shards are keyed by Fly machine id; machines that are replaced
leave their shard behind, so the shard count only grows, and so does the cost of every admin read.

## Solution

- One shared shard fetcher in `analytics_store.py` (e.g. `fetch_other_shard_blobs()` returning
  `(blobs, partial)`): LIST the env prefix, skip this process's own key, reuse a blob whose ETag
  matches the cache, GET only new/changed shards, drop cache entries for shards no longer listed
  (only after a full, non-partial LIST). Move the Journey reader's `_shard_blobs` cache here.
- Cache misses are fetched concurrently with a small bounded pool (e.g. 8), not serially.
- `load_newest_action_rollup` and `load_newest_rollup` both use it. `load_visit_totals` uses it too
  if that keeps its TTL behaviour; otherwise leave it.
- Unchanged: a LIST or GET failure still marks the result `partial` (never a silent skip); this
  process's own shard is still read from the live store snapshot; the newest-run selection rule.
- Out of scope: deleting stale shards of retired writers (note it in the Progress Log if worth a task).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_store.py` - the shared fetcher + cache
- `src/backend/app/services/analytics_rollup.py` - `load_newest_action_rollup` uses it
- `src/backend/app/services/analytics_journey_rollup.py` - `load_newest_rollup` uses it (cache moves out)
- `src/backend/tests/test_analytics_rollup.py`, `src/backend/tests/test_analytics_store.py` - tests with a call-counting fake R2

### Related Tasks
- Follows T7400 / T14950 (PR #731), T14030 (Journey rollup, the cache precedent), T7410 (visit totals).

## Implementation

### Steps
1. [ ] Failing tests with a fake R2 client that counts LIST/GET calls and can add latency.
2. [ ] Shared fetcher; switch the readers over.
3. [ ] Time `GET /api/admin/analytics/by-sport` cold and warm on the dev stack; record in Progress Log.

### Progress Log

**2026-11-09**: Auto-filed by verifier; scoped with root cause.

## Acceptance Criteria

- [ ] C1: With shards unchanged, a second `GET /api/admin/analytics/by-sport` makes one R2 LIST and zero `GetObject` calls.
- [ ] C2: A shard whose ETag changed is re-fetched; a shard no longer listed leaves the cache; a failed LIST or GET still returns `partial: true`.
- [ ] C3: Cold read of 25 shards with a 300ms fake GET latency completes in under 2s (concurrent fetch).
- [ ] C4: By-sport, action-rollup and Journey responses are unchanged for the same shard contents (existing tests pass).
