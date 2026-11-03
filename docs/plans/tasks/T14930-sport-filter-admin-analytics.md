# T14930: Arrival sport on sign-ups: landing sport pages tag `utm_content`, admin filters by it

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Tier:** M (landing one-file change + read-only admin filter; no schema change)
**Created:** 2026-11-03
**Updated:** 2026-11-03

User request 2026-11-03: a "sport" filter on the data. Owner rulings the same day: users can have
several sports (one per profile), so no single-sport column and no migration; get marketing-usable
sport data without changing the DB or adding read-time cost. This is piece 1 of 3 (T14930 arrival
sport, T14940 sport in event context, T14950 sport in the rollup).

## Problem

Nothing in Postgres says which sport brought a parent in. The landing site has one page per sport
(`src/landing/src/pages/[sport].astro`) and already relays `utm_*` and `ref` onto its app links
(`PageLayout.astro`, the "carry attribution query params" block), and sign-up already stores
`utm_content` in `user_segments`. The sport page simply never sets it. Search Console (Oct 2026)
shows volleyball, rugby, football and hockey pages out-ranking soccer; nobody can tell whether those
parents sign up, export or pay.

## Solution

**Arrival sport** = the sport page the visitor came from, carried as `utm_content=<sport key>` on
every app link from a sport page, when the visitor did not already arrive with a `utm_content` (an
ad's own value wins). It lands in the existing `user_segments.utm_content` column at sign-up with no
backend change. The admin reads it as a dimension labelled "arrival sport".

- Landing: in the shared link-building block, if the current page is a sport page and `utm_content`
  is absent, append `utm_content=<sport key>`; keep every other param as is. Sport keys are the same
  keys the app's profile UI uses (one list; the landing already has them for the dynamic route).
- Admin: `sport` filter on `GET /api/admin/analytics/journey`, `/journey/step/{stage}`
  (`by=arrival_sport`), `GET /api/admin/users`, and the T14910 spend-readiness payload, all as a
  predicate on `user_segments.utm_content` restricted to known sport keys; anything else is
  "unknown". A `Sport` pill group beside Origin and Platform in `JourneyTab.jsx` (reuse `PillGroup`),
  carried by the global filter in `adminStore.js`.
- Label everywhere: "arrival sport (landing page)". It is the visitor's interest at arrival, not
  the profile's sport; direct and word-of-mouth arrivals are "unknown" and shown as such.

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/layouts/PageLayout.astro` - append `utm_content` on sport pages
- `src/landing/src/pages/[sport].astro` - exposes the sport key to the layout
- `src/backend/app/routers/admin.py` - `sport` param on journey, step, users
- `src/backend/app/services/analytics_journey.py` - predicate in `fetch_patterns`
- `src/frontend/src/components/admin/JourneyTab.jsx`, `DimensionTable.jsx`, `stores/adminStore.js`
- Tests: landing link test (sport page adds, ad param wins), journey filter test, users filter test

### Related Tasks
- Siblings: T14940 (sport in milestone context), T14950 (sport key in the rollup).
- Feeds: T14910 (gates per arrival sport), T14920, T7440 (growth by sport), T14960 (visited node per
  sport needs the beacon's page_class to carry the sport; see that task).
- No dependency on T7400 or T7410.

### Technical Notes
- Zero schema change, zero read-time cost beyond an indexed predicate on an existing column.
- Never backfill or infer arrival sport for existing users; they stay "unknown".
- Ads must set their own `utm_content`; the landing only fills the gap. Document this in the
  campaign registry help text.

## Implementation

### Steps
1. [ ] Failing tests: sport page link carries `utm_content=hockey`; a visit with `utm_content=ad1`
       keeps `ad1`; non-sport pages add nothing.
2. [ ] Landing change.
3. [ ] Failing tests for the admin predicate (known key, `unknown`, `all`); implement; pill group.
4. [ ] Screenshot the pill group on desktop and phone.

### Progress Log

**2026-11-03**: Filed; reshaped twice the same day (single column -> set table -> arrival sport with
no DB change) after the owner's rulings.

## Acceptance Criteria

- [ ] Every app link on a sport page carries the sport as `utm_content` unless one was already present.
- [ ] Journey, step, Users and the gates payload accept `sport` and agree on counts.
- [ ] "unknown" is a visible bucket; no inference, no backfill.
- [ ] No migration, no new table or column.
