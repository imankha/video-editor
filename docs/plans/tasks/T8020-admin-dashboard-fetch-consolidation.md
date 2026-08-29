# T8020: Admin dashboard fires 5 separate analytics fetches instead of one combined round-trip

**Status:** WAITING ON USER
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
0. [ ] BUNDLED FIX (user-approved 2026-08-28): `list_users` (admin.py:94) was found during
       kickoff prep to share T8000/T8010's exact async-def-blocking-the-loop bug (zero
       `await` calls in its body) — missed by both prior sweeps. Convert to `def`, extend
       the sync-def regression guard, add a behavioral concurrency test, counterfactually
       verify. Fixed here because the new combined endpoint calls this function directly.
1. [ ] Add `GET /api/admin/dashboard` in `admin.py`, composing the 5 existing query functions
2. [ ] Add `fetchDashboard()` to `adminStore.js`, populating the same 5 existing state fields
3. [ ] Update `AdminScreen.jsx`'s effect to call `fetchDashboard()` instead of the 5 individual
       actions
4. [ ] Verify campaign-click-through and any other standalone callers of the individual
       endpoints are unaffected (they keep using the individual endpoints)

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

**2026-08-28 (worker complete)**: Container worker (Opus, M-tier) implemented both the
consolidation and the bundled `list_users` fix in ~19 minutes: `list_users` converted to
sync `def`, `GET /api/admin/dashboard` added (all callee params passed explicitly to avoid
the FastAPI `Query()` sentinel default trap; bootstrap-style no-partial-failure), `fetchDashboard()`
added to `adminStore.js`, `AdminScreen.jsx`'s mount effect switched to the single call.
Structural + behavioral concurrency tests for `list_users` (counterfactually verified),
extended sync-def guard to 9 handlers + the new composer, 2 existing tests
(`test_t4970_admin_segmentless_enumeration.py`, `test_t5770_usage_daily.py`) updated for the
now-sync `list_users` call signature, a new `AdminScreen.test.jsx` proving exactly 1 fetch on
mount. The supervisor independently re-ran every relevant test (56 backend + 4 frontend, all
green) AND independently re-ran the `list_users` counterfactual (revert -> fails, restore ->
passes) before pushing, rather than trusting the worker's status-line claim alone. Branch
pushed, CI green on first run (no flake this time).
## Acceptance Criteria

- [x] Admin dashboard load fires 1 request for users+pulse+channels+cohorts+platforms instead of 5 — proven via `AdminScreen.test.jsx` asserting the mount effect fires exactly one fetch
- [x] Individual endpoints still work for their other callers (campaign click-through, etc.) — untouched, `test_analytics_dashboards.py`'s existing tests still pass unchanged
- [ ] Fresh HAR capture confirms the reduced request count — DEFERRED, needs a live staging/prod capture, not available to this container worker (same treatment T7940 gave its own deferred prod-verification steps)
- [x] Frontend tests pass — 4 green (`AdminScreen.test.jsx` + `adminStore.dashboard.test.js`)
