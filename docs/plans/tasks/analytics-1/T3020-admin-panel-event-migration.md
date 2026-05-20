# T3020: Admin Panel Event Migration

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-05-20

## Problem

The admin panel downloads profile SQLite files from R2 on every page load to compute activity counts (games, clips, framed, completed, GPU seconds). This is:
- **Slow:** Multi-second page loads as N profile DBs are downloaded from R2
- **Snapshot-only:** No time dimension -- can't see trends, can't filter by date range
- **Fragile:** Depends on R2 availability and local disk cache for admin functionality

## Solution

Replace the R2 profile download pattern with Postgres queries against the `analytics_events` table (created in T3010). Same per-user/per-profile resolution, millisecond response times, and time-series capability for free.

Include a one-time backfill script that scans existing profile DBs and creates historical events so the admin panel doesn't show zeros for pre-migration activity.

## Context

### Relevant Files
- `src/backend/app/routers/admin.py` -- Admin stats endpoints (lines 287-544)
  - `_compute_activity_counts_single()` -- R2 download + SQLite COUNT queries (REPLACE)
  - `_compute_gpu_total_single()` -- R2 download + SQLite SUM query (REPLACE)
  - `_compute_quest_progress_single()` -- R2 download + quest step checks (KEEP)
  - `_admin_ensure_profile_db()` -- R2 download helper (KEEP for quest progress only)
  - `GET /api/admin/users` -- Main admin endpoint (MODIFY)
  - `GET /api/admin/users/{user_id}/gpu-usage` -- GPU drilldown (MODIFY)
- `src/frontend/src/components/admin/UserTable.jsx` -- Admin table (MINOR changes if response shape changes)

### Related Tasks
- Depends on: T3010 (Postgres Event Log must exist and be populated)
- See [EPIC.md](EPIC.md) for shared context and schema

### Technical Notes

**What changes in the admin endpoint:**

| Metric | Before (R2) | After (Postgres) |
|--------|-------------|------------------|
| games_annotated | `COUNT(*) FROM games` on profile.sqlite | `COUNT(*) FROM analytics_events WHERE event='game_created' AND profile_id=X` |
| clips_annotated | `COUNT(*) FROM raw_clips` on profile.sqlite | `COUNT(*) FROM analytics_events WHERE event='clip_created' AND profile_id=X` |
| projects_framed | `COUNT(DISTINCT p.id) ... WHERE type='framing'` on profile.sqlite | `COUNT(*) FROM analytics_events WHERE event='export_completed' AND profile_id=X AND metadata->>'type'='framing'` |
| projects_completed | `COUNT(DISTINCT p.id) ... WHERE type='overlay'` on profile.sqlite | `COUNT(*) FROM analytics_events WHERE event='export_completed' AND profile_id=X AND metadata->>'type'='overlay'` |
| gpu_seconds_total | `SUM(gpu_seconds) FROM export_jobs` on profile.sqlite | `SUM((metadata->>'gpu_seconds')::float) FROM analytics_events WHERE event='export_completed' AND profile_id=X` |

**What stays the same:**
- **Quest progress:** Remains computed from profile SQLite DBs. Quest step checking runs 20+ conditional SQL queries that don't map cleanly to events. Not the bottleneck (quest progress is only computed for displayed users, not all users).
- **Credit balance/spent/purchased:** Already comes from Postgres (credit_transactions in user.sqlite was moved to Postgres with T1960). No change needed.
- **Money spent calculation:** Derived from credit purchase amounts. No change.

**GPU drilldown endpoint changes:**
- `by_function` breakdown: `GROUP BY metadata->>'modal_function'` on analytics_events
- `recent_jobs`: `ORDER BY created_at DESC LIMIT 20` on analytics_events WHERE event IN ('export_completed', 'export_failed')
- Requires T3010 to log `modal_function` in export event metadata

**Backfill strategy:**
- One-time admin script/endpoint that iterates all users + profiles
- Downloads each profile.sqlite from R2 (reuses existing `_admin_download_profile_db`)
- Runs the same COUNT/SUM queries that the admin panel currently uses
- Inserts synthetic `game_created`, `clip_created`, `export_completed` events with `created_at` set to the earliest reasonable date (game/clip/export creation timestamps from the profile DB where available)
- Idempotent: checks for existing backfill events before inserting (metadata includes `{backfill: true}`)

**Pagination change:**
- Current: paginated by profile count (10 profiles/page) because R2 downloads are expensive
- After: can paginate by user count since Postgres queries are cheap. But keep existing pagination to avoid frontend changes.

## Implementation

### Steps
1. [ ] Create new admin stats helper: `_compute_activity_from_events(user_id, profile_id)` that queries analytics_events
2. [ ] Create new GPU stats helper: `_compute_gpu_from_events(user_id, profile_id)` that queries analytics_events
3. [ ] Replace `_compute_activity_counts_single()` calls in `GET /api/admin/users` with new helper
4. [ ] Replace `_compute_gpu_total_single()` calls in `GET /api/admin/users` with new helper
5. [ ] Update `GET /api/admin/users/{user_id}/gpu-usage` to query analytics_events
6. [ ] Remove R2 profile download calls that were only used for activity/GPU stats (keep for quest progress)
7. [ ] Write backfill script: `src/backend/app/migrations/postgres/v005_backfill_analytics_events.py`
8. [ ] Test backfill on staging: run script, compare admin panel counts before vs after
9. [ ] Update frontend if response shape changed (likely minimal -- same field names)
10. [ ] Backend tests: verify admin endpoint returns correct counts from event log
11. [ ] Performance test: admin page load < 500ms on staging

## Acceptance Criteria

- [ ] Admin panel activity counts (games, clips, framed, completed) come from analytics_events table
- [ ] Admin panel GPU usage (total + by_function + recent_jobs) comes from analytics_events table
- [ ] Quest progress still works (computed from profile SQLite DBs)
- [ ] Backfill script creates historical events for all existing users
- [ ] Admin page load time < 500ms (verify via backend timing logs)
- [ ] No data loss: counts match pre-migration values (verified on staging before prod deploy)
- [ ] Backfill is idempotent (safe to run twice)
