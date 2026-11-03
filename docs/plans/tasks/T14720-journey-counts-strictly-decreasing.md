# T14720: Journey stage counts must never go up from one stage to the next

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Tier:** M
**Created:** 2026-11-03
**Updated:** 2026-11-03

User request 2026-11-03: "the numbers throughout the funnel should be strictly reducing."

## Problem

The admin Journey map can show a stage with **more** users than the stage before it. In the prod
screenshot from 2026-11-03: Moved framing window 77, Pressed Export **0**, Exported 28. After
T14710 fixes the missing event, counts will still go up whenever users skip a stage. Example: a
user whose clip was made by an upload (`clip_uploaded`) and never opened Add footage has
**Clipped** but not **Add footage**.

Why: a stage's count today is "users who have any of this stage's own actions"
(`fold_journey` in `src/backend/app/services/analytics_journey.py`: `for r in ranks:
reached[r] += n`, where `ranks` are only the bits set in the user's mask). A user who skipped a
stage is not counted at that stage, and a dashed "skip" ribbon jumps over it. That was the
original design (design doc Section 5.1: "an edge goes from a stage to the next stage the user
reached"), and the user has now overruled it.

## Solution

**New rule: reaching a stage means reaching every stage before it.** A user's furthest stage
stays exactly as today (the highest ladder stage they have an action for). The user now counts as
"reached" at every stage from 0 up to that furthest stage. So:

- `reached(stage N) >= reached(stage N+1)` always holds (non-increasing; equal is allowed when
  nobody stopped at N).
- Every user still drops at exactly one place (their furthest stage), so the in window / stuck /
  gone split and the loss ranking do not change.
- Edges only go between neighbours (N to N+1). Skip ribbons disappear.

Change the backend fold and the step inspector so they agree, then remove the skip rendering
from the chart.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/analytics_journey.py`
  - `fold_journey`: count the user at `range(0, furthest + 1)` instead of only their mask bits; build edges from consecutive pairs of that range
  - `check_conservation`: the inflow rule stays true; confirm it still passes
  - `classify_user`: `reached` becomes `list(range(furthest + 1))`
  - `step_counts`, `fetch_step_users` (its `WHERE fa_{s_rank} IS NOT NULL` must become "furthest >= s_rank", or the inspector misses users who skipped this stage), `time_to_next`, `_judged_groups`
- `src/frontend/src/components/admin/journeyFold.js` - the header comment describes skip ribbons; update it. `collapseJourney` should keep working (edges are a subset of what it already handles)
- `src/frontend/src/components/admin/JourneyFlowChart.jsx` - dashed skip-ribbon rendering (`edge.skip`); remove it, or leave it unused if that is simpler
- `src/frontend/src/components/admin/JourneyTab.jsx` - footer text "Dashed ribbons skip stages." must go
- `src/backend/app/analytics.py` - `JOURNEY_LADDER` header comment ("never by timestamp"); update the wording to the new rule
- `src/backend/tests/test_analytics_journey.py`, `src/backend/tests/test_analytics_journey_endpoint.py`, `src/frontend/src/components/admin/journeyFold.test.js`, `src/frontend/src/components/admin/JourneyTab.test.jsx`
- Design doc: `docs/plans/admin-journey-dropoff-design-2026-10-30.md` Section 5.1. Add a dated note that the 2026-11-03 user ruling replaced skip edges with implied reach

### Related Tasks
- Related: T14710 (makes Pressed Export real). Without it this task makes Pressed Export equal to Exported's count plus 0 drops, which is correct under the new rule but hides the missing event. Land T14710 first if you can.
- Blocks nothing; T14740 reads the same "stopped at stage" rule, so do this one first to avoid rework.

### Technical Notes
- **Timing for implied stages.** Some code reads `first_at` of a stage (for example `time_to_next`
  in the inspector). For a stage the user skipped, there is no timestamp. Do not invent one. Skip
  those users in the timing math and say so in the inspector, e.g. "n of m users have a timestamp
  for this stage". The coding standards forbid silent fallbacks (CLAUDE.md, "No silent fallbacks").
- The SQL side (`build_patterns_sql`) does not need to change: it already returns the mask and the
  furthest stage's outcome. Only the Python fold changes. Keep it that way: less risk.
- The money strip (`JOURNEY_MONEY_LADDER`) uses the same fold. Apply the same rule there, so
  Hit paywall >= Opened buy >= Purchased.
- The "side-action lift" in the inspector compares users who continued vs dropped; it already uses
  the furthest stage, so it should not change, but check its test still passes.

## Implementation

### Steps
1. [ ] Write failing tests first. Backend: a pattern where a user has stages {0, 4} (skipped 1-3) must count them at stages 0, 1, 2, 3 and 4, with only consecutive edges, and every node's `reached` must be >= the next node's. Inspector: `build_step` for a skipped stage must include that user
2. [ ] Change `fold_journey` and `classify_user`, then the inspector query
3. [ ] Remove skip ribbons from the chart and the footer text; update the frontend tests
4. [ ] Update the design doc note and the `JOURNEY_LADDER` comment
5. [ ] Run the four test files listed above and lint changed files

### Progress Log

## Acceptance Criteria

- [ ] On the Journey map, every stage's count is <= the stage before it, for every filter combination (add a test that checks this over a random set of masks)
- [ ] Clicking a stage opens the inspector with counts equal to the map node (existing rule, keep it)
- [ ] No dashed skip ribbons are drawn; the footer no longer mentions them
- [ ] The money strip also never goes up
- [ ] Timing in the inspector ignores users with no timestamp for the stage and says how many it used
- [ ] Tests fail before the change and pass after it
