# T3560: User Attribution Graph

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

We collect everything needed to understand how users originated — invite/share referrals (who brought whom) and acquisition origin (ad campaigns / organic) — but it's only visible as flat tables (referral leaderboard, channels table, cohort grid). There is no single picture that answers: *"Where did all our users come from, and who pulled in whom?"* We want the most visual way to understand user origination: a total attribution graph.

## Solution

A new admin view: an **attribution graph** (node-link / tree), on its **own separate page**, linked from the main analytics page — not a tab rendered inline. The graph is expected to be intensive (large node-link payload + a graph rendering library), so it must **only load when explicitly requested** and must not add to the main analytics page's load time.

- **Nodes:** users. **Root nodes:** acquisition origins (ad campaigns, organic, each distinct `origin` value) — the entry points where users originated.
- **Edges:** "invited / brought in" relationships (`referrals.referrer_id -> referred_id`), so viral chains render as trees descending from each root.
- **Encoding:** color/group nodes by origin so an entire viral subtree inherits and shows its campaign of origin (origin already propagates through chains via `_determine_origin`). Size or badge nodes by something meaningful (e.g., revenue `total_spent_cents` or downstream invitees) — decide during design.
- Users with no referrer attach directly to their origin root → the campaign that acquired them.

End state: open the view and see, at a glance, which campaigns seeded the most viral growth and how users branch out from each.

## Context

See [EPIC.md](EPIC.md) for shared data sources and admin surfaces.

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — add a graph endpoint (e.g. `GET /api/admin/analytics/attribution-graph`). Reuse the recursive referral logic already present at the referral tree endpoint (`/api/admin/referrals/tree/{user_id}`, ~line 1010) but build the **whole** graph, not one user's subtree.
- `src/backend/app/services/pg.py` — sources: `referrals` (line 164: `referrer_id`, `referred_id`, `channel`), `user_segments` (line 175: `user_id`, `origin`, `referrer_id`, `total_spent_cents`, `utm_*`).
- `src/backend/app/analytics.py` — `_determine_origin()` (line 144) for how origin/campaign strings are normalized (invite code -> referrer's origin, utm_campaign, share-based, click_source, else `organic`).
- `src/frontend/src/stores/adminStore.js` — add `fetchAttributionGraph()`.
- `src/frontend/src/components/admin/` — new component (e.g. `AttributionGraph.jsx`) rendered on its **own separate page/route**, NOT a tab inside `AnalyticsDashboard.jsx`. The main analytics page only gets a **link** to it.
- **Routing / lazy-load:** the graph page must be code-split so the graph library and the component bundle download only when the user navigates to it. Use `React.lazy()` + `Suspense` (or the project's existing route-level lazy pattern — match how other routes/screens are loaded). The graph data fetch fires on the graph page mount only — never from the main analytics page.
- `src/frontend/package.json` — **no graph/charting library is installed today** (existing charts are hand-rolled CSS bars). This task must add one. Candidates: a force-directed/network lib (e.g. react-force-graph / vis-network / cytoscape) or a hierarchical d3 layout. Pick the lightest option that handles node-link with grouping; confirm choice during design (Architecture stage). Because it's lazy-loaded behind a route, its size won't affect the main analytics/admin bundle.

### Related Tasks
- Part of the [Analytics: Attribution & Access Visibility](EPIC.md) epic (sibling: T3550).
- Builds directly on T2910 (`referrals` table + tree query), T3450 (`user_segments` origin + referrer_id, origin propagation), T3455 (campaign URL -> normalized origin), T3490 (channels-with-revenue view).

### Technical Notes
- **One graph payload:** endpoint returns `{ nodes: [...], edges: [...] }`. Nodes include user nodes (id, label, origin, revenue, signup date) and synthetic origin/campaign root nodes (one per distinct `origin`). Edges = referral links + (user -> origin-root) for users with no referrer.
- **Separate page, lazy-loaded:** the graph is intensive (potentially large payload + a graph rendering library). It lives on its own route, code-split so neither the data fetch nor the viz library loads until the user clicks through from the main analytics page. The main analytics page must not regress in load time because of this feature.
- **Scale:** fine for current user count; node-link graphs get unreadable past a few hundred nodes. Add filters (by origin, date range — reuse the segment filter params already in `adminStore`) and consider collapsing/aggregating large campaign roots. `log()` / note any cap so we don't silently hide users.
- **Don't double-count origin:** a referred user's origin already inherits the referrer's campaign — render them under their referrer, not also under the campaign root, to avoid two parents. Decide tree (single parent) vs graph (multi-edge) in design; tree is more legible.
- Admin-only; gate behind existing admin auth like other `/api/admin/*` endpoints.

## Implementation

### Steps
1. [ ] Architecture/design: choose tree vs force graph, pick the viz library, define the node/edge payload shape, and the separate route + lazy-load approach. **Requires approval (new dependency + new view).**
2. [ ] Backend: `attribution-graph` endpoint assembling nodes (users + origin roots) and edges (referrals + user->origin), with origin/date filters.
3. [ ] Frontend: `fetchAttributionGraph()` in `adminStore.js` (called only from the graph page).
4. [ ] Frontend: add a route for the graph page + `AttributionGraph.jsx`, code-split via `React.lazy()`/`Suspense` so the viz library loads only on navigation. Add a link to it from the main analytics page (`AnalyticsDashboard.jsx`).
5. [ ] Tests: backend test for graph assembly (referral edges + origin-root attachment + revoked/edge cases); light frontend render test. Verify the graph bundle is NOT in the main admin/analytics chunk (build output / lazy chunk present).

### Progress Log

_(none yet)_

## Acceptance Criteria

- [ ] Attribution graph lives on its own page/route, reached via a link from the main analytics page
- [ ] Graph library + data load only on navigating to the graph page (code-split) — main analytics page load time does not regress
- [ ] Admin attribution graph view renders users as nodes and invited-by relationships as edges
- [ ] Ad campaigns / origins appear as root nodes; non-referred users attach to their origin
- [ ] Nodes grouped/colored by origin so viral subtrees show their campaign of origin
- [ ] Filterable by origin and date range
- [ ] Built entirely from `referrals` + `user_segments` (no new tracking)
- [ ] Tests pass
