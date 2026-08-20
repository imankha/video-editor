# T7430: Retention curves & triangle, seasonality-adjusted

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-08-20

## Problem

Requirement 2.3: "Report retention in cohorts (30/60/90-day), adjusted for sport seasonality... The investor-grade outcome is a retention curve that visibly flattens." Today `/analytics/cohorts` (admin.py:1078) shows per-cohort "% ever did X" and a single return-after-7d flag — no triangle, no curve over time, no unbounded variant, no seasonality handling. This is THE chart investors ask for on demand ("show me your cohort retention"); per the epic's requirement 2.1, if we can't produce it nothing else counts.

## Solution

A retention endpoint + admin view built on the **existing** per-user activity spine — PG `user_usage_daily` (user_id, day, seconds), live since v022 — plus T7400's `rollup_action_weekly` for action-level (e.g. clip-library) retention. Zero new stored data beyond T7400's rollup.

Definitions locked in [EPIC.md](EPIC.md): active day = usage_daily row with seconds > 0; weekly bins; classic AND unbounded retention; season-cohorts; WAU/MAU not DAU/MAU.

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
3. **Seasonality**: (a) season-cohort grouping — cohorts bucketed by join season (US youth soccer defaults: Fall = Aug-Nov, Spring = Feb-May; make the boundaries a named constant, they will be tuned); (b) **season-over-season return rate** — % of users active in season S also active in season S+1 — the long-horizon headline; (c) off-season weeks shaded on charts, not dropped. YoY comparisons preferred wherever a MoM would mislead.
4. **WAU + WAU/MAU** time series (from `user_usage_daily` day rows), plus the **week-over-week return rate** (% of week N's actives also active in week N+1 — success criterion 4's in-season 50% bar; expose it as a service function T7460 can reuse) and **D30-of-activated retention** (% of activation-cohort users active >= 30d after signup — criterion 4's 30% bar).
5. **Action-level toggle** (from `rollup_action_weekly`): retention on `export_completed` (north-star habit) and on clip-library/collections usage (T7450's events) — the "structural retention asset" evidence for requirement 2.3.
6. CSV export per view.

### Technical Notes
- `user_usage_daily` history starts at v022's deploy — charts must show the coverage start honestly (a "data begins" marker), never render pre-coverage weeks as zero retention.
- Small-N honesty: cells with cohort size < 5 render the raw fraction (e.g. 2/4), not a misleading %.
- Compute in SQL where natural (generate_series over weeks joined to usage days), but readable-over-clever; admin-only path.
- Frontend charts: follow the dataviz skill when building; no new chart library without checking what admin components already use (FunnelChart.jsx precedent).

## Implementation

### Steps
1. [ ] Retention endpoint: triangle + curves data (classic/unbounded, weekly/monthly, season grouping, WAU series)
2. [ ] Action-level branch reading rollup_action_weekly (graceful "run rollup first" state when stale/absent)
3. [ ] `RetentionView.jsx`: triangle grid, curve overlay, WAU strip, season toggle, coverage-start + off-season shading
4. [ ] CSV branches
5. [ ] Tests: classic vs unbounded math on fixtures (incl. a lapsed-and-returned user), season bucketing edges, small-N rendering, coverage-start masking

## Acceptance Criteria

- [ ] Triangle + curves render on demand from live data; unbounded/classic and weekly/monthly toggles work
- [ ] A dormant-off-season user does NOT read as churned in the unbounded view; off-season is visibly shaded
- [ ] Season-over-season return rate displayed with cohort sizes
- [ ] Clip-library retention viewable once T7400+T7450 land
- [ ] CSV export works; no new stored data beyond T7400's rollup
