# T14030: Exit-screen, dwell, retry-burst and transition rollup for the Journey tab

**Status:** TODO
**Impact:** 6
**Complexity:** 6
**Created:** 2026-10-30
**Updated:** 2026-10-30

Design (approved 2026-10-30): [admin-journey-dropoff-design-2026-10-30.md](../admin-journey-dropoff-design-2026-10-30.md), Section 6.2 (phase 2). L-tier: new persisted aggregate state in analytics.sqlite and an admin-triggered sweep. The design doc is the design; the Architect confirms schema step numbering against T7400 at task start.

## Problem

The only "why" signals Postgres holds are failure reasons and impressions. The per-user logs hold more: `session_exit` rows (last screen, dwell per screen, screen trail) and the full `user_action_log`, from which retry bursts and repeat transitions can be computed. None of it is readable in aggregate because per-event rows never enter shared stores (epic rule: aggregates only, no new Postgres state).

## Solution

An admin-triggered, in-process sweep that walks every profile through the JIT seam primitive (never an out-of-process sweep; see CLAUDE.md Migration System), reads each user's `session_exit` and `user_action_log`, and writes aggregate rows into analytics.sqlite (schema step 2, the slot `analytics_store.py` reserved for T7400): `rollup_exit_screen` (stage x last_screen x count), `rollup_stage_dwell` (stage x screen x dwell buckets), `rollup_retry_burst` (stage x action x burst count), `rollup_transition` (from_stage x to_stage x count, repeat transitions included), `rollup_meta` (run_id, computed_at, users_walked, below_head_skipped). Every row is keyed by `run_id`; the reader takes the newest `computed_at` across writer shards (summing shards would double count a rebuilt rollup). The inspector's "Where they left" slot (ghosted since T14020) renders from these tables with a "computed at" stamp.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_store.py` - schema step 2 tables (additive `PRAGMA user_version` step), newest-run reader
- `src/backend/app/services/analytics_journey_rollup.py` (NEW) - per-user aggregation (pure), sweep driver using the JIT seam primitive, run_id semantics
- `src/backend/app/routers/admin.py` - `POST /api/admin/analytics/journey/rollup` (admin session, in-process, returns run summary); `GET /analytics/journey/step/{stage}` gains the `left` section
- `src/backend/tests/test_analytics_journey_rollup.py` - per-user aggregation, two-shard newest-run reader (no double count), run_id isolation, below-head profiles skipped and counted
- `src/frontend/src/components/admin/StepInspector.jsx` - "Where they left" panel; `adminStore.js` rollup trigger + status
- `src/backend/app/analytics.py` - `BREADCRUMB_SCREENS` is the screen vocabulary; no new events

### Related Tasks
- Depends on: T14010, T14020
- Coordinates with: T7400 (analytics.sqlite rollup sweep; `rollup_action_weekly` becomes step 3 or ships in the same step; decide at whichever starts first), T13930 (analytics.sqlite shards, writer ids)
- Related: T7515 (session_exit writer), T7455 (editor-open events would sharpen stage attribution)

### Technical Notes
- Stage attribution for an exit: the user's furthest ladder stage at the time of the exit row (from the same per-user log), so "where they left" is per stage, matching the inspector's selection.
- Aggregates only: no per-user or per-event row leaves the per-user SQLite. Dwell is bucketed, not stored raw.
- Sweep walks profiles in-process via the JIT primitive (same shape as `backfill_posters`); never reintroduce an out-of-process sweep.
- Below-head profiles that cannot be migrated during the walk are skipped and counted in `rollup_meta`, never read raw.
- Reader rule: newest `computed_at` per shard set wins; tested with two shards holding different run_ids.
- Admin-triggered only; no scheduler in this task.

## Implementation

### Steps
1. [ ] Architect confirms step numbering and table shapes against T7400 (short design note appended to the design doc, not a new design file)
2. [ ] Failing tests: per-user aggregation, two-shard reader, run_id isolation, skipped below-head count
3. [ ] Schema step 2 + newest-run reader in `analytics_store.py`
4. [ ] Rollup service + admin trigger endpoint
5. [ ] `left` section on the step endpoint; "Where they left" panel with computed-at stamp and a "run rollup" button for admins
6. [ ] Update `backend-services.md` and `persistence-sync.md` (sweep shape)

### Progress Log

**2026-10-30**: Filed from the approved design.

## Acceptance Criteria

- [ ] Admin trigger runs the sweep in-process and returns users walked, skipped, and the run_id
- [ ] Inspector "Where they left" shows last-screen shares and dwell buckets for the selected stage with the computed-at stamp
- [ ] Two writer shards with different run_ids never double count: the reader returns only the newest run
- [ ] No per-user or per-event rows in analytics.sqlite; all tables are counts or buckets keyed by stage
- [ ] No new Postgres table or column
- [ ] Relevant backend and frontend tests pass; Branch CI green
