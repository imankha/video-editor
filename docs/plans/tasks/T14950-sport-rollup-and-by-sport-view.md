# T14950: Sport key in the analytics.sqlite rollup + "By sport" admin table (Total exports by sport)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Tier:** M (extends T7400's rollup and adds one read-only admin table)
**Created:** 2026-11-03
**Updated:** 2026-11-09

**Unblocked 2026-11-09 (owner):** T14940 is in STAGING; this task runs in the same group as T7400,
so the sport key goes into T7400's schema step 3 tables from the start (no separate step 4).

Piece 3 of 3 of the sport dimension. Owner 2026-11-03: "it should be possible to link things like
Total Exports to sports"; no DB change; no read-time cost.

## Problem

Once T14940 tags each event with the profile's sport, the data sits in per-user SQLite logs. Reading
it at request time would open every user DB per admin page. The planned analytics.sqlite rollup
(T7400) already sweeps those logs in-process into small aggregate rows; it has no sport key.

## Solution

- Extend T7400's rollup with a `sport` key: `rollup_action_weekly(cohort_week, sport, action,
  week_index, distinct_users)` and a totals table `rollup_action_by_sport(month, sport, action,
  events, distinct_users)`. Events without a sport tag (pre-T14940 history) roll up under
  `unrecorded`, never under `no_sport`.
- A two-sport user counts under each sport they acted in; distinct users across sports overlap and
  the UI says so.
- Admin "By sport" table (new `BySportTable.jsx` in the admin analytics area, or a row set in
  `DimensionTable.jsx` if it fits): per sport, per month: uploads landed, plays marked, exports
  (true, from `credits_consumed` and the T14710 export events), highlights finished, shares,
  purchases and credits bought, distinct users; sorted by exports; `no_sport` and `unrecorded` as
  visible rows; small-N cells as raw fractions. Reads only the rollup tables: one query, no per-user
  access.
- The sweep is the existing admin-triggered in-process sweep from T7400; this task adds no new
  trigger.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_store.py` - rollup tables gain the sport key (T7400's module)
- `src/backend/app/services/analytics_journey_rollup.py` or T7400's sweep module - read `context.sport`
- `src/backend/app/routers/admin.py` - `GET /api/admin/analytics/by-sport` (read only)
- `src/frontend/src/components/admin/BySportTable.jsx` (new) + test; `stores/adminStore.js`
- Tests: rollup with tagged and untagged rows; overlap; endpoint shape

### Related Tasks
- Grouped with T7400 (the sweep; same group, runs after it). T14940 (the tag) is in STAGING.
- Siblings: T14930 (arrival sport, the Journey-side cut).
- Feeds: T14910 (per-sport export and payer gates can read the rollup instead of Postgres), T7440.

### Technical Notes
- analytics.sqlite is a per-writer-shard flat file store (see T7400's 2026-11-08 note), not the
  Postgres DB; rollup reads sum across shards; this honours the "no DB change" ruling
  and the Investor-Grade Analytics directives (aggregates only, no per-event rows in shared stores).
- Read cost is one indexed query of a small table; write cost is paid once per sweep.

## Implementation

### Steps
1. [ ] Failing tests: rollup rows per sport from a fixture user log with two sports; `unrecorded`
       bucket; overlap in distinct users.
2. [ ] Rollup extension; endpoint; table.
3. [ ] Screenshot desktop and phone.

### Progress Log

**2026-11-03**: Filed.

## Acceptance Criteria

- [ ] "Total exports by sport" per month is one query on the rollup; no per-user DB access at read.
- [ ] `unrecorded` and `no_sport` are separate visible rows; overlap note shown.
- [ ] No Postgres DDL diff.
