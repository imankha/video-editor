# T7430: Retention chart

## In plain words

The retention chart: for each week's sign-ups, how many were still active one, two and three weeks later. This is the number the whole roadmap is judged by, and we do not have it today.


**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-08-20

## Problem

Requirement 2.3: "Report retention in cohorts (30/60/90-day), adjusted for sport seasonality... The investor-grade outcome is a retention curve that visibly flattens." Today `/analytics/cohorts` (admin.py:1078) shows per-cohort "% ever did X" and a single return-after-7d flag — no triangle, no curve over time, no unbounded variant, no seasonality handling. This is THE chart investors ask for on demand ("show me your cohort retention"); per the epic's requirement 2.1, if we can't produce it nothing else counts.

## Solution

A retention endpoint + admin view built on the **existing** per-user activity spine — PG `user_usage_daily` (user_id, day, seconds), live since v022 — plus T7400's `rollup_action_weekly` for action-level (e.g. clip-library) retention. Zero new stored data beyond T7400's rollup.

Definitions locked in [EPIC.md](EPIC.md): active day = usage_daily row with seconds > 0; weekly bins; classic AND unbounded retention; low-volume weeks from measured activity (no season calendar); WAU/MAU not DAU/MAU.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — `GET /api/admin/analytics/retention` (new)
- `src/backend/app/services/analytics_store.py` — read `rollup_action_weekly` (T7400)
- `src/frontend/src/stores/adminStore.js` — fetch action
- `src/frontend/src/components/admin/RetentionView.jsx` (NEW: triangle grid + curve chart + WAU strip), wired into `AnalyticsDashboard.jsx`; `CohortGrid.jsx` stays as-is (different question: funnel %s)

### Related Tasks
- Depends on: T7400 (only for the action-level/clip-library toggle; activity-based retention has no dependency)
- Related: T7420 — use the IDENTICAL cohort-key derivation on `acquired_at`

### Report contents
1. **Triangle**: rows = weekly (toggle: monthly) signup cohorts from `user_segments.acquired_at`; columns = weeks since signup; cell = % of cohort active (classic) or active-in-or-after (unbounded toggle). Day-30/60/90 columns derived from the same data for the investor-standard framing.
2. **Curves**: cohort rows overlaid as retention curves; the flattening (or not) must be visible. Newer-cohorts-above-older is the second story the chart should let the eye find.
3. **Low-volume periods, no season assumptions** (owner rule 2026-11-03: seasons differ per sport and per league, never a calendar): (a) no join-season cohorts; cohorts stay weekly or monthly, optionally grouped by arrival sport (T14930) so each sport's own rhythm shows; (b) **return-after-gap rate** — % of users active in a given month who are active again 120+ days later — is the long-horizon headline, replacing season-over-season; (c) low-volume weeks are detected from measured WAU per arrival sport (for example below 50% of the trailing 12-week median; the rule is one named constant and is printed on the chart) and shaded, not dropped. YoY comparisons preferred wherever a MoM would mislead and a year of data exists.
4. **WAU + WAU/MAU** time series (from `user_usage_daily` day rows), plus the **week-over-week return rate** (% of week N's actives also active in week N+1 — success criterion 4's 50% bar, scored outside detected low-volume weeks; expose it as a service function T7460 can reuse) and **D30-of-activated retention** (% of activation-cohort users active >= 30d after signup — criterion 4's 30% bar).
5. **Action-level toggle** (from `rollup_action_weekly`): retention on `export_completed` (north-star habit) and on clip-library/collections usage (T7450's events) — the "structural retention asset" evidence for requirement 2.3.
6. CSV export per view.

### Technical Notes
- `user_usage_daily` history starts at v022's deploy — charts must show the coverage start honestly (a "data begins" marker), never render pre-coverage weeks as zero retention.
- Small-N honesty: cells with cohort size < 5 render the raw fraction (e.g. 2/4), not a misleading %.
- Compute in SQL where natural (generate_series over weeks joined to usage days), but readable-over-clever; admin-only path.
- Frontend charts: follow the dataviz skill when building; no new chart library without checking what admin components already use (FunnelChart.jsx precedent).

## Implementation

### Steps
1. [ ] Retention endpoint: triangle + curves data (classic/unbounded, weekly/monthly, arrival-sport grouping, WAU series)
2. [ ] Action-level branch reading rollup_action_weekly (graceful "run rollup first" state when stale/absent)
3. [ ] `RetentionView.jsx`: triangle grid, curve overlay, WAU strip, arrival-sport toggle, coverage-start + data-derived low-volume shading
4. [ ] CSV branches
5. [ ] Tests: classic vs unbounded math on fixtures (incl. a lapsed-and-returned user), low-volume week detection edges, small-N rendering, coverage-start masking

## Ruling

**Owner, 2026-11-13** (after testing g-t16070-3 on its local stack with demo data):

- There is one retention view, the **Retention chart**. The separate **Day N Retention** table is removed; its day 1, 3, 7, 14 and 28 figures are read from the chart.
- The chart is the only thing on screen: no table under or beside it. It is **large** (the full width of the admin panel and tall enough to read), and **hovering any point shows its exact number** (the percent, plus how many of how many users).
- The chart's grouping follows the dashboard's top-level **Dimension** pills: with **Campaigns** selected it compares campaigns, with **Cohorts** it compares sign-up cohorts, with **Builds** it compares sign-up builds. Changing the pill changes the chart.
- CSV export stays (it is a download, not an on-screen table).

## Acceptance Criteria

- [ ] The Retention chart renders on demand from live data as one large chart with no table on screen; unbounded/classic and weekly/monthly toggles work, and hovering any point shows its exact percent and counts (ruling 2026-11-13)
- [ ] A user dormant through a detected low-volume period does NOT read as churned in the unbounded view; low-volume weeks are visibly shaded with the detection rule printed
- [ ] Return-after-gap rate (active again 120+ days later) displayed with cohort sizes
- [ ] Clip-library retention viewable once T7400+T7450 land
- [ ] CSV export works; no new stored data beyond T7400's rollup
- [ ] The chart compares whatever the dashboard's Dimension pill selects: campaigns, sign-up cohorts or sign-up builds; changing the pill changes the chart (ruling 2026-11-13)
