# T14960: "Visited" head node on the Journey map (aggregate, from the visit beacon)

**Status:** WIP
**Impact:** 7
**Complexity:** 3
**Tier:** M (backend read + frontend node; no schema change beyond T7410's own table)
**Created:** 2026-11-03
**Updated:** 2026-11-03

User question 2026-11-03: "with task T7410 do we add a visited stage to the user journey?"
Answer: yes, as an aggregate head node, not a per-user stage.

## Problem

The Journey map starts at "Signed up". The stage before it, the landing visit, is the one number the
ad-spend model could not get (visit-to-sign-up), and it is gate 1 of the spend-readiness panel
(T14910). T7410 will count visits, but by design it is anonymous: cookie-free, no user ids, only
`(day, source, page_class) -> count` rows in analytics.sqlite. Those counts cannot be folded into the
per-user ladder, where every user sits at exactly one furthest stage.

## Solution

Add a **Visited** node to the left of "Signed up", drawn as an aggregate band:

- Value: sum of `visit_daily.count` for `page_class = 'landing'` (and `app` pre-auth) over the
  selected date window, filtered by the same origin / source bucket the map is filtered by (the
  beacon's buckets mirror `_determine_origin`, so the pills line up).
- Edge "Visited -> Signed up": sign-ups in the window divided by visits in the window, printed as a
  ratio of two counts with both counts visible ("169 of about 3,400 visits, 5.0%"). Badged
  "aggregate, anonymous: visits are counts, not people", and excluded from the conservation check
  (`check_conservation` must skip the head node; it is not part of the per-user fold).
- Coverage: visits start on T7410's deploy date; before that the node shows "not instrumented"
  (the `EVENT_INSTRUMENTED_AT` mechanism), never zero.
- Step inspector for the node: visits by source bucket and by page class for the window; no people
  tab (there are none).
- T14910 gate 1 (visit -> sign-up) reads the same ratio from the same function, so the map and the
  gates never disagree.
- Per-sport split (T14930's arrival sport): the beacon's `page_class` must carry the landing sport
  for sport pages (`landing:<sport key>` as an extension of T7410's enum, not a new column) so the
  Visited node can be filtered by the Sport pill. Record this as a T7410 requirement; if T7410 has
  shipped without it, this task extends the enum.
- RAG (T14900): target 5% green, 2 to 5% yellow, under 2% red, grey when visits in the window are
  under 200.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_store.py` - `visit_daily` read (T7410)
- `src/backend/app/services/analytics_journey.py` - head node assembly, conservation skip, coverage
- `src/backend/app/routers/admin.py` - journey payload gains `head` node; step inspector for it
- `src/frontend/src/components/admin/JourneyFlowChart.jsx`, `StepInspector.jsx`, `journeyFold.js`
- Tests: ratio with both counts, not-instrumented window, conservation skip, sport filter pass-through

### Related Tasks
- Blocked by: T7410 (beacon and `visit_daily`); T7400 (store module).
- Feeds: T14910 gate 1, T14900 colouring, T14920 (biggest leak can be the visit step).
- Related: T14930 (arrival sport pill), T7440 (visit -> sign-up by source).

### Technical Notes
- Read only. Visits never join to users; the node is a count beside a per-user ladder and the UI
  says so.
- No new Postgres state; `visit_daily` lives in analytics.sqlite per T7410.
- Keep the head node out of `fold_journey` and `loss_ranking`'s per-user math; add it as a separate
  `head` object in the payload so existing tests on the ladder stay untouched.

## Implementation

### Steps
1. [ ] Add `landing:<sport>` to T7410's page_class list (coordinate; one-line change if T7410 is open).
2. [ ] Failing tests: head node ratio, both counts present, not-instrumented, conservation unaffected.
3. [ ] Backend head node + inspector; frontend node, badge, legend entry.
4. [ ] Wire T14910 gate 1 to the shared function.

### Progress Log

**2026-11-03**: Filed in answer to the owner's question; depends on T7410.

## Acceptance Criteria

- [ ] Visited node shows visits and the visit -> sign-up ratio with both counts, badged aggregate.
- [ ] Before the beacon's first day the node reads "not instrumented", never 0%.
- [ ] Conservation and loss ranking are unchanged; the head node is separate in the payload.
- [ ] The `sport` parameter on the journey and Visited step endpoints narrows the node to `landing:<sport>` visits. The Sport pill itself is T14930's (group g-t14930-3, 2026-11-08 re-scope: the two tasks were put in separate groups); it passes this parameter once both land.
