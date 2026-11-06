# T14900: Journey transitions coloured green / yellow / red against the roadmap targets

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M
**Created:** 2026-11-03
**Updated:** 2026-11-03

User request 2026-11-03: "ideally we would color code values in the user journey and other analytics
values so it's clear what we need to focus on (green meaning go, red meaning work on, yellow meaning ok)."

## Problem

The admin Journey map shows each transition rate (for example "Marked a play -> Opened Frame 62%") but
nothing says whether 62% is fine or a fire. The owner has to carry the target table from the
2026-11-03 funnel ranking in their head. The ad-spend model
([ua-roi-model-2026-11-03.md](../ua-roi-model-2026-11-03.md)) made the targets explicit per
transition; the map should show distance to target at a glance.

## Solution

Colour every transition label on the Journey map and in the step inspector against a named target
table. Frontend only; no persistence; no backend change.

### Targets (the "after the UI fixes" column of the roadmap table, 2026-11-03)

| Transition (stage keys as in `analytics_journey.py`) | Today (measured 2026-11-03) | Target (green at or above) |
|---|---|---|
| Signed up -> Started | 88% | 92% |
| Started -> Opened upload | 83% | 88% |
| Opened upload -> Footage landed | 66% | 78% |
| Footage landed -> Marked a play | 78% | 85% |
| Marked a play -> Opened Frame | 62% | 78% |
| Opened Frame -> Moved box | 87% | 92% |
| Moved box -> Exported (true, after T14710) | ~45% | 65% |
| Exported -> Finished | 95% | 96% |
| Finished -> Took away | 58% | 80% |
| Sign-up -> Took away (end to end) | ~4% | 18% |

### RAG rule (one pure function, unit-tested)

- **green**: rate >= target.
- **yellow**: rate >= the "today" baseline AND below target (moving, not there yet).
- **red**: rate below the "today" baseline (worse than when the targets were set).
- **grey, "n < 20"**: the source stage has fewer than 20 users reached in the selected window.
  Small N never gets a colour (same honesty convention as T7460).

Targets, baselines and the small-N floor live in ONE constants file,
`src/frontend/src/components/admin/journeyTargets.js`, keyed by the frozen stage keys (T14720 keeps
keys stable and relabels only). No computed keys, no registry: a plain object literal so grep finds
every use.

### Rendering

- `JourneyFlowChart.jsx`: the edge rate label gets the RAG colour (text colour plus a 2 px underline
  so colour-blind admins still see a mark; use the admin palette's existing green/amber/red tokens,
  see `PulseCards.jsx` for the chip colours already in use).
- `StepInspector.jsx`: a chip next to the stage heading: "62% of 143, target 78%".
- A legend row under the map: green "at target", yellow "improving", red "below 2026-11-03
  baseline", grey "too few users".
- The end-to-end rate (sign-up -> took away) gets the same chip in the Journey header.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/admin/journeyTargets.js` (new) - targets, baselines, floor, RAG function
- `src/frontend/src/components/admin/JourneyFlowChart.jsx` - edge labels
- `src/frontend/src/components/admin/StepInspector.jsx` - stage chip
- `src/frontend/src/components/admin/JourneyTab.jsx` - legend row, end-to-end chip
- `src/frontend/src/components/admin/JourneyTab.test.jsx`, new `journeyTargets.test.js`
- `src/backend/app/services/analytics_journey.py` - read only, for the stage keys

### Related Tasks
- After: T14720 (counts never go up; stage keys frozen), T14710 (true export event; until it ships the
  "Moved box -> Exported" edge is an undercount and the task must badge it "partial" using the
  existing `EVENT_INSTRUMENTED_AT` mechanism rather than colour it red).
- Feeds: T14920 (Next Step panel reads the same RAG function to pick the biggest leak).
- Sibling: T14910 (spend gates use the same chip component; share it, do not copy it).
- Related: T7460 (success-criteria scorecard; same honesty convention for small N).

### Technical Notes
- View state only. Nothing here is persisted and nothing writes to the backend.
- The baseline column is a dated snapshot (2026-11-03). When targets move, change the constants
  file in a commit that says why; never derive baselines from live data.
- Do not add a chart library. The map is hand-rolled SVG.

## Implementation

### Steps
1. [ ] Write `journeyTargets.js` with the table above and `ragFor(transitionKey, rate, nReached)`.
2. [ ] Failing tests first: boundaries (equal to target is green; equal to baseline is yellow;
       below baseline red; n = 19 grey, n = 20 coloured), unknown key throws (no silent fallback).
3. [ ] Colour edge labels in `JourneyFlowChart.jsx`; chip in `StepInspector.jsx`; legend and
       end-to-end chip in `JourneyTab.jsx`.
4. [ ] Badge, do not colour, edges whose source event is partial (`EVENT_INSTRUMENTED_AT`).
5. [ ] Screenshot desktop 1280x800 and phone 390x844 before handing over.

### Progress Log

**2026-11-03**: Filed from the ad-spend ROI session.

**2026-11-06**: Independent verification found a collapsed group could read green over a partial
edge. `foldedMark` now gives a group a colour only when every folded step was judged; otherwise it
prints "partial, worst 83.33%" (or "n < 20, ...") uncoloured, keeping the worst measured rate.

## Acceptance Criteria

- [ ] Every transition on the map shows a colour or a grey "n < 20" mark; none is uncoloured.
- [ ] The constants file is the only place targets appear; the tests fail if a stage key in the
      journey payload has no target entry.
- [ ] Partial-instrumentation edges show the partial badge, not a colour.
- [ ] Legend present; end-to-end chip present; colour plus underline (not colour alone).
- [ ] Unit tests pass for the RAG function and the legend render; no backend diff.
