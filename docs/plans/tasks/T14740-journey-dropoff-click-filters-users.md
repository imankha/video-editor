# T14740: Click a Journey drop-off count to list those users in the Users table

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Tier:** M
**Created:** 2026-11-03
**Updated:** 2026-11-03

User request 2026-11-03: "I want to be able to click the amount of users that fell out and get a list
of those users under Users."

## Problem

The Journey map shows how many users stopped at each stage ("6 gone", "4 stuck", "1 in window",
and "Clipped 45 lost" in the loss ranking), but the admin cannot see **who** they are in the main
Users table. Today a click on a drop ribbon opens the step inspector's small "People" list (capped
by `PEOPLE_CAP`, email and last active only). The Users table below has the full columns, sorting
and the user detail panel, and that is where the admin wants the list.

## Solution

Clicking a drop-off count filters the **Users** section to exactly those users and scrolls to it.

**What is clickable**
1. In the map (`JourneyFlowChart.jsx`): each drop label ("6 gone", "4 stuck", "1 in window").
   Keep the existing ribbon click that opens the inspector; the label text becomes the link
   that filters Users. (Ribbon = inspect, number = list.)
2. In the loss ranking (`LossRanking` in `JourneyTab.jsx`): the "N lost" number, which means stuck +
   gone at that stage. Clicking the rest of the row keeps selecting the stage, as today.

**What the Users section shows**
- A removable filter chip at the top of Users, for example
  `Stopped at Clipped: gone (6)  x`. Clicking x clears it.
- The table lists exactly those users. The count in the chip must equal the number clicked.
- The filter uses the Journey's current settings (signup dates, campaign, build, Real, platform,
  conversion window, inactive after), because those decide who counts as stuck or gone. If the
  admin changes a Journey control while the chip is on, clear the chip (the old list no longer
  matches any number on screen).
- Journey filter and the existing exclusive filter pills (paying, active 7d, ...) are mutually
  exclusive: setting one clears the other, like the existing `setUserFilter`.

**Backend**
Add optional query parameters to `GET /api/admin/users` (`list_users` in
`src/backend/app/routers/admin.py`):
`journey_stage` (a `JOURNEY_LADDER` key), `journey_outcome` (`in_window` | `stuck` | `gone` |
`lost` = stuck + gone), `window_days`, `inactive_days`, `platform`. When `journey_stage` is set:

- Reuse the Journey's own population and classification. Do **not** write a second version of
  the stuck/gone rules: call `fetch_step_users` + `classify_user` from
  `src/backend/app/services/analytics_journey.py` to get the user ids whose furthest stage is that
  stage with that outcome, then add `s.user_id = ANY(%s)` to `where_parts`. A second copy of the
  rules would drift and the chip count would stop matching the map.
- Unknown stage: 404, like `analytics_journey_step` does.
- Validate `journey_outcome` with a `Query(pattern=...)`, like `platform` on the journey endpoint.
- Pagination and sorting keep working unchanged.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` - `list_users` (`GET /users`, ~line 340) and the shared where-builder (~line 2700, the `user_filter == ...` chain); `analytics_journey_step` (~line 1893) for the parameter style and the 404
- `src/backend/app/services/analytics_journey.py` - `fetch_step_users`, `classify_user`, `people_by_outcome` (the existing "stopped at S" rule: `u["furthest"] == s_rank`)
- `src/frontend/src/stores/adminStore.js` - `userFilter`, `setUserFilter`, `fetchUsers` (add a `journeyUserFilter` object and pass its params in `fetchUsers`)
- `src/frontend/src/components/admin/JourneyTab.jsx` - `LossRanking`, `JourneyView` (`selectDrop`), `JourneyTab` (owns the journey filters you must pass along)
- `src/frontend/src/components/admin/JourneyFlowChart.jsx` - drop labels (`<text key={...-label}>`, ~line 215)
- `src/frontend/src/screens/AdminScreen.jsx` - Users `CollapsibleSection`: render the chip, add an element id to scroll to
- Tests: `src/backend/tests/test_analytics_journey_endpoint.py` (or a new `test_admin_users_journey_filter.py`), `src/frontend/src/components/admin/JourneyTab.test.jsx`, `src/frontend/src/screens/AdminScreen.test.jsx`

### Related Tasks
- Do after T14720 (counts strictly decreasing). It does not change who "stopped at" a stage, but it rewrites `fetch_step_users`, which this task calls.
- Touches the same files as T14730 (full screen). If the admin clicks a count while in full screen, exit full screen first so the Users table is visible.

### Technical Notes
- The journey endpoint params are named `from` / `to` / `origin` / `build` / `exclude_test`, and the
  users endpoint calls the same filters `acquired_from` / `acquired_to` / `origin` / `build` /
  `exclude_test`. Map them carefully and test that both endpoints see the same population (same
  dates, same test exclusion).
- `fetch_step_users` is O(users at that stage). That is fine for the admin.
- Read-only feature: no writes, no persistence, no migration. The chip is view state: it must not
  survive a reload (no localStorage).
- `exclude_test` default is ON in both places; keep it that way.

## Implementation

### Steps
1. [ ] Failing backend test: seed users so that at stage `clipped` 2 are gone and 1 is stuck; `GET /api/admin/users?journey_stage=clipped&journey_outcome=gone` returns exactly the 2; `lost` returns 3; an unknown stage returns 404
2. [ ] Backend test: the count returned equals the map node's `gone` / `stuck` for the same filters (call both endpoints)
3. [ ] Implement the backend filter
4. [ ] Failing frontend tests: clicking "6 gone" sets the journey user filter with stage, outcome and the current journey controls, and Users shows the chip; clicking x clears it; changing a Journey control clears it; clicking "N lost" uses `lost`
5. [ ] Implement the store, chip, click targets and scroll-into-view
6. [ ] Check by hand in a real browser on the dev fixture account data (see memory: `imankh+devfixture@gmail.com`); attach a screenshot
7. [ ] Run the named test files and lint changed files

### Progress Log

## Acceptance Criteria

- [ ] Clicking a drop count in the map ("N gone", "N stuck", "N in window") filters Users to exactly those N users and scrolls to Users
- [ ] Clicking "N lost" in the loss ranking filters Users to the N stuck + gone users at that stage
- [ ] The Users section shows a chip naming the stage, outcome and count, with an x to clear it
- [ ] The number of rows equals the number clicked, for any Journey filter combination
- [ ] Clicking the ribbon (not the number) still opens the step inspector as before
- [ ] Changing a Journey control or picking another user filter pill clears the chip
- [ ] Tests fail before the change and pass after it
