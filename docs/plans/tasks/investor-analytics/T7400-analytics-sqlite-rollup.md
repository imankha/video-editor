# T7400: analytics.sqlite store + on-demand cohort rollup sweep

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-08-20

## Problem

Cohort × action × time questions ("% of the Fall cohort still exporting in week 6", "clip-library usage over the season") cannot be answered today: per-event history exists only inside each user's SQLite `user_action_log`, and the shared stores hold lifetime counts (`user_actions`) or global-not-per-user daily aggregates (`daily_counters`). Per the epic's binding directives we may NOT solve this with a Postgres event table or any per-event shared store.

## Solution

A flat **`analytics.sqlite`** (drip.sqlite precedent) holding ONLY aggregates, populated by an **admin-triggered rollup sweep** that opens each user's `user_action_log` and reduces it to `(cohort_week, action, week_index) -> distinct_users` rows. Raw events never leave the per-user DBs; the rollup output is tiny and bounded (cohorts × actions × weeks).

See [EPIC.md](EPIC.md) for design principles (in-house, aggregates-only, no new PG) and locked metric definitions.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_store.py` (NEW) — analytics.sqlite schema, open/create, R2 persistence
- `src/backend/app/services/analytics_rollup.py` (NEW) — the sweep
- `src/backend/app/routers/admin.py` — `POST /api/admin/analytics/rollup` (trigger + status), `GET` freshness
- `src/backend/app/services/drip_store.py` — does NOT exist yet (T7230 not started); if it lands first, mirror its R2-etag patterns, else establish them here
- `src/backend/app/analytics.py` — reference only (`FLOW_EVENTS` is the action universe)

### Related Tasks
- Blocks: T7430 (action-level cohort views), T7450's signals become visible through this rollup
- Sibling pattern: T7230 (drip.sqlite — env-prefixed R2 key, single-writer, etag-asserted upload)

### Schema (full mapping, per epic-rules)

`analytics.sqlite`, `PRAGMA user_version = 1`, created lazily:

| Table | Columns | Source |
|---|---|---|
| `rollup_action_weekly` | `cohort_week TEXT` (ISO Monday of the user's `user_segments.acquired_at` week), `action TEXT` (FLOW_EVENTS key), `week_index INTEGER` (weeks since cohort_week, 0-based), `distinct_users INTEGER`, PK(cohort_week, action, week_index) | computed: for each user, for each week they have >=1 `user_action_log` row of that action |
| `rollup_meta` | `key TEXT PK`, `value TEXT` | `computed_at` (UTC ISO), `users_swept`, `users_failed`, `log_rows_reduced` |
| `visit_daily` | reserved for T7410 (created there; version bump) | — |

### Technical Notes
- **Sweep mechanics:** iterate users from PG `users`/`user_segments` (READ-only), open each per-user DB via the existing set-context pattern (poster-backfill / expiry-sweep precedent). Users whose DB can't open are COUNTED in `users_failed` and logged — never silently skipped (honest-unknown rule, same as `share_view_counts`).
- **Admin-triggered, not scheduled.** A "Refresh analytics" button/endpoint (T4840 rule: admin reads of user DBs never sit on a user-facing path). Reruns are full rebuilds (DELETE + reinsert) — idempotent, no incremental bookkeeping.
- **Persistence:** local file at a stable path + upload to env-prefixed R2 key after each rollup with etag assert (refuse loudly on mismatch — a second writer means two machines ran rollups; single app server today). On startup/first open, download-if-newer from R2. NEVER enters the per-user CAS/sync machinery.
- **Data volume:** with A actions (~30) and W weeks tracked, worst case cohorts×A×W rows of 4 small columns — thousands of rows, not millions. No per-event rows. This is the entire point.
- **Scaling caveat (document in code):** sweep is O(users); fine for current scale, revisit batching when users > ~1k.
- Timezone: `user_action_log.created_at` is UTC ISO; week bucketing in UTC, ISO weeks (Monday start).

## Implementation

### Steps
1. [ ] `analytics_store.py`: schema + lazy create + R2 down/up with etag assert
2. [ ] `analytics_rollup.py`: sweep + reduce + full-rebuild write
3. [ ] Admin endpoints (trigger, status/freshness) + minimal admin-panel button with `computed_at` display
4. [ ] Tests: reduction correctness from fixture `user_action_log` rows; failed-DB counting; idempotent rerun; etag-refusal path

## Acceptance Criteria

- [ ] Rollup runs from the admin panel and reports users_swept/users_failed/computed_at
- [ ] `rollup_action_weekly` matches hand-computed fixtures (incl. a user active in weeks 0 and 6 but not between)
- [ ] Zero new PG state (grep-provable: no migration file, no `_SCHEMA_DDL` diff)
- [ ] Rerun produces identical results (idempotent); etag mismatch refuses loudly
