# T16850: One Sport filter at the top of Admin that filters every section

**Status:** WIP
**Impact:** 5
**Complexity:** 5
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

**Today.** The Admin page has a Sport filter, but it sits inside the Journey section's controls. It filters by
arrival sport: the sport landing page a visitor first came from (`utm_content`), not the sport on their profile.
Only Journey and the Users list it opens honor it. Pulse, Platform Breakdown, Pack Mix, Retention, Activation,
Revenue Reconciliation, By Sport and Upload Failures ignore it.

**The problem.** The owner wants to look at the whole business for one sport at a time. With the filter buried in
Journey, the rest of the page silently shows every sport, so numbers read side by side do not describe the same
people.

**What we will do.** Move the Sport control out of Journey into a filter bar at the top of the Admin page, and make
every section that counts people or their activity filter by it. A section that cannot be split by sport says so
next to its title instead of silently showing everyone.

**Why this and not something else.** The owner chose this over moving the control and keeping its reach
(2026-11-17).

**How we will know it worked.** Picking a sport at the top changes the numbers in every section to that sport's
users, and picking "All sports" brings back today's numbers.

## Ruling

Owner picked "Every section" on 2026-11-17 (owner, 2026-11-17): the Sport filter moves to the top of Admin and
filters every section, not just Journey and Users.

## Acceptance Criteria

- [ ] C1: The Sport control is at the top of the Admin page, above Pulse, and no longer inside Journey's controls.
  Choosing a sport there filters Journey and the Users list exactly as the old control did.
- [ ] C2: With a sport chosen, Pulse, Platform Breakdown, Pack Mix, Retention, Activation, Revenue Reconciliation and
  Upload Failures count only users whose arrival sport is that sport (or with no known arrival sport, for
  "Unknown"). A test seeds users of two arrival sports and shows each section's numbers change with the filter.
- [ ] C3: "All sports" gives the same numbers each section shows today.
- [ ] C4: A section that cannot be split by sport (for example R2 Usage, which is storage, or By Sport, which is
  already split by sport) shows a short note that the Sport filter does not apply to it.

## Context

The filter's value is `segmentSport` in `src/frontend/src/stores/adminStore.js`. The server side is `SportFilter` and
`_append_sport` in `src/backend/app/routers/admin/__init__.py` (arrival sport is `s.utm_content` against
`ARRIVAL_SPORT_KEYS`), and `_add_sport` in `src/backend/app/services/analytics_journey.py`. Reuse those: one
definition of arrival sport, applied to each endpoint, not a new one per section. Pass `sport` on each section's
fetch only when set. Analytics rules: in-house aggregates only, and show the denominator (N) with any rate.

### Relevant Files (REQUIRED)

- `src/frontend/src/screens/AdminScreen.jsx`
- `src/frontend/src/components/admin/JourneyTab.jsx`
- `src/frontend/src/stores/adminStore.js`
- `src/backend/app/routers/admin/__init__.py`
- `src/backend/app/routers/admin/analytics.py`
- `src/backend/app/services/analytics_journey.py`
