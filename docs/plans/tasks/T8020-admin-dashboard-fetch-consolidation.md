# T8020: Admin dashboard fires 5 separate analytics fetches instead of one combined round-trip

**Status:** WIP
**Impact:** 4
**Complexity:** 3
**Created:** 2026-08-28
**Updated:** 2026-08-28

## Problem

HAR captured against **production** (`Downloads/app.reelballers2.com.har`, 2026-08-28,
admin dashboard load) shows `AdminScreen.jsx:74-80` firing five independent store actions in the
same `useEffect` tick — `fetchUsers()`, `fetchPulse()`, `fetchChannels()`, `fetchCohorts()`,
`fetchPlatforms()` — each hitting its own backend endpoint (`/api/admin/users`,
`/api/admin/analytics/{pulse,channels,cohorts,platforms}`). Combined with `/api/admin/me`
(fired separately from `authStore.checkAdmin()`) and `/api/bootstrap`, that's **7 concurrent
requests** to `api.reelballers.com` on every admin page load, each carrying its own CORS
preflight, auth/session-middleware pass, and connection overhead.

General app data already went through this consolidation once — `/api/bootstrap` merged "9+
individual fetches" into one round-trip (see `App.jsx:243` and its own history). The admin
analytics widgets never got the same treatment.

This compounds with [T8000](T8000-admin-analytics-event-loop-blocking-scale.md) (merged, STAGING
— converts the 6 analytics handlers off the event loop): T8000 fixes *how expensive* each
request is once it starts serializing; this task independently reduces *how many* separate
round-trips the admin dashboard needs in the first place. They're complementary, not
duplicative — do T8000 first (it's already done and just needs to reach prod), this is a
smaller independent follow-up.

Not in scope / explicitly not bugs (checked against this same HAR, no task needed):
- `auth/me` → `auth/init` serialization (`sessionInit.js:215-318`) is intentional — `/init`
  deliberately waits for `/me` to avoid firing a profile-provisioning write for anonymous
  visitors (see comment at `sessionInit.js:268-270`, T3360). Real optimization opportunity in
  principle, but requires a backend auth-check change to safely collapse; not a quick win.
- The two `/storage/warmup` calls per load (`index.html:26-30` unauthenticated cold-start ping
  vs. `cacheWarming.js:532-560` authenticated video-URL prefetch) are two different purposes by
  design (T3320), not a duplicate-fetch bug.

## Solution

Add one consolidated read endpoint, e.g. `GET /api/admin/dashboard`, that returns
`{users, pulse, channels, cohorts, platforms}` in a single response, mirroring the
`/api/bootstrap` pattern. `AdminScreen.jsx`'s effect calls one `adminStore` action instead of
five; the store fans the combined response out into its existing `usersData` / `pulseData` /
`channelsData` / `cohortsData` / `platformsData` fields so downstream components don't change.

Keep `/api/admin/users`, `/api/admin/analytics/{pulse,channels,cohorts,platforms}` as standalone
endpoints (used individually elsewhere — e.g. filtered user search, campaign click-through) —
add the combined endpoint alongside them, don't replace them.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/AdminScreen.jsx:74-80` — the effect firing the 5 fetches
- `src/frontend/src/stores/adminStore.js:66,214,224,239,248` — `fetchUsers`, `fetchChannels`,
  `fetchCohorts`, `fetchPulse`, `fetchPlatforms` — add one `fetchDashboard()` alongside these
- `src/backend/app/routers/admin.py:93,1051,1198,1596,1885` — the 5 existing handlers being
  combined (`/users`, `/analytics/channels`, `/analytics/cohorts`, `/analytics/pulse`,
  `/analytics/platforms`); new combined handler calls the same underlying query functions,
  doesn't duplicate the SQL

### Related Tasks
- [T8000](T8000-admin-analytics-event-loop-blocking-scale.md) — fixes the event-loop-blocking
  root cause behind these handlers' cost; STAGING, merged, awaiting prod deploy. Do that first;
  this task's win is independent (fewer round-trips) and stacks on top of it.
- [T8010](T8010-admin-remaining-async-handlers-block-loop.md) — the 2 remaining blocking
  handlers T8000 didn't cover (not touched by this task, but same file)

### Technical Notes
- After T8000/T8010 land, none of the 5 handlers block the event loop, so this task is a
  request-count/overhead win (fewer CORS preflights, fewer TLS/H2 stream setups, fewer
  session-middleware passes), not a stall fix — size the priority accordingly relative to other
  work.
- Follow the `/api/bootstrap` precedent for response shape and error handling (partial-failure
  behavior: if one sub-query fails, does the whole endpoint 500, or return partial data with a
  per-section error flag? Match whatever `/api/bootstrap` already decided).

## Implementation

### Steps
0. [x] BUNDLED FIX (user-approved 2026-08-28): `list_users` (admin.py) converted `async def`
       -> `def` (threadpooled off the loop). Sync-def guard extended to 9 handlers
       (`test_all_nine_admin_dashboard_handlers_are_sync_def`), behavioral concurrency probe
       added (`test_list_users_does_not_serialize_concurrent_requests`), counterfactually
       verified (reverting to `async def` makes the N-burst ~N*DELAY and fails both the
       behavioral probe and the sync-def guard).
1. [x] Added `GET /api/admin/dashboard` (`get_admin_dashboard`, sync `def`) composing the 5
       existing handler functions; every param passed explicitly (Query-sentinel trap).
2. [x] Added `fetchDashboard()` to `adminStore.js`, fanning the combined response into the
       same 5 state fields.
3. [x] `AdminScreen.jsx` mount effect now calls `fetchDashboard()` once.
4. [x] Individual endpoints unchanged; `setSegmentFilter`/`nextPage`/`prevPage` still call the
       individual `fetchUsers`/`fetchPulse` actions (grep-confirmed sole other callers).

### Progress Log

**2026-08-28**: Filed from a production HAR analysis (`Downloads/app.reelballers2.com.har`).
The HAR's dominant finding (all 7 admin requests taking ~4s and finishing within ~40ms of each
other) is not this task — it's [T8000](T8000-admin-analytics-event-loop-blocking-scale.md),
already merged and sitting in STAGING; this HAR is fresh proof prod hasn't gotten that fix yet.
This task captures the smaller, independent, not-yet-filed finding from the same HAR: the admin
dashboard's own fetch count was never consolidated the way `/api/bootstrap` was.

**2026-08-28 (later)**: Queued behind T8010 (same file, admin.py) to avoid a merge conflict;
T8010 merged (PR #307), spawning now. During kickoff prep, found `list_users` shares the
T8000/T8010 bug pattern (see Step 0) — user approved bundling the fix into this task rather
than filing separately, since the new combined endpoint calls `list_users` directly anyway.

**2026-08-29 (implementation)**: Implemented on `feature/T8020-admin-dashboard-fetch-consolidation`.
Backend: `list_users` -> sync `def`; new `/dashboard` composer. Fixed two pre-existing direct-call
tests (`test_t5770_usage_daily.py`, `test_t4970_admin_segmentless_enumeration.py`) that did
`asyncio.run(list_users(...))` — now a sync call. Frontend: `fetchDashboard` + single mount
fetch, removed 5 now-unused individual-fetch consts from AdminScreen. Evidence: backend
`test_analytics_dashboards.py` (34, incl. new `TestDashboardEndpoint`), `test_t8000_admin_analytics_concurrency.py`
(6, incl. new list_users probe + 9-handler guard), `test_t5770`/`test_t4970` green; frontend
`adminStore.dashboard.test.js` (3) + `AdminScreen.test.jsx` (1) + `adminStore.reconciliation.test.js`
(4) green. Counterfactual for the list_users fix verified (async-def revert fails). Knowledge doc
`backend-services.md` updated.

## Acceptance Criteria

- [x] Admin dashboard load fires 1 request for users+pulse+channels+cohorts+platforms instead of 5
      (`AdminScreen.test.jsx` asserts exactly one mount request to `/api/admin/dashboard`)
- [x] Individual endpoints still work for their other callers (campaign click-through, etc.)
      (routes + signatures untouched; `TestDashboardEndpoint` proves each section == its individual
      endpoint's unfiltered default)
- [ ] Fresh HAR capture confirms the reduced request count — **DEFERRED** (needs live staging/prod
      access, unavailable in the container). Substituted by the `AdminScreen.test.jsx` single-mount-
      request proof; same treatment T7940 gave its deferred prod-verification steps.
- [x] Frontend tests pass
