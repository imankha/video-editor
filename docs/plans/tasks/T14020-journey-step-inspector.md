# T14020: Journey step inspector (why users stop at a stage)

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-10-30
**Updated:** 2026-10-30

Design (approved 2026-10-30): [admin-journey-dropoff-design-2026-10-30.md](../admin-journey-dropoff-design-2026-10-30.md), Sections 4 (Step Inspector), 5.4 to 5.6, 6.1. Mock: https://claude.ai/artifact/JJfPADKV5QJQ7XtboxmR4V (click any node).

## Problem

The map (T14010) says where users stop. It does not say which parents, on which devices, after how long, what they did instead, or what failed. Those signals already exist in Postgres (`user_actions` failure reasons `event:reason`, `dialog_impression:*` and `toast_impression:*`, tutorial events, paywall events) and in the per-user log (`session_exit` rows written by T7515, read by nothing).

## Solution

Clicking a stage on the map opens an inspector panel for that stage with: counts (reached, continued, stuck, gone, in window), time to the next stage (median, p75, buckets `<1h`, `same day`, `2-3d`, `4-14d`, `>14d`, out-of-order count), breakdown tabs (platform, origin or campaign, signup build, signup month) sorted by loss with the Wilson 95% lower bound, "what they did instead" (side-action lift among dropped vs continued, after reaching the stage, labelled correlation), why signals (failure reasons grouped by base event and reason, impressions, retry bursts), and a People list that opens the existing `UserDetailPanel`. That panel also gains rendering of the per-user `session_exit` trail (last screen, dwell per screen, screen trail), which costs nothing because the rows already exist.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` - `GET /analytics/journey/step/{stage}?...&by=platform|origin|build|cohort_month` -> `{stage, counts, next, breakdown, instead, why, people}`; extend `GET /analytics/user/{id}` with the `session_exit` rows (per-user SQLite, read-only)
- `src/backend/app/services/analytics_journey.py` - timing, lift, Wilson, breakdown folds (pure functions, unit-tested)
- `src/backend/app/analytics.py` - `RETRY_BURST_ACTIONS`, `MILESTONE_REASONS`, `IMPRESSION_KINDS` are the inputs; no new events
- `src/backend/tests/test_analytics_journey.py` - timing buckets, negative deltas counted not clamped, lift thresholds (n >= 5 both sides), Wilson bound, breakdown sort
- `src/frontend/src/components/admin/StepInspector.jsx` (NEW), `JourneyTab.jsx` (selection wiring), `UserDetailPanel.jsx` (session-exit trail section), `stores/adminStore.js`

### Related Tasks
- Depends on: T14010
- Blocks: T14030 ("Where they left" panel slot is reserved in the inspector, rendered ghosted until T14030)
- Related: T13990 (dimension pills reuse), T14000 (build dimension)

### Technical Notes
- Lift: among users who reached S and are judged, for side action A with `first_at(A) >= first_at(S)`: `lift = p_dropped / p_continued`; shown only when both groups have >= 5 users with A; sorted by lift; panel labelled "correlation, not cause".
- Timing deltas are `first_at(T) - first_at(S)` for users who continued; negative deltas are reported as "out of order: n".
- Breakdown rows show `k / n` when judged < 20, and the Wilson lower bound beside every rate.
- Clicking a drop ribbon on the map opens the inspector with the matching outcome (stuck or gone) pre-selected in People.
- The inspector re-queries only itself when a breakdown tab changes; the map does not redraw.
- Candidate side actions: tutorial watched events, `paywall_shown`, `buy_modal_opened`, `*_failed:*`, `dialog_impression:*`, `toast_impression:*`, `overlay_offered|deferred|declined`, `framing_point_added`, `draft_saved`, `preview_started`, `speed_segment_created`.
- Zero new Postgres state; the per-user `session_exit` read follows the existing per-user action-log read path in `GET /analytics/user/{id}/actions`.

## Implementation

### Steps
1. [ ] Failing tests for timing, lift, Wilson, breakdown sort, small-N
2. [ ] Fold functions + `/analytics/journey/step/{stage}` endpoint
3. [ ] `StepInspector.jsx` with the five sections and the ghosted "Where they left" slot
4. [ ] Map wiring: node click and ribbon click select the stage and outcome
5. [ ] `session_exit` trail in `GET /analytics/user/{id}` and `UserDetailPanel.jsx`
6. [ ] Update `backend-services.md`

### Progress Log

**2026-10-30**: Filed from the approved design.

## Acceptance Criteria

- [ ] Clicking a node opens the inspector with counts that equal the map's counts for that node
- [ ] Time-to-next shows median, p75 and the five buckets; an out-of-order count appears when any delta is negative
- [ ] Breakdown tabs (platform, origin, build, signup month) sort by loss and show the Wilson lower bound; `k / n` below 20 judged
- [ ] "What they did instead" lists side actions with lift, hides rows with fewer than 5 users on either side, and carries the correlation label
- [ ] Why signals show failure reasons grouped by base event and reason, impressions, and retry bursts for users who stopped at the stage
- [ ] People list opens the existing user detail panel; that panel shows the session-exit trail (last screen, dwell, trail) for users who have it
- [ ] Clicking a stuck or gone ribbon pre-filters People to that outcome
- [ ] No new Postgres table or column, no migration file in the diff
- [ ] Relevant backend and frontend tests pass; Branch CI green
