# T11930: Measure Portrait vs Landscape highlight choice

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Tier:** M (frontend plus a small backend vocabulary change, aggregates only)
**Created:** 2026-10-06

## Epic Context

Follow-up to [T11910](T11910-highlight-instances-server-sync-and-orientation-slots.md) in [Epic D](EPIC.md).

## Problem

T11910 replaced a single default-Portrait button with two equal slots. The UX consult's riskiest
assumption is that parents may not know which they need, so removing the default could lower the
first-highlight rate. Without orientation-split numbers we cannot tell.

## Solution

Use the existing in-house analytics (aggregates only, counts not events; no new Postgres state).
Pair attempts with successes (never one number), split by orientation:
- highlight make tries and successes for `portrait` and `landscape`
- landscape share of FIRST makes (about 0% before T11910)
- share of users with both orientations on the same play
- first-clip to first-highlight rate against the pre-T11910 baseline, compared like weeks

If the user-action vocabulary is closed, add the two names. Report N, relative change, and note
weekend-game seasonality.

**Decision rule written down now:** if the first-highlight rate drops versus baseline, add a subtle
"Most people start with Portrait" hint inside the Portrait slot (a hint, not a preselection).

## Context

- Playbook: `docs/plans/analytics-playbook.md`
- Emit point: `AnnotateModeView.handleMakeHighlight` (the gesture that carries `aspectRatio`)

## Acceptance Criteria

- [ ] Orientation-split tries and successes visible in the scorecard
- [ ] Baseline captured before T11910 reaches prod

## Progress Log

- Emitted server-side (not from `handleMakeHighlight`) at the highlight-create seam in `routers/clips.py`
  (`_begin_highlight_make` / `_finish_highlight_make`), so every route (slots, rating card, first save) counts once.
  New `FLOW_EVENTS` (engagement dims, no migration): `highlight_make_attempted_{portrait,landscape}`,
  `highlight_made_{portrait,landscape}`, `highlight_first_made_{portrait,landscape}`, `highlight_both_orientations`.
  Visible as labelled rows in the admin Platform Breakdown (`PlatformBreakdown.jsx`). Read per user with COUNT(DISTINCT user_id).
- Still open (needs prod): the pre-T11910 first-clip to first-highlight baseline. Capture it from `user_actions`
  (`clip_created` vs `clip_created` with a project) BEFORE this deploys to prod, then apply the decision rule above.
