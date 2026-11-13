# T16070: Day 1 to day 28 retention

## In plain words

Today the admin panel shows how many people signed up, uploaded, made a highlight and paid, but it never says how many of them came back. The only return number we have, 17 of 402 users still active after a week, was pulled by hand from the production database on 2026-11-09. We will add a retention table to the admin panel: of the people who signed up in each week, what share used the app again 1, 3, 7, 14 and 28 days after signing up, with one total row across all weeks. These five checkpoints are the standard ones, so our numbers can be compared with other consumer apps, and they are short enough to read within a month of a change. Done when the admin panel shows the table and its 7-day figure for users who signed up before 2026-11-02 matches a hand count from the production database.

**Status:** WIP
**Impact:** 9
**Complexity:** 3
**Created:** 2026-11-11

## How each number is counted

- A person counts as returned on day N if they used the app on the Nth calendar day after the day they signed up (UTC). Sign-up day is day 0. Using the app means any recorded activity for that day.
- Each cell shows the percentage and the raw count, for example "12% (5 of 41)", because most weekly groups are small and a percentage alone hides that.
- A weekly group only gets a number for day N once every member is at least N days past sign-up. Until then the cell is blank and labelled as not yet measurable, never shown as zero.
- Admin and test accounts are left out, the same way the existing funnel leaves them out.
- One row per sign-up week (newest first) plus an "All weeks" row that pools every person old enough for that day.

## Why exact days and not "came back at any point"

Exact-day retention is the industry convention, so the figures can be compared with published benchmarks. "Ever came back after day N" would read higher and hide the shape of the drop. If the owner prefers the other counting, it is a one-line change in the query and should be decided before this ships.

## How this relates to the Retention chart (T7430)

T7430 is the larger chart: weekly cohorts over many weeks, quiet-week shading, and toggles by action. This task is the small, fast piece that gives the five standard checkpoints now. T7430 should reuse this task's counting function rather than writing a second one.

## Implementer notes

- Activity source: the per-user per-day rows in Postgres `user_usage_daily` (migration v022, kept after account deletion by v032). Sign-up date: `user_segments.acquired_at`. Check both in `src/backend/app/analytics.py` and `routers/admin.py` before writing the query.
- Backend: `GET /api/admin/analytics/retention` next to `/analytics/cohorts` in `src/backend/app/routers/admin.py`; one SQL query, no new storage, no migration.
- Frontend: a table component in `src/frontend/src/components/admin/` following `CohortGrid.jsx` / `DimensionTable.jsx`, fetched through `src/frontend/src/stores/adminStore.js`.
- Tests: a backend test with a seeded set of users that covers day 0 not counting, the maturity blank, and the admin-exclusion; a component test for the blank and count rendering.
- Knowledge doc: `.claude/knowledge/backend-services.md`.
