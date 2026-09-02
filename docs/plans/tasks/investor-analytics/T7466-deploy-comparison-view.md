# T7466: Deploy-comparison view (segment any metric by deploy, before vs after)

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-02

## Problem

Answering "did this deploy help or hurt metric X" today requires a fully manual, ad-hoc
process, repeated from scratch every time. Demonstrated 2026-09-02 investigating upload
success rate after a deploy: `curl /api/version` for the currently-live commit, `git show`
for its timestamp, then either eyeball a day-granularity admin endpoint window or hand-write
a read-only Postgres query bounding by that timestamp. There is no record of PAST deploys
anywhere queryable -- only the currently-live commit -- so this only ever answers "since the
MOST RECENT deploy," never "did the deploy three weeks ago move the needle." Every report
this epic builds (T7420 activation, T7430 retention, T7440 growth, the pulse card's
`upload_success_rate`) would need this same manual treatment, by hand, every time someone
asks.

## Solution

1. **Deploy log** (new, analytics.sqlite): a `deploys` table (`deployed_at` UTC ISO,
   `commit_sha`, `short_sha`, `build_number`, `env`) with one row appended per deploy.
   Populated by `scripts/deploy_production.sh` right after its existing
   `verify_url "$BACKEND_HEALTH_URL" "backend"` health check (~line 162) succeeds -- at that
   point the script already has `local_sha`, `short_sha`, `app_build` in scope. The script
   calls a new admin endpoint (`POST /api/admin/deploys`) rather than writing the sqlite file
   directly from bash, so the single-writer/etag-CAS discipline T7400 establishes for
   analytics.sqlite stays enforced in one place, not bypassed from a shell script.
2. `GET /api/admin/deploys` -- list recorded deploys (sha, timestamp, build), newest first,
   for the UI picker.
3. A `since_deploy` query param added to the EXISTING report endpoints this epic
   builds/maintains: the pulse card's `upload_success_rate` (`admin.py` `analytics_pulse`,
   ~line 1836/2031-2070) and at least one of T7420/T7430/T7440's reports. It resolves the
   param to a UTC date via the deploy log, then returns a before/after pair: N days
   immediately preceding the deploy date vs. N days from the deploy date forward (N
   configurable; default matches whatever window the underlying report already uses). Each
   half carries its own denominator so a small N is visibly small, never hidden inside a
   percentage -- same honesty convention as T7460's scorecard.
4. **Admin UI**: a "Compare across a deploy" picker (dropdown of recorded deploys, newest
   first, short_sha + date) sitting above the existing report/pulse cards. Selecting one
   re-renders each supporting card as a before -> after pair (absolute counts + delta %,
   "insufficient data" below a minimum N).

### Caveats to carry into the design doc (learned filing this task 2026-09-02)

- **Day granularity is the ceiling.** `daily_counters`/`user_actions` have no per-event
  timestamp centrally -- only day buckets (Postgres `CURRENT_DATE`, server TZ = UTC) and
  lifetime totals. A comparison anchored at a deploy's exact instant will always fold a few
  hours on either side of midnight into the "wrong" bucket. This task discloses that on the
  UI ("compared using daily buckets -- the deploy day may include a few pre-deploy hours"),
  it does not solve it. Per-event timestamps exist only inside each user's own SQLite
  `user_action_log`, not centrally aggregable without T7400's rollup sweep -- and that rolls
  up to WEEKLY buckets, coarser still.
- **No retroactive history.** Deploys before this task ships have no log entry; the picker
  only covers deploys going forward. Backfilling a handful of known historical deploys from
  `git log` timestamps is a cheap nice-to-have, not required for v1.
- **Fits the epic's binding directives unchanged.** The `deploys` table is new state, but it
  goes in analytics.sqlite (never Postgres) alongside T7400's rollup tables. It's a handful
  of rows a year, not per-event data -- aggregate-shaped by construction, not by exception.

## Context

### Relevant Files (REQUIRED)
- `scripts/deploy_production.sh` (~line 162, right after the backend health `verify_url` call)
  -- new call recording the deploy; `local_sha`/`short_sha`/`app_build` already computed above
  it (~lines 97-157)
- `src/backend/app/routers/admin.py` (`analytics_pulse` ~line 1836; `upload_success_rate` card
  ~lines 2031-2070) -- add `since_deploy` param; new `POST`/`GET /api/admin/deploys`
- Wherever T7400 lands the analytics.sqlite module (**not yet created** -- T7400 is still TODO
  as of this filing; add the `deploys` table to that SAME module/schema version, not a second
  parallel sqlite file)
- `src/frontend/src/components/admin/` -- wherever the pulse/report cards render (see T5940's
  cohesion note: `AnalyticsDashboard.jsx` and siblings) -- new deploy picker + before/after
  rendering
- `GET /api/version` (existing) -- reference for what "current deploy identity" already looks
  like; this task's endpoints are the historical version of the same idea

### Related Tasks
- **Depends on: T7400** (analytics.sqlite store must exist before this task's `deploys` table
  can land in it).
- Touches the same endpoints T7420 (activation), T7430 (retention), and T7440 (growth) build,
  plus the existing pulse card. Ship `upload_success_rate` (highest-proven value, per the
  T8170 alarm history) and ONE report together first to prove the pattern before extending to
  the rest -- don't require all four in v1.
- **Sequence after T7460** (epic capstone) **and T7465** (Journey Flow graph, also filed
  2026-09-02 -- replaces the admin bar funnel on the same `AnalyticsDashboard`): this task
  touches the same admin report endpoints/components T7410-T7465 are actively shaping, so
  landing last avoids merge churn on files still moving.

### Technical Notes
- Reuses T7400's single-writer + etag-CAS analytics.sqlite discipline as-is; adds no new
  persistence mechanism, just one more table in that store.
- Zero new Postgres tables/columns -- consistent with the epic's binding directive.
- Carry T7460's "insufficient data" / honest-small-N convention into the before/after cards:
  a pair spanning a holiday dip or a tiny N says so, rather than rendering a scary-looking
  delta off two data points.

## Implementation

### Steps
1. [ ] `deploys` table added to the analytics.sqlite module from T7400 (`deployed_at`,
   `commit_sha`, `short_sha`, `build_number`, `env`)
2. [ ] `POST /api/admin/deploys` (admin-session-gated) + `GET /api/admin/deploys` (list,
   newest first)
3. [ ] `scripts/deploy_production.sh` calls the POST endpoint after backend health verify
   succeeds
4. [ ] `since_deploy` param added to `analytics_pulse`'s `upload_success_rate` card + at least
   one of T7420/T7430/T7440's reports
5. [ ] Admin UI: deploy picker + before/after card rendering with small-N honesty
6. [ ] Tests: deploy log CRUD, `since_deploy` date resolution + before/after windowing,
   small-N suppression

## Acceptance Criteria

- [ ] From the admin panel, pick any deploy recorded since this feature shipped and see
  before/after for upload success rate (and at least one other report) without touching a
  terminal or writing a query
- [ ] Deploys are recorded automatically by `deploy_production.sh` -- no manual step
- [ ] The day-granularity limitation is visible in the UI, not silently hidden
- [ ] Zero new Postgres tables/columns; the `deploys` table lives in analytics.sqlite
- [ ] Small-N pairs render "insufficient data" rather than a misleading percentage
