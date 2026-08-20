# T7420: Activation & funnel drop-off report

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-08-20

## Problem

Requirement 2.2: "a clear majority of new sign-ups reach a first shared reel within their first two weeks, and we know exactly where the drop-offs are." The data to compute this already exists (`user_actions.first_at` per action + `user_segments.acquired_at`) but nothing computes or displays it. The existing `/analytics/funnel` shows lifetime ever-did-X percentages; the cohorts view adds "% ever did X" per signup cohort — neither answers "activated within 14 days" nor "where exactly do non-activated users stall".

## Solution

A backend report endpoint + admin panel section computing, per monthly signup cohort, activation rate and stage-by-stage drop-off — **reads existing Postgres only, zero new storage of any kind**.

Metric definitions are locked in [EPIC.md](EPIC.md): activation = `share_completed` within 14 days of `acquired_at`; secondary aha metric = `export_completed` within 7 days.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — `GET /api/admin/analytics/activation` (new, next to `/analytics/cohorts` at :1078)
- `src/frontend/src/stores/adminStore.js` — fetch action
- `src/frontend/src/components/admin/ActivationReport.jsx` (NEW), wired into `AnalyticsDashboard.jsx`
- `src/backend/app/analytics.py` — reference only (`FUNNEL_STEPS`)

### Related Tasks
- Depends on: nothing in this epic (pure read of existing data) — can go first
- Related: T7430 renders retention for the same cohort keys; keep cohort-key derivation (`date_trunc` on `acquired_at`) IDENTICAL in both endpoints

### Report contents
Stage ladder (subset of `FUNNEL_STEPS`, the requirement's own list): `game_created` (upload) → `clip_created` (tagged play) → `export_completed` (exported reel) → `share_completed` (shared reel).

Per monthly cohort:
1. **Activation rate**: % with `share_completed.first_at - acquired_at <= 14d`; same for the 7d-export secondary. Cohorts younger than 14d labeled "maturing", never blended in.
2. **Stage conversion**: % reaching each stage EVER + % within 14d, and median days between consecutive stages (percentile_cont over first_at deltas — same technique as the existing `median_days_to_export` query at admin.py:1125).
3. **Stall distribution**: for non-activated users, their FURTHEST reached stage — this is the "where are the drop-offs" number (upload friction vs tagging effort vs export vs sharing).
4. Benchmark annotations served with the data (30% median / 50% great — from EPIC.md) so the UI prints them beside actuals.

### Technical Notes
- `first_at` is per (user, action, platform) — take MIN(first_at) across platforms per user/action.
- Exclude admin/test accounts the same way existing admin analytics do (check how `/analytics/funnel` filters; reuse, don't invent a second exclusion list).
- CSV export of the table (the epic's on-demand bar) — a plain `?format=csv` branch is enough, no new library.

## Implementation

### Steps
1. [ ] Endpoint with the four report blocks (one PG round-trip per block max; it's admin-only, keep queries readable over clever)
2. [ ] `ActivationReport.jsx`: cohort table + stall-distribution bar + benchmark captions
3. [ ] CSV branch
4. [ ] Tests: activation window edges (day 13/14/15), maturing-cohort exclusion, min-across-platforms, stall bucketing

## Acceptance Criteria

- [ ] Admin panel answers, on demand: "what % of June sign-ups shared a reel within 14 days, and where did the rest stop?"
- [ ] Maturing cohorts visibly labeled, not averaged in
- [ ] CSV export works
- [ ] No new stored data anywhere (pure read)
