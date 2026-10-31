# T14010: Journey map replaces the admin Funnel tab

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-10-30
**Updated:** 2026-10-30

Design (approved 2026-10-30): [admin-journey-dropoff-design-2026-10-30.md](../admin-journey-dropoff-design-2026-10-30.md), Sections 4 to 7. Decision artifact with the interactive mock: https://claude.ai/artifact/JJfPADKV5QJQ7XtboxmR4V. Supersedes [T7465](investor-analytics/T7465-journey-flow-graph.md); its approved Sankey direction stands.

## Problem

The admin Funnel tab (`FunnelChart.jsx`) draws 24 independent "users who ever did X" bars and divides neighbours as if they were one cohort, so it prints impossible percentages, cannot say where a user stopped, and cannot tell a parent who is still visiting from one who left. See the design doc Section 1.

## Solution

Phase 1 of the design: a Journey tab with a 14-stage intent ladder (three bands: Get footage in, Make the highlight, Take it away), a Sankey map where every user sits at exactly one furthest stage, and each stage's drop split three ways with an explicit conversion window and inactivity threshold: in window (pending, not judged), stuck (past the window and active in the last I days), gone. A loss ranking strip sorts stages by absolute users lost. Pure read of existing Postgres; no new events, no new state, no migration.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - add `JOURNEY_LADDER` (14 stages, actions per stage, band), `EVENT_INSTRUMENTED_AT` (dates from git history of each event's first emitter), next to `FUNNEL_STEPS`
- `src/backend/app/services/analytics_journey.py` (NEW) - pure fold functions: classify users, build nodes/edges/drops, conservation assertions
- `src/backend/app/routers/admin.py` - `GET /analytics/journey?from&to&origin&build&platform&exclude_test&window_days=14&inactive_days=14&steps=compact|full` (plain `def`, threadpool, T8000 pattern; reuse `_test_exclusion()` and the `build=` filter from T14000)
- `src/backend/tests/test_analytics_journey.py` (NEW)
- `src/frontend/src/components/admin/JourneyTab.jsx`, `JourneyFlowChart.jsx` (NEW, hand-rolled SVG, no chart library), `AnalyticsDashboard.jsx` (SUB_TABS: replace `funnel` with `journey`), `stores/adminStore.js`
- `src/frontend/src/components/admin/FunnelChart.jsx` - removed from the dashboard after staging sign-off; `UserTable.jsx`'s FunnelSummary strip keeps its own keys (T11010 label-key trap)

### Related Tasks
- Supersedes: T7465 (PLAN.md row marked SUPERSEDED, pointer to the design doc)
- Shrinks: T7420 (keeps activation rate + benchmarks + CSV only)
- Uses: T14000 `signup_build` filter; T13990 dimension pills pattern
- Blocks: T14020 (step inspector), T14030 (rollup)
- Future node: T7455 `annotate_opened` becomes a stage between Footage landed and Clipped when it ships

### Technical Notes
- Ladder, classification, edge, timing and honesty rules are locked in design doc Section 5. Edges follow ladder order (ordered-funnel semantics); skips drawn fainter. "Finish Now" (overlay_exported without overlay_opened) is a skip edge from Exported to Finished highlight, never a drop.
- `first_at(signed_up)` = `user_segments.acquired_at`; `last_active_at` = `user_segments.last_active_at`; `MIN(first_at)` across platforms per (user, action).
- Pre-aggregate in SQL with a per-user stage bitmask (`bit_or(1 << rank)` via a CASE generated from `JOURNEY_LADDER`, same technique as `_build_last_step_rank`) plus `MIN(first_at) FILTER` per stage, grouped by (bitmask, outcome bucket, platform, origin, signup_build, signup_month); Python folds pattern rows, not users. Measure on staging before considering the per-user fold.
- Conservation is unit-tested: reached = continued + in_window + stuck + gone at every node; reached(S) = sum of inflow edges.
- Percentages only when judged >= 20, otherwise `k / n`. Nodes whose first action is younger than the window start are badged partial with the date. Client-beacon stages (`export_pressed`, `watched`) carry a "client beacon" note.
- Zero Postgres state, zero new events, no migration on any track (grep-provable). Knowledge doc: `backend-services.md`.

## Implementation

### Steps
1. [ ] `JOURNEY_LADDER` + `EVENT_INSTRUMENTED_AT` constants with the inclusion-rule comment
2. [ ] Failing tests: conservation, classification at the W and I boundaries, skip edges, Finish Now skip, small-N suppression, partial flags, filters
3. [ ] `analytics_journey.py` fold + SQL bitmask query; endpoint
4. [ ] `JourneyFlowChart.jsx` (bands, two-tone drops, hatched in-window, skip edges, partial badges), `JourneyTab.jsx` (filters incl. window and inactivity controls, loss ranking strip, compact/full toggle)
5. [ ] Replace the Funnel sub-tab; keep `FunnelChart.jsx` until staging sign-off, then delete (grep `src/`, `e2e/`, `scripts/` for callers first)
6. [ ] Update `backend-services.md`

### Progress Log

**2026-10-30**: Filed from the approved design.

## Acceptance Criteria

- [ ] Journey tab shows 14 nodes in three bands; every node's counts conserve (reached = continued + in window + stuck + gone), verified by a backend unit test and by a frontend render test
- [ ] Each drop ribbon is labelled with its count and kind; colour is never the only encoding
- [ ] Conversion window and inactivity threshold are visible controls (default 14 d / 14 d) and change the stuck/gone split without a page reload
- [ ] Loss ranking strip orders stages by stuck + gone and shows "still visiting" beside the total
- [ ] Filters: signup date range, origin, build, platform, exclude test; applied together with the map
- [ ] Late-instrumented stages are badged "data from YYYY-MM-DD" when the window starts before that date; client-beacon stages carry the note
- [ ] A stage with no instrumented data in the window renders "no data", never 0
- [ ] No percentage renders when judged < 20
- [ ] No new Postgres table or column, no migration file in the diff
- [ ] Relevant backend and frontend tests pass; Branch CI green
