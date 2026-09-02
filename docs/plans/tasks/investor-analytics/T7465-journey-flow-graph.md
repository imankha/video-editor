# T7465: Journey Flow graph replaces the admin bar funnel

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-02
**Updated:** 2026-09-02

Design mock (user-approved direction, 2026-09-02): https://claude.ai/code/artifact/9a0ea271-92c6-4813-b05f-003de1cfd335

## Problem

The admin FunnelChart renders each stage as an independent "users who ever did X" count and prints a percentage that divides neighboring bars as if they were the same cohort. They are not, so the chart lies in three ways:

1. **Impossible percentages.** File Selected 9 sits above Upload Attempted 29 (322%), Overlay Exported shows 500%. Steps get skipped, and events instrumented at different times (add_game_opened / upload_file_selected only exist since T7890) cover different populations.
2. **No location for drop-off.** A shrinking bar does not say WHERE users stopped; it says only that fewer users ever did the later thing.
3. **No paths.** Users who purchase without uploading, or clip without exporting, are invisible; the bar order implies a strict pipeline that does not exist.

This also weakens the epic: requirement 2.2 demands "per-stage drop-off localization", and the funnel is the chart an admin actually opens.

## Solution

Replace the bar funnel on AnalyticsDashboard with a **Journey Flow graph** (Sankey-style layered DAG): nodes are funnel stages, ribbon width is the number of users whose next first-touch step after A was B, and gray peel-off ribbons are journeys that end at that node. Every user contributes exactly one path, so counts are conserved by construction: node inflow always equals outflow plus drop, and no percentage can exceed 100.

Computed entirely from existing data (`user_actions.first_at` + `user_segments.acquired_at`). Read-only, zero new Postgres state, zero new events required for v1: this is the same compliance profile as T7420.

## Design

### 1. Node vocabulary

Nineteen FUNNEL_STEPS is too many columns for a legible graph. Two modes, same algorithm, selected by a query param:

- **`steps=compact` (default, 10 nodes):** `signed_up` (synthetic, from `user_segments.acquired_at`), `session_started`, `add_game_opened`, `game_upload_succeeded`, `clip_created`, `annotation_completed`, `export_completed`, `video_downloaded`, `share_completed`, `credit_purchased`.
  Rationale: one node per REAL stage a user experiences; attempt-side events (`game_created`, `upload_file_selected`, `export_started`) and secondary signals (`gallery_viewed`, `framing_opened`, `invite_sent`, `share_viewed`, `framing_exported`, `overlay_exported`) are excluded so ribbons carry meaning. `clip_uploaded` is reserved with no data (T7860) and never appears.
- **`steps=full`:** all FUNNEL_STEPS as nodes, for the deep-dive view (this is where the T7890 picker cliff shows as Add game opened -> dropped vs -> File selected).

Node order = FUNNEL_STEPS order (it is already the canonical sequence). The constant lives in `analytics.py` next to FUNNEL_STEPS as `JOURNEY_COMPACT_STEPS`, with a comment stating the inclusion rule, so future events must opt in deliberately.

### 2. Algorithm (backend)

```
SELECT a.user_id, a.action, MIN(a.first_at) AS first_at
FROM user_actions a
JOIN user_segments s ON s.user_id = a.user_id
[JOIN users u ...]                 -- only when exclude_test needs it (T8110 predicate)
WHERE s.acquired_at BETWEEN %s AND %s
  AND a.action = ANY(%s)           -- the selected node set
  [AND s.origin = %s] [AND <test exclusion>]
GROUP BY a.user_id, a.action
```

Plus the signup population query (same joins/filters, identical to `analytics_funnel`'s first query). Fold in Python:

1. Per user, build the ordered step list: sort by `(first_at, canonical_step_index)`. The index tiebreak handles same-timestamp batches deterministically.
2. Prepend `signed_up`. Emit an edge for each consecutive pair; the final step emits a drop at that node. A user with zero actions emits `signed_up -> dropped`.
3. Aggregate: `edges[(from, to)] += 1`, `drops[node] += 1`, `nodes[step] = distinct users who reached it`.

`MIN(first_at)` collapses the platform dimension of the `(user_id, action, platform)` primary key: a journey is per user, not per platform.

**Conservation invariant (unit-tested):** for every node, inflow == outflow + drop; sum of signed_up outflow + signed_up drop == signed_up count.

### 3. Endpoint

`GET /api/admin/analytics/journey` in `routers/admin.py`.

- Params: `origin`, `from`, `to`, `exclude_test` (all identical semantics to `analytics_funnel`), plus `steps=compact|full`.
- Plain `def` (T8000 threadpool pattern), `_require_admin()`, read-only.
- Response: `{ nodes: [{key, label, count, partial}], edges: [{from, to, users}], drops: [{at, users}], from, to }`.
- Perf: two queries + a Python fold. Worst case today is ~5k users x ~10 actions = 50k rows; the T8110 measurement of the same-shaped aggregate was ~7ms. No caching needed.

### 4. Instrumentation-date honesty (`partial` flag)

Events instrumented recently poison old cohorts: a June signup never fired `add_game_opened` even if they opened Add Game daily. Fix at read time, not write time:

- Add `EVENT_INSTRUMENTED_AT: dict[str, date]` to `analytics.py` for events younger than the analytics system itself (currently: `add_game_opened`, `upload_file_selected` (T7890, 2026-08-28ish: confirm exact deploy dates from git log), `game_upload_succeeded`, `clip_save_attempted` family (T7510)). Events absent from the dict are treated as always-instrumented.
- The endpoint marks a node `partial: true` when the requested signup window starts before that event's instrumentation date. The UI badges those nodes ("data begins YYYY-MM-DD" tooltip) instead of silently drawing thin ribbons.

### 5. Frontend

- New `src/frontend/src/components/admin/JourneyFlowChart.jsx`: hand-rolled SVG sankey, no chart library (the layout is a single-row layered DAG; the mock's renderer is ~80 lines. T3560's note that a graph lib would be the frontend's first still stands: do not add one for this).
  - Ribbon width proportional to users; top-aligned nodes so the main flow rides the top edge and drops peel downward as fading gray ribbons with "N dropped" labels.
  - Skip edges (non-adjacent columns) render at lower opacity.
  - Hover: highlight ribbon + tooltip "A to B: N users". Nodes show label + count above the bar. `partial` nodes get the badge.
  - Colors from the existing admin palette (purple flow gradient, muted gray drops), tabular-nums for counts.
- `AnalyticsDashboard.jsx`: swap the FunnelChart section for JourneyFlowChart, add the compact/full toggle beside the existing origin/date/exclude-test filters (which all pass through to the new endpoint). Keep `FunnelChart.jsx` on disk but unreferenced from the dashboard until staging sign-off, then delete it in this same task once the user confirms (it is also imported by UserTable step-style helpers: verify before deleting; only the dashboard usage is replaced).

### 6. Extra tracking needed

Audited every compact node against FLOW_EVENTS: **v1 requires NO new events.** All ten nodes are live server-side milestones landing in `user_actions` with `first_at`. The audit did surface real coverage gaps that change what the graph can say; they belong to their own tasks:

| Gap | What the graph loses without it | Where it lives |
|---|---|---|
| `annotate_opened` does not exist: nothing fires between upload success and clip_created | Uploaded -> dropped cannot distinguish "never entered Annotate" from "entered and bailed" | Already spec'd in **T7455**: coordinate, do not duplicate. Once it ships, add it to JOURNEY_COMPACT_STEPS + EVENT_INSTRUMENTED_AT |
| `framing_opened`/`overlay_opened` fire once-ever via the quest achievement bridge with empty context | First-touch semantics still correct for THIS graph (it only needs first_at), so not a blocker; the full-mode Edited nodes just undercount pre-bridge users | **T7455** fixes the emission path; no action here |
| No repeat-transition data in any shared store: `user_actions` is first_at + lifetime count, per-event rows exist only in per-user `user_action_log` (epic directive 3 forbids centralizing them) | v1 shows FIRST journeys only, not loops (re-exports, second games) | v2, deferred: extend **T7400's** rollup sweep with an aggregate `rollup_transition (from_action, to_action, cohort_week, users)` table in analytics.sqlite: aggregates only, raw events never leave the per-user DBs, fully inside epic directives. File only if the first-touch view proves insufficient |
| "Dropped" cannot distinguish "gone for good" from "still visiting, stuck" | Drop ribbons overstate churn for recent signups | v2 nicety, no new tracking: `user_usage_daily` (the v022 retention spine) already answers "active in last 14d"; a follow-up can two-tone the drop ribbons (stalled vs gone) |

The v1 chart is labeled "First journeys" in the UI so the first-touch semantics are explicit, not discovered.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - add JOURNEY_COMPACT_STEPS + EVENT_INSTRUMENTED_AT constants
- `src/backend/app/routers/admin.py` - new /analytics/journey endpoint (mirror analytics_funnel's filter plumbing)
- `src/backend/tests/test_analytics_dashboards.py` - endpoint tests incl. conservation invariant, tiebreak, filters, partial flag
- `src/frontend/src/components/admin/JourneyFlowChart.jsx` - new SVG sankey component
- `src/frontend/src/components/admin/JourneyFlowChart.test.jsx` - new
- `src/frontend/src/components/admin/AnalyticsDashboard.jsx` - swap funnel section, add steps toggle
- `src/frontend/src/components/admin/FunnelChart.jsx` - removed from dashboard (deleted after staging sign-off; check UserTable coupling first)

### Related Tasks
- Parent epic: [EPIC.md](EPIC.md) (binding directives: in-house, aggregates only, no new PG state - this task is pure-read and complies)
- Complements T7420 (activation report computes the same first_at ladder as numbers; this task draws it as paths)
- Coordinate with T7455 (annotate_opened + per-open editor events feed future node quality)
- v2 transition rollup would extend T7400's sweep
- T8230 (admin exports split) touches the same dashboard area: file-disjoint except AnalyticsDashboard.jsx; sequence, do not parallelize in one wave

### Technical Notes
- No schema change on any track: no Migration agent. New action strings and read-only queries only.
- Tier: M (2 layers, ~7 files, no new abstractions). Reviewer: yes. Architect: no (this file IS the design; user approved the mock 2026-09-02).
- Knowledge doc: backend-services.md (request concurrency, admin router patterns).
- The mock artifact contains the visual spec (ribbon geometry, drop styling, callout treatment).

## Implementation

### Steps
1. [ ] Backend: constants (JOURNEY_COMPACT_STEPS, EVENT_INSTRUMENTED_AT with dates confirmed from git log of T7890/T7510 deploys)
2. [ ] Backend: /analytics/journey endpoint + fold; tests (conservation, tiebreak determinism, zero-action users, origin/date/exclude_test filters, compact vs full, partial flag)
3. [ ] Frontend: JourneyFlowChart.jsx (SVG sankey per mock) + tests (renders edges/drops from fixture, conservation of widths, partial badge)
4. [ ] Frontend: AnalyticsDashboard swap + steps toggle wired to existing filter row
5. [ ] E2E sanity: admin loads dashboard, journey renders with dev data
6. [ ] After staging sign-off: delete FunnelChart.jsx dashboard usage remnants (verify UserTable step-style coupling first)

### Progress Log

**2026-09-02**: Filed from the user's reaction to the misleading funnel (322%/500% rows). Direction approved via mock artifact. Design written; no code yet.

## Acceptance Criteria

- [ ] Journey graph renders on the admin dashboard honoring origin, date window, and exclude-test filters
- [ ] Every node satisfies inflow == outflow + drop (unit-tested; visually: no ribbon appears from nowhere)
- [ ] No percentage anywhere can exceed 100; drop-off is localized per node with exact user counts
- [ ] Late-instrumented nodes are badged partial when the window predates their instrumentation
- [ ] Compact and full step modes both work; compact is default
- [ ] First-journey semantics labeled in the UI
- [ ] No new Postgres tables/columns, no new events, no migration (grep-provable)
- [ ] Backend + frontend targeted tests pass; Branch CI green
