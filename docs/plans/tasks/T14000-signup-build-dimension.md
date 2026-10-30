# T14000: Record the deploy build at signup and add a Builds dimension to the admin panel

**Status:** WIP
**Impact:** 6
**Complexity:** 4
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

The admin panel can slice users by campaign (origin) and by signup week, but not by the
build they signed up under. Nothing records it: `user_segments` has `acquired_at` and the
UTM columns only. The backend already knows its own build at request time
(`app/version.py`: `APP_BUILD`, a monotonic `git rev-list --count HEAD` baked at deploy;
`upload_failures` stamps it the same way). User request 2026-10-29: "Build versions" as the
third mutually exclusive dimension next to Campaigns and Cohorts.

## Solution

**Capture (backend only, no client trust)**
- Migration `v039_user_segments_signup_build.py` + `_SCHEMA_DDL`:
  `ALTER TABLE user_segments ADD COLUMN IF NOT EXISTS signup_build INTEGER`,
  `ADD COLUMN IF NOT EXISTS signup_commit TEXT`. Existing rows stay NULL (correct history:
  the build was not recorded before this change; never backfill a guess).
- `create_user_segment` writes `signup_build = APP_BUILD` and `signup_commit = APP_VERSION`
  in the same INSERT. Local dev writes 0 / "dev".
- The two columns carry no identity, so a deleted account keeps them: do not add them to
  `_DEIDENTIFY_SEGMENT_COLUMNS`; extend that comment block to say so.

**Endpoint**
- `GET /api/admin/analytics/builds`: same shape as `/analytics/cohorts` (signups, uploaded,
  clipped, exported, shared, purchased, revenue, time-to-export, 7d return) grouped by
  `signup_build` instead of `date_trunc(acquired_at)`, newest build first, honoring
  `exclude_test`, `from`/`to` and `origin`. Rows with NULL `signup_build` group into one
  `"unrecorded"` row at the bottom so the counts reconcile with the cohort totals. Each row
  carries `commit_sha` (first seen) and `first_signup_at` so the admin can tell builds apart.
  Factor the four cohort queries' group expression into a parameter rather than copying
  the 120-line block.

**Filter plumbing**
- `GET /api/admin/users`, `/analytics/funnel`, `/analytics/platforms` and `/dashboard`
  accept `build=<int>` the way they accept `origin`; `adminStore` gains `segmentBuild`,
  sent as `build`. `clearSegmentFilter` clears it (T13990 adds the exclusive-selection rule).

**Frontend**
- `components/admin/BuildsGrid.jsx`: the `CohortGrid` layout with the first column
  `#4812 (abc1234)` and a second column for the first-signup date. Row click sets
  `segmentBuild`. T13990's `Builds` pill renders it.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/postgres/v039_user_segments_signup_build.py` (new) + `__init__.py`
- `src/backend/app/services/pg.py` (`_SCHEMA_DDL` user_segments)
- `src/backend/app/analytics.py` (`create_user_segment`)
- `src/backend/app/routers/admin.py` (`analytics_builds`, `build` param on users/funnel/platforms/dashboard)
- `src/frontend/src/components/admin/BuildsGrid.jsx` (new) + test
- `src/frontend/src/stores/adminStore.js` (`segmentBuild`, `fetchBuilds`, `buildsData`)
- `src/frontend/src/screens/AdminScreen.jsx` (wire into the T13990 pill)
- `src/backend/tests/test_analytics_dashboards.py` (extend: builds endpoint, NULL bucket, build filter)

### Related Tasks
- Depends on: T13990 (pill row renders the grid); can be built in parallel, wired last
- Sibling: T13980

### Technical Notes
- Why server-stamped and not the client's `__APP_BUILD__`: the server value cannot be forged,
  needs no auth-body change, and matches the client whenever both came from the same deploy
  (lockstep rule, backend-services.md "Deploy + build-number lockstep"). A straggler client on
  an older PWA shell signing up against a newer server is attributed to the server build; note
  this in the grid's tooltip.
- Postgres track: operator runs `POST /api/admin/migrate-postgres` after deploy. Until then the
  INSERT in `create_user_segment` would fail on the missing column: guard the hot path per the
  new-column migration-window rule (backend-services.md "Migration-window column guard audit")
  so a signup never fails because the admin has not migrated yet.
- Knowledge doc: `.claude/knowledge/backend-services.md`.

## Acceptance Criteria

- [ ] A signup on a server with `APP_BUILD=4812` writes `signup_build = 4812` and the commit sha; pre-existing rows stay NULL
- [ ] `GET /api/admin/analytics/builds` returns one row per build plus an `unrecorded` row; the summed signups equal the cohort grid's total for the same window and filters
- [ ] Clicking a build row filters the user table, funnel and platform breakdown to that build; Clear all removes it
- [ ] Signup still succeeds when the `signup_build` column does not exist yet (migration not run), with a loud log line
