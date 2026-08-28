# T7980: Admin campaign/channels table cartesian-joins exports x purchases — inflates avg_exports, revenue, and sort order

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-28
**Updated:** 2026-08-28

## Problem

Found during a user-requested audit of the admin dashboard (2026-08-28) — the "organic" campaign
row showed `avg exports 3.6` with only 4 users having exported, which is mathematically impossible
unless something is fanning out.

Root cause: `admin.py:1059-1075` (the `/analytics/channels` query) does two independent `LEFT
JOIN`s against `user_actions` — one for exports (`a_exp`), one for purchases (`a_pur`).
`user_actions`'s primary key includes `platform`, and export events get logged under multiple
platform values (worker-completed exports log `platform='unknown'` in `export_worker.py:185`,
request-path exports log the real platform in `export/overlay.py:279`), so a single user routinely
has multiple `a_exp` rows. Joining that against the purchases table too produces a **cartesian
fan-out**: each user's row count in the result is `(export rows) x (purchase rows)`. Consequences:
- `SUM(a_exp.count)` (line 1067) gets multiplied by that user's purchase-row count, inflating
  `avg_exports` (line 1091)
- `SUM(s.total_spent_cents)` (line 1068) gets multiplied by both — **`revenue_cents` is inflated
  too, and it's also the `ORDER BY` column (line 1074)**, so campaign ranking itself is wrong
- Separately, `avg_exports` divides by ALL users in the segment (line 1091, `/ users`) rather than
  by the users who actually exported — a second, independent skew on top of the fan-out

This is the most consequential-to-business-decisions bug of the four: revenue-by-channel is what
would drive any future spend/channel decisions, and it's currently wrong in the inflating
direction.

## Solution

Rewrite the query to pre-aggregate each action (exports, purchases) into a per-user subquery
BEFORE joining to `user_segments`, so each user contributes exactly one row per join, eliminating
the fan-out. Decide `avg_exports`' denominator explicitly (per-user average across all segment
users vs. only exporters) and pick the one that matches what the label already promises — "avg
exports" most naturally reads as "per exporting user," which is not what the current `/ users`
computes.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — the `/analytics/channels` endpoint, query at lines
  1059-1075, Python-side percentage/average computation at lines 1078-1093
- `src/backend/app/services/export_worker.py:185` — worker-completed exports log
  `platform='unknown'`
- `src/backend/app/routers/export/overlay.py:279` — request-path exports log the real platform
  (source of the platform-value divergence causing multiple `user_actions` rows per user)

### Related Tasks
- Sibling bugs from the same audit: T7960 (viral %), T7970 (upload success), T7990 (stat-tile
  day-boundary mislabel)

### Technical Notes
- The same PK-includes-platform shape likely affects any other query in admin.py that joins
  `user_actions` for more than one action per user in the same query — worth a quick grep for
  other multi-join queries against `user_actions` while in this file, but scope this task to the
  channels endpoint; file anything else found as a separate task rather than scope-creeping this one.

## Implementation

### Steps
1. [ ] Rewrite the channels query with pre-aggregated per-user subqueries for exports and
       purchases (e.g. `GROUP BY user_id` inside each joined subquery) before joining to
       `user_segments`
2. [ ] Decide and document `avg_exports`' denominator (all segment users vs. exporters only)
3. [ ] Add a backend test with a synthetic user having multiple `user_actions` rows (different
       platforms) for both exports and purchases, asserting revenue/avg_exports are NOT inflated
4. [ ] Spot-check the live "organic" campaign row against raw counts after the fix

### Progress Log

**2026-08-28**: Filed from admin dashboard audit (code-expert agent finding).

## Acceptance Criteria

- [ ] A user with N export rows across multiple platforms and M purchase rows contributes exactly
      their true export count and true spend to the aggregate, not N*M
- [ ] `avg_exports` and `revenue_cents` match a manual sum computed against `user_actions`/
      `user_segments` directly for a test dataset
- [ ] Campaign sort order (`ORDER BY revenue_cents`) is verified stable/correct post-fix
