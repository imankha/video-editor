# T15010: Landing page that converted: `landing_path` stored at sign-up and readable in admin

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Tier:** L (schema change: one nullable column on `user_segments`; landing + frontend + backend; Migration agent)
**Created:** 2026-11-03
**Updated:** 2026-11-03

Owner question 2026-11-03 on attribution across the landing -> app hop. Piece 2: which landing
PAGE brought the sign-up. Today nothing records it.

## Ruling

Owner ruling 2026-11-07: when a user deletes their account they lose all user data, their email is
replaced with a hash, and analytics on them is kept and knows they deleted. So `landing_path` is
kept on deletion (never on the strip list) and the admin Landing page table shows a deleted count
from `account_deletions` once T15290 lands (same group). The page-class list in step 5 is approved
as written. T15000 landed in PR #716 and T15220 (params reach `captureCampaignParams`) in PR #718.

## Problem

The landing has about 30 pages that each sell the product to a different reader: sport pages
(`[sport].astro`), camera pages (`works-with/[camera].astro`: Veo, Trace, ...), comparisons
(`vs/[comparison].astro`), guides, `for-clubs`, `for-coaches`, `for-parents`,
`recruiting-videos`. Search Console (Oct 2026) shows non-soccer sport pages and the Trace page
earning impressions, but no sign-up can be traced to any page. SEO effort and page copy cannot be
judged by what they convert, only by clicks. T14930 covers sport pages alone, by filling
`utm_content`; camera, comparison, guide and audience pages still vanish at the hop.

## Solution

1. **Landing** (on T15000's first-touch record): `lp` = the first landing pathname of the tab,
   lower-cased, query and hash stripped, max 120 characters, relayed as `lp=` on every app link
   like the other params.
2. **App**: `captureCampaignParams` whitelists `lp` into `campaignParams.landing_path`; both auth
   paths (`OtpAuthForm.jsx` verify body, `googleAuth.js` auth body) send it, as they do
   `referrer_host`.
3. **Backend**: the two sign-up request models in `routers/auth.py` accept
   `landing_path: str | None` with validation (must start with `/`, path characters only, max 120;
   anything else is dropped with a warning, never a 4xx). `create_user_segment` writes it.
   `_determine_origin` is unchanged: a page is not an origin.
4. **Schema**: `ALTER TABLE user_segments ADD COLUMN landing_path TEXT` in the next free
   `postgres` migration (T14980 also claims a version; take the next free one at implementation
   time) and in `_SCHEMA_DDL`. Account deletion keeps the stripped `user_segments` row;
   `landing_path` is a page class, not identity, so it stays (design gate confirms; if the reviewer
   disagrees it joins the `utm_*` strip list).
5. **Admin read**: `by=landing_path` on the step inspector (`/journey/step/{stage}`), a "Landing
   page" table in the dimension picker beside Campaigns / Cohorts / Builds (T13990 shape), and the
   value on the user detail panel next to origin. Group by the path's first segment class
   (`sport`, `works-with`, `vs`, `guides`, audience, `home`, `other`) for small N, exact path on
   expand. Direct app arrivals and pre-T15010 users are "unknown", never backfilled or inferred.

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/attribution.ts` - `lp` in the record and the merge (T15000's module)
- `src/frontend/src/utils/campaignCapture.js` + `referralCapture.test.js` - whitelist `lp`
- `src/frontend/src/components/auth/OtpAuthForm.jsx`, `src/frontend/src/utils/googleAuth.js` - send it
- `src/backend/app/routers/auth.py` - request models + pass-through (two sign-up paths)
- `src/backend/app/analytics.py` - `create_user_segment` column
- `src/backend/app/migrations/postgres/` (next free version) and `src/backend/app/services/pg.py` `_SCHEMA_DDL`
- `src/backend/app/routers/admin.py`, `src/backend/app/services/analytics_journey.py` - `by=landing_path`, users payload
- `src/frontend/src/components/admin/DimensionTable.jsx`, `StepInspector.jsx`, `UserDetailPanel.jsx`
- Tests: `test_auth.py` (validation, stored value), `test_admin.py` (dimension), frontend capture + admin tests

### Related Tasks
- Blocked by: T15000 (first page of the visit; without it `lp` would be the CTA page).
- Siblings: T14930 (arrival sport via `utm_content`; keep both, sport pages then show up in both
  cuts), T7410 (anonymous visit counts per `page_class`; with this task visit -> sign-up per page
  class becomes computable once both exist).
- Feeds: T14910 gate 10, the `user-acquisition` agent's SEO reading (which page converts, not
  only which page ranks), the `business-intelligence` agent's data model table.

### Technical Notes
- One nullable column, written once at sign-up, never updated: no hot-path cost, no read-time cost
  beyond an optional GROUP BY. The owner's 2026-11-03 "no DB change" ruling was about sport, where
  an existing column (`utm_content`) fit; no existing column fits a page path, so this is the one
  place a column is proposed. Alternative considered and rejected: fold into T7410's beacon, which
  counts anonymous visits per page and can never link a page to a sign-up.
- The `postgres` track is deploy/admin-triggered: after deploy, `POST /api/admin/migrate-postgres`;
  `create_user_segment` must tolerate the column being absent between deploy and migration the way
  it does for `signup_build` (log error, write the row without it), never fail the sign-up.
- Never store the query string or hash; never store the app's own paths (share pages are the app,
  their arrival is already `referrer_host` or `ref`).

## Implementation

### Steps
1. [x] Design gate: settled by the owner ruling above.
2. [ ] Failing backend tests: valid path stored; invalid dropped with warning; absent column
       tolerated; `by=landing_path` groups and labels "unknown".
3. [ ] Migration + DDL; backend; frontend capture + auth bodies; landing `lp`.
4. [ ] Admin dimension table and detail row; screenshots phone and desktop.
5. [ ] Post-deploy: run the postgres migration, confirm one fresh sign-up carries a path.

### Progress Log

**2026-11-03**: Filed with T15000 from the owner's attribution question.

## Acceptance Criteria

- [ ] A sign-up that began on `/works-with/trace` and clicked through two pages shows
      `landing_path = /works-with/trace` in admin.
- [ ] Invalid or oversized values never block a sign-up and are not stored.
- [ ] Admin step inspector groups by landing page class with an explicit "unknown" bucket.
- [ ] Migration applies on dev, staging and prod via the admin endpoint; fresh DDL matches.
