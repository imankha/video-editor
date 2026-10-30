# T13990: Admin panel: one dimension at a time (Campaigns | Cohorts | Builds)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

The admin filter panel (`AdminScreen.jsx`, "Filters -- all dimensions in one panel") stacks
the Campaign table (`ChannelsTable`) and the Cohort grid (`CohortGrid`) on top of each other.
Both are always rendered, both load on mount, and the user has to scroll past one to reach
the other. User request 2026-10-29: these should be three mutually exclusive dimension
filters, Campaigns, Cohorts and Build versions, with exactly one table visible at a time.

## Solution

- Add a dimension pill row inside the filter panel, under the user-type pills:
  `Campaigns | Cohorts | Builds` (same pill styling as `USER_FILTERS`, purple active state).
  Exactly one is active; default `Campaigns`. The choice is view state in `adminStore`
  (`dimension: 'campaigns' | 'cohorts' | 'builds'`), never persisted.
- Render only the active dimension's table in the panel. The other tables are not mounted.
- Fetch only the active dimension's data; switching to a dimension whose data is not loaded
  fetches it then (`fetchChannels` / `fetchCohorts` / `fetchBuilds` from T14000). The mount
  path today loads channels and cohorts through `GET /api/admin/dashboard` in one request
  (`AdminScreen.test.jsx` asserts exactly one request on mount); keep that single request and
  drop the inactive dimensions from the dashboard payload only if the test and the endpoint are
  both updated in the same change.
- Row selection stays per dimension and is mutually exclusive: picking a campaign row clears
  `segmentFrom/To` and `segmentBuild`; picking a cohort clears `segmentOrigin` and
  `segmentBuild`; picking a build clears the other two. Switching the dimension pill keeps
  the current selection (so the user can look at cohorts while a campaign stays applied) but
  shows the active selection as a chip next to "Clear all" so a filter from a hidden
  dimension is never invisible.
- `Builds` pill renders the `BuildsGrid` from T14000. If T13990 lands before T14000, the pill
  is present but disabled with the title "Build capture lands with T14000"; do not ship a
  fake table.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/AdminScreen.jsx` (filter panel, pill row, one-table render, selection chip)
- `src/frontend/src/stores/adminStore.js` (`dimension`, `setDimension`, exclusive selection in `setSegmentFilter`)
- `src/frontend/src/screens/AdminScreen.test.jsx` (mount request count; new pill tests)
- `src/frontend/src/components/admin/ChannelsTable.jsx`, `CohortGrid.jsx` (unchanged unless the chip needs a label helper)

### Related Tasks
- Sibling: T13980 (Manage Campaigns)
- Blocks the Builds pill content: T14000

### Technical Notes
- No persisted view state (project rule): the active dimension resets to Campaigns on reload.
- The results section below the panel ("Results -- everything below reflects the active
  filters") already derives from `segmentOrigin`/`segmentFrom`/`segmentTo`/`userFilter`;
  adding `segmentBuild` there is T14000's job, but `clearSegmentFilter` must clear it here.
- Frontend only; no backend change unless the dashboard payload is slimmed (see above).

## Acceptance Criteria

- [ ] Exactly one of the Campaign table, Cohort grid, Builds grid is in the DOM at any time; the pill row shows which
- [ ] Clicking a cohort row while a campaign is selected clears the campaign selection (and vice versa); the active selection shows as a chip next to Clear all even when its table is hidden
- [ ] Mount still fires exactly one dashboard request; switching to an unloaded dimension fires that dimension's request once
- [ ] Reload returns to the Campaigns dimension
