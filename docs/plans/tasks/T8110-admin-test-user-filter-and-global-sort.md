# T8110: Admin panel — hide test accounts + sort across the whole DB

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-08-31
**Updated:** 2026-08-31

## Problem

Two defects in the admin user panel, both making the panel lie about the real user base.

**1. Test accounts pollute every number.** Seven accounts on prod are ours, not customers:

| Email | Note |
|-------|------|
| spampoopers@gmail.com | |
| imankh@gmail.com | admin |
| sarkarati@gmail.com | |
| hello@reelballers.com | |
| drewsoccerati@gmail.com | |
| themaryam14@gmail.com | |
| iman@launchitlabs.io | |

They are among the heaviest accounts in the system (most games, clips, exports, sessions and usage
seconds of anyone), so they distort the funnel bar, the cohort/retention/revenue aggregates, and any
read of "how are real users doing". There is currently no way to exclude them, and no field anywhere
that even records that an account is internal.

**2. Column sort is page-local, not global.** Clicking a column header sorts only the ~10 rows the
current page already holds — `UserTable.jsx` sorts the `users` array in a `useMemo`
([UserTable.jsx:155-163](../../../src/frontend/src/components/admin/UserTable.jsx#L155-L163)), while
the server always returns `ORDER BY s.last_active_at DESC NULLS LAST`
([admin.py:142](../../../src/backend/app/routers/admin.py#L142)). So "sort by Clips descending"
shows the most-clipped user *on this page*, never the most-clipped user in the database. The header
UI gives no hint that the sort is local, which makes it actively misleading — it looks like a
ranking and isn't one.

## Solution

### Part 1 — `is_test_account` flag + UI toggle (user decision 2026-08-31)

- New Postgres column `users.is_test_account BOOLEAN NOT NULL DEFAULT false`, added to `_SCHEMA_DDL`
  in [pg.py](../../../src/backend/app/services/pg.py) (fresh deploys) **and** a `postgres`-track
  migration that adds the column and seeds `true` for the 7 emails above. Marking is data, not
  config: a new test account gets flagged from the UI, never by a deploy.
- `GET /api/admin/users` takes `exclude_test: bool = True` (default ON — the admin panel should show
  real users unless you ask otherwise) and adds `AND NOT u.is_test_account` to the WHERE clause.
- Admin UI (user direction 2026-08-31): a **"Real" pill in the existing FILTER row** in
  [AdminScreen.jsx:37-41](../../../src/frontend/src/screens/AdminScreen.jsx#L37-L41), alongside
  Paying / Active (7d) / Has Exports / Invited Others / Was Invited. Active = test accounts hidden;
  default ON, so the panel opens on real users with the pill lit.
  - The existing pills are **mutually exclusive** — `userFilter` is a single-value param mapped in
    `_build_segment_filter`. "Real" must NOT join that exclusive set, or you could never ask for
    "real paying users". It renders as a pill in the same row but toggles independently, sending
    `exclude_test` alongside whatever segment pill is active. (If strict exclusivity is preferred
    instead, that is a one-line change — but it costs every combined view.)
  - Store state only, **never persisted** (no-persisted-view-state rule). Toggling refetches page 1
    and the pulse, the same way `setUserFilter` already does.
- Per-row control to mark/unmark an account as a test account (`POST
  /api/admin/users/{user_id}/test-account` with `{is_test: bool}`), so the list stays maintainable
  without a migration. Gesture-based write, admin-only, audited in the log line like the other admin
  mutations.
- Rows that ARE test accounts (visible only when the toggle is off) get a small badge so they read
  as internal at a glance.

### Part 2 — server-side sort over the entire user set (user decision 2026-08-31: exclusion applies to table + funnel + analytics)

- `GET /api/admin/users` takes `sort: str` and `sort_dir: 'asc'|'desc'`, validated against an
  explicit whitelist keyed by the 16 columns in `COLUMNS`. **Never** interpolate a raw client string
  into SQL — map whitelist key -> a fixed ORDER BY fragment, reject anything else with a 422.
- Rewrite the list query as one CTE-based statement that computes every sortable metric in Postgres,
  then `ORDER BY <mapped fragment> LIMIT %s OFFSET %s`, so the LIMIT applies AFTER the global sort.
  Every column is already Postgres-derivable:

  | Column | Source |
  |--------|--------|
  | email, origin, acquired_at, total_spent_cents, last_active_at | `users` / `user_segments` |
  | games / clips / exports / shares / action_count / session_count | `user_actions` aggregate (`SUM(count)` per action, `idx_actions_action_user` already exists) |
  | last_7d_seconds | `user_usage_daily` sum over `day >= CURRENT_DATE - 6` |
  | credits | `credits` table (PG since T5840) |
  | total_usage_seconds | `user_segments.total_usage_seconds` + open-session tail |
  | avg_weekly_seconds | derived: effective usage / weeks since `acquired_at` |
  | last_step | `CASE` ranking over the aggregated action set, mirroring `_compute_last_step` |

- Two derived columns need an explicit decision at implementation time, documented in the code:
  - **total_usage_seconds / avg_weekly_seconds** currently add a live open-session tail computed in
    Python (`session_engaged_seconds`, [admin.py:212-234](../../../src/backend/app/routers/admin.py#L212-L234)).
    Either express the same accounting in SQL, or sort on banked usage and keep the Python tail for
    display only — do NOT silently let sort order and displayed value disagree.
  - **last_step** ordering must match the funnel order in `analytics.FUNNEL_STEPS`, not alphabetical.
- Frontend: `UserTable` stops sorting locally. Header clicks set sort state in `adminStore` and
  refetch page 1 from the server; the local `useMemo` sort is deleted (single source of truth for
  ordering = the server). The email search box stays local to the page for now — call that out in
  the UI copy ("filters this page") or move it server-side too if it is cheap in the same query.

### Part 3 — exclusion applies to the aggregates too

The same `exclude_test` predicate must be threaded through the funnel totals computed inside
`list_users` and the analytics endpoints that report population-level numbers: `/analytics/funnel`,
`/analytics/channels`, `/analytics/share-funnel`, `/analytics/cohorts`, `/analytics/pulse`,
`/analytics/platforms`, `/revenue-reconciliation`, and `/dashboard` (which calls several of them).
Per-user endpoints (`/analytics/journey/{user_id}`, `/analytics/user/{user_id}/*`) are unaffected —
they are scoped to one explicitly named user.

Thread it as ONE shared helper (extend `_build_segment_filter`, or a sibling that returns the
`NOT u.is_test_account` predicate) — not seven copies of the same string.

## Context

### Relevant Files (REQUIRED)

Backend
- `src/backend/app/routers/admin.py` — `list_users` (query + sort + filter), funnel totals,
  `_build_segment_filter` (line ~1570), the analytics endpoints listed in Part 3, new
  mark-as-test endpoint
- `src/backend/app/services/pg.py` — `_SCHEMA_DDL` `users` table (line ~54); consider an index if
  the sort plans badly
- `src/backend/app/migrations/postgres/vNNN_test_account_flag.py` — NEW. **Pick the version number
  at implementation time after checking unmerged sibling branches for a colliding number** (highest
  on master today is v025); migration runner passes TUPLE rows to `up(conn)`.
- `src/backend/app/analytics.py` — `FUNNEL_STEPS` / `FLOW_EVENTS` (last_step ordering source)
- `src/backend/app/services/credit_ledger.py` — `stats_for_admin`; folding the credits balance into
  the main query may make this call redundant for the list path

Frontend
- `src/frontend/src/components/admin/UserTable.jsx` — remove local sort, add hide-test toggle,
  test badge, per-row mark control
- `src/frontend/src/stores/adminStore.js` — `fetchUsers` params (sort, sort_dir, exclude_test),
  sort/filter state, refetch-on-change
- `src/frontend/src/components/admin/AnalyticsDashboard.jsx` — pass the exclusion through
- `src/frontend/src/screens/AdminScreen.jsx` — wiring if the toggle lives above the table

Tests
- `src/backend/tests/` — new test file for list_users sort + exclusion (global ordering across
  pages, whitelist rejection, seeded flags)
- `src/frontend/src/screens/AdminScreen.test.jsx`, `src/frontend/src/stores/adminStore.dashboard.test.js`

### Related Tasks
- T8000 (admin analytics event-loop blocking at scale) and T8020 (dashboard fetch consolidation) are
  the adjacent admin-perf work — the new sort query must not regress what T8020 consolidated, and
  `list_users` is already a sync def on the threadpool (T8020).
- T4970 (LEFT JOIN so segment-less users stay enumerated) — the new query must preserve that: a user
  with no `user_segments` row still appears, and still sorts sanely (NULLS LAST).

### Technical Notes

- **Correctness over convenience:** the sort whitelist is a hard mapping. No dynamic column names,
  no `f"ORDER BY {key}"` with a client string, ever.
- **Efficiency at scale:** the whole point is one query that ranks the entire table, so verify the
  plan on a realistic row count (T8000 flagged scaling to thousands of users). If the aggregate CTE
  seq-scans `user_actions` per request, add the covering index in the same migration rather than
  shipping a slow endpoint.
- **NULL ordering** must be stable and explicit for every column (`NULLS LAST` on descending
  metrics), otherwise page 2 can repeat rows from page 1.
- **Prod data:** the migration seeds by email; if one of the 7 emails does not exist on an
  environment the seed is a no-op there, not an error. Staging and dev have their own test accounts;
  the flag being per-row makes that fine.
- No new persisted view state: toggle + sort are ephemeral UI state, not saved to any DB.

## Implementation

### Steps
1. [ ] Migration + `_SCHEMA_DDL`: `users.is_test_account`, seeded true for the 7 emails
2. [ ] `list_users`: `exclude_test` param + shared predicate helper; funnel totals honor it
3. [ ] `list_users`: CTE query computing all sortable metrics + whitelisted `sort`/`sort_dir`,
       LIMIT/OFFSET after the global ORDER BY
4. [ ] Thread the exclusion through the Part 3 analytics endpoints via the shared helper
5. [ ] `POST /api/admin/users/{user_id}/test-account` mark/unmark endpoint
6. [ ] `adminStore`: sort + exclude_test state, params, refetch on change
7. [ ] `AdminScreen`: "Real" pill in the FILTER row (default on, composes with the exclusive pills)
8. [ ] `UserTable`: delete local sort useMemo, header click -> server sort, test badge, per-row mark
       control
9. [ ] Backend tests (global ordering across page boundaries, whitelist rejection, exclusion in
       list + funnel + one analytics endpoint, segment-less user still listed)
10. [ ] Frontend tests (Real pill refetches and composes, header click sends sort params, no local
       re-sort)
11. [ ] Verify the query plan at realistic scale; add indexes if needed
12. [ ] Run the migration on staging via `POST /api/admin/migrate` after deploy, verify the 7 rows

### Progress Log

**2026-08-31**: Filed at the user's request as top priority. Three design decisions taken by the
user at filing: (a) DB flag `users.is_test_account` + per-row toggle over a hardcoded email list, so
new test accounts can be flagged without a deploy; (b) the exclusion applies to the user table, the
funnel bar AND the analytics dashboard aggregates, not the table alone; (c) the control is a "Real"
pill in the existing FILTER row, not a separate checkbox.

## Acceptance Criteria

- [ ] With the "Real" filter pill active (the default), none of the 7 listed accounts appear in the
      user table, and they are excluded from the funnel bar and the analytics dashboard aggregates
- [ ] "Real" combines with the other filter pills (e.g. Real + Paying = real paying users only)
- [ ] Turning "Real" off shows the test accounts again, badged as test accounts
- [ ] An account can be marked/unmarked as a test account from the admin UI, and the change survives
      a reload (it is a DB flag, not view state)
- [ ] Clicking any column header sorts across the ENTIRE user set: the first row of page 1 is the
      true max/min for that column in the database, and paging forward continues the same ordering
      with no repeats or gaps
- [ ] Sort direction toggles on repeat click; the active column shows its direction indicator
- [ ] An unknown `sort` value is rejected by the API (422), never interpolated into SQL
- [ ] A user with no `user_segments` row is still listed and sorted (T4970 regression guard)
- [ ] The list endpoint's latency is unchanged or better at realistic row counts; query plan checked
- [ ] Backend + frontend tests pass; migration verified on staging
