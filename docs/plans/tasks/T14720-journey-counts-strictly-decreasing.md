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
user who uploaded a short video (`clip_uploaded`) and never opened the upload screen has
**Clipped** but not **Add footage** (renamed "First play" and "Opened upload" below).

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

### Rename the stages to the copy glossary

The Copy audit milestone (T14500-T14670, runs before this task) set one word per concept
([copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md)). Several Journey stage labels still use
retired words (footage, clip, export, framing window). Admin is outside the epic's guard test,
but the map should use the words the parent saw at each step. Change only the `label` values in
`JOURNEY_LADDER`. **Stage `key`s stay frozen** (the inspector URL
`/analytics/journey/step/{stage}`, the rollup rows and T14740's filter all use them).

| key | Today | New label | Why |
|---|---|---|---|
| `add_footage` | Add footage | Opened upload | "footage" retired; the parent taps Upload game (or adds a short video) |
| `footage_landed` | Footage landed | Video uploaded | "footage" retired |
| `clipped` | Clipped | First play | "clip" retired; a marked moment or an uploaded short video is a "play" |
| `framed` | Moved framing window | Moved the box | the rectangle in Frame is the "box" |
| `export_pressed` | Pressed Export | Pressed Sharpen my highlight | the paid step is "Sharpen my highlight" (T14620, revised 2026-11-03) |
| `exported` | Exported | Highlight made | "export" retired; the done message is "Your highlight is ready" |
| `watched` | Watched result | Watched highlight | the finished video is a "highlight" |

Unchanged: Signed up, Started, Opened Frame, Opened Spotlight, Spotlight added, Finished
highlight, Took it away, and the money strip (Hit paywall, Opened buy, Purchased). Check the
loss ranking, the inspector and the money strip all pick up the new labels from the endpoint
(they should: the frontend has no label table of its own; grep `JourneyTab.jsx` and
`JourneyFlowChart.jsx` for any hardcoded stage label to be sure). Also follow the epic's style
rules in any text you touch: sentence case, no em dashes or "--", "1 user" / "2 users".

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
- `src/backend/app/analytics.py` - `JOURNEY_LADDER`: the header comment ("never by timestamp"), updated to the new rule, and the `label` values (rename table above)
- `src/backend/tests/test_analytics_journey.py`, `src/backend/tests/test_analytics_journey_endpoint.py`, `src/frontend/src/components/admin/journeyFold.test.js`, `src/frontend/src/components/admin/JourneyTab.test.jsx`
- Design doc: `docs/plans/admin-journey-dropoff-design-2026-10-30.md` Section 5.1. Add a dated note that the 2026-11-03 user ruling replaced skip edges with implied reach

### Related Tasks
- Runs after: the Copy audit milestone (glossary in [copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md))
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
4. [ ] Rename the stage labels (table above) and update tests that assert on the old labels (`grep -rn "Clipped\|Pressed Export\|Footage landed\|Add footage\|framing window\|Watched result" src/backend/tests src/frontend/src/components/admin`)
5. [ ] Update the design doc note and the `JOURNEY_LADDER` comment
6. [ ] Run the four test files listed above and lint changed files

### Progress Log

## Acceptance Criteria

- [ ] On the Journey map, every stage's count is <= the stage before it, for every filter combination (add a test that checks this over a random set of masks)
- [ ] Clicking a stage opens the inspector with counts equal to the map node (existing rule, keep it)
- [ ] No dashed skip ribbons are drawn; the footer no longer mentions them
- [ ] The money strip also never goes up
- [ ] Stage labels match the rename table; stage keys are unchanged
- [ ] Timing in the inspector ignores users with no timestamp for the stage and says how many it used
- [ ] Tests fail before the change and pass after it
