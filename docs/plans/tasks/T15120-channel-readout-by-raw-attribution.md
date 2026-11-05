# T15120: Channel read-out by raw attribution (the daily table every acquisition arm is read from)

**Status:** STAGING
**Impact:** 8
**Complexity:** 4
**Tier:** M (admin read endpoint gains a `by` dimension and five columns; one admin table gains a dimension picker and CSV; no schema change)
**Created:** 2026-11-04
**Updated:** 2026-11-04

Owner-approved 2026-11-04 from the acquisition-test prep list in
[topdown-vs-bottomup-2026-11-04.md](../bi/topdown-vs-bottomup-2026-11-04.md) sections 9 and 10.
The test programme has up to eight arms (Meta US, Meta non-US, Reddit US, Reddit non-US, share
loop, coach codes, organic Reddit, SEO). Each needs the same daily row: sign-ups, upload attempted
and succeeded, first highlight within 14 days on sign-ups old enough to have one, paywall shown,
buy modal opened, payers, revenue. Today that row exists only per `origin`, and only for five
funnel steps; anything keyed on the raw UTM fields is ad-hoc SQL against prod.

## Problem

Audit 2026-11-04 (read-only):

- `GET /api/admin/analytics/channels` (`app/routers/admin.py:2173-2215`) groups by `s.origin` only,
  via `_segment_group_rows` (2300-2362), with `DIMENSION_STEPS = ("game_upload_succeeded",
  "clip_created", "export_completed", "share_completed", "credit_purchased")` (2296) as "% of
  sign-ups who" columns, plus `signups`, `revenue_cents` (from the `payments` ledger) and
  `upload_success_pct`. Cohorts (2392) and Builds (2428) reuse the same helper.
- `user_segments` already stores `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
  `utm_term`, `click_source` (`pg.py:265-295`), and `referrals.channel` names the referral kind,
  but no endpoint or UI reads any of them. A Meta ad set tagged `utm_campaign=<registry id>`
  becomes the `origin` (`_registered_campaign_id`, `analytics.py:677-700`) and so appears in
  Channels, but `utm_content` (sport per T14930, or the creative) and `utm_source` (meta vs reddit)
  never do, and an organic Reddit post tagged only with `utm_source=reddit` is invisible unless it
  also carries a registered id.
- "First highlight" is not a column: the honest render event is `credits_consumed` (and
  `export_started`/`export_completed` once T14710 lands); nothing computes "within 14 days of
  sign-up, among sign-ups at least 14 days old", which is the rate the Journey map and the
  revenue outlook use (12.5% on mature cohorts, M).
- `paywall_shown` and `buy_modal_opened` exist as actions and daily counters but not as
  per-dimension columns. Upload attempts (`game_upload_attempted`) are not a column either, so the
  table cannot show tries beside successes (project rule: tries and successes always together).
- `ChannelsTable.jsx` renders what the endpoint returns; `adminStore.loadChannels` passes only
  `from`/`to` (`adminStore.js:440-450`). No export.

## Solution

1. **One dimension parameter.** `GET /api/admin/analytics/channels?by=origin|utm_source|utm_campaign|utm_content|click_source|referral_channel`
   (default `origin`, so the existing Campaigns view is unchanged). `by` maps to a whitelisted
   `group_expr` passed to `_segment_group_rows`; `referral_channel` joins `referrals r ON
   r.referred_id = s.user_id` and groups on `COALESCE(r.channel, 'none')`. NULL values group as
   `"unknown"` and are shown, never dropped (a number must not hide what it excluded, T8650).
   Campaign names still join for `origin` and `utm_campaign` values that are registry ids.
2. **Five columns added to `_segment_group_rows`**, so Cohorts and Builds gain them too:
   - `upload_attempted` (distinct users with `game_upload_attempted`) shown beside the existing
     `upload_success_pct` as a count pair (tries / successes).
   - `first_highlight_14d`: among users in the group with `acquired_at <= today - 14 days`, the
     share with a `credits_consumed` (or `export_completed`) action within 14 days of
     `acquired_at`; returned as `{aged, hit, pct}` so small N is visible. Grey under 20 aged in the
     UI (same threshold as T14900).
   - `paywall_shown`, `buy_modal_opened` (distinct users).
   - `payers` (distinct users with `credit_purchased`) as a count beside the existing
     `purchased_pct`; `revenue_cents` stays from the ledger.
3. **UI.** `ChannelsTable` gets a dimension picker (the six values, labelled "Campaign", "Source",
   "Content", "Click source", "Referral channel", "Origin") and a "Download CSV" button that
   serialises the current rows client-side (no new endpoint). Row click keeps its current
   behaviour for `origin`; for the other dimensions it filters the Users table by the same field
   (extend `GET /api/admin/users` filters only if the field is not already supported; otherwise
   out of scope and the row is not clickable, stated in the UI).
4. **Read-out doc.** One paragraph in `.claude/knowledge/backend-services.md` (attribution section)
   naming the dimensions and the 14-day definition, and a line in the revenue outlook's daily
   read-out table pointing at the new view.

Out of scope: a `spend_cents` column on `campaigns` for in-app cost per sign-up (spend stays in
the owner's sheet for the test; file later if the test runs), the visit beacon (T7400/T7410), and
any per-event storage. Everything here reads `user_segments`, `user_actions`, `referrals` and
`payments` as they are.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` - `analytics_channels` `by` param and whitelist; `_segment_group_rows` five new columns; `DIMENSION_STEPS` unchanged
- `src/backend/app/analytics.py` - no change expected; `credits_consumed`/`export_completed` action names are the source of the 14-day column
- `src/backend/tests/test_admin_analytics*.py` (existing admin analytics tests) - new dimension and columns, NULL grouping as "unknown", 14-day aged logic at the boundary
- `src/frontend/src/stores/adminStore.js` (`loadChannels`) - `by` param
- `src/frontend/src/components/admin/ChannelsTable.jsx` (+ test) - dimension picker, count pairs, CSV
- `src/frontend/src/components/admin/AdminScreen.jsx:279` - wiring
- `.claude/knowledge/backend-services.md` - attribution section paragraph
- `docs/plans/bi/revenue-outlook-2026-11-04.md` - daily read-out table pointer

### Related Tasks
- Depends on: nothing hard. T14710 (STAGING) makes `export_completed` honest for the paid render; until it is on prod the 14-day column reads `credits_consumed`.
- Feeds: every arm of the acquisition test; T14910 gates 2, 5, 6 read the same columns; T14930 (`utm_content` = arrival sport) becomes readable through `by=utm_content`; T15070 (`referral_channel = endcard`) through `by=referral_channel`.
- Related: T14740 (drop-off click filters Users) for the row-click pattern.

### Technical Notes
- `_segment_group_rows` is shared by three endpoints; adding columns is one change, three views. Keep the SQL per column in one place and test the boundary (acquired exactly 14 days ago counts as aged; a render at 14 days + 1 second does not count as within window).
- Keep `exclude_test` semantics (`_segment_window_where`) on every new column.
- The `by` whitelist is a dict of literal column expressions; never interpolate the client value.
- Performance: `user_actions` lookups per group are the existing pattern; with 400 users this is nothing, but write the 14-day query as one grouped query, not per row.

## Implementation

### Steps
1. [ ] Failing backend tests: `by=utm_source` groups NULL as `unknown`; `by=referral_channel` shows `endcard` and `none`; `first_highlight_14d` boundary cases; `upload_attempted` and `payers` counts; Cohorts and Builds carry the new columns.
2. [ ] Endpoint and helper changes.
3. [ ] `ChannelsTable` picker, count pairs, grey-under-20, CSV; store param; tests.
4. [ ] Knowledge doc paragraph; revenue-outlook pointer.
5. [ ] Staging check against the e2e account: switch dimensions, download CSV, confirm totals equal the Journey map's sign-up count for the same window.

### Progress Log

**2026-11-04**: Filed from the owner's approval of the acquisition-test prep list.

## Acceptance Criteria

- [ ] Channels can be grouped by origin, utm_source, utm_campaign, utm_content, click_source and referral channel; unknown values appear as a row.
- [ ] Every row shows sign-ups, upload attempted and succeeded, first highlight within 14 days on aged sign-ups (with the aged count), paywall shown, buy modal opened, payers and revenue.
- [ ] Row totals across a dimension equal the window's sign-up total (no row silently excluded).
- [ ] CSV of the visible table downloads.
- [ ] No schema change, no new per-event table; relevant backend and frontend tests pass.
