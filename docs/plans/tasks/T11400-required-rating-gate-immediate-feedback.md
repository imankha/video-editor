# T11400: Required-rating gate should respond immediately after a rating is picked

**Status:** WIP
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-28
**Updated:** 2026-09-28
**Reported environment:** Production build 5870, Annotate

## Problem

When an unrated play triggers the required-rating gate, choosing a rating produces a noticeable
delay before the popup closes. The choice looks unresponsive and invites repeated clicks.

## Investigation

`AnnotateContainer.handleRateGatePick` deliberately keeps the gate mounted while it awaits both
`updateClipRegionWithSync(...)` and `awaitRegionWrites(...)`. Only after the backend write settles
does it clear `rateGate` and run the stashed exit continuation. A synchronous ref prevents double
picks, but the UI provides no immediate acknowledgement or busy state. Simply closing the modal
first would weaken the existing persistence contract: a failed write currently leaves the gate
open so Retry remains actionable, and navigation cannot outrun the rating write.

## Solution Direction

Design an immediate-feedback state that preserves the await-before-navigation contract. Likely
options are an instantly selected/disabled state with clear progress feedback, or visually closing
the picker while retaining a recoverable gate state until the write settles. Failure must restore
an actionable rating/retry surface, and the stored continuation must still run at most once.

## Context

### Relevant Files

- `src/frontend/src/containers/AnnotateContainer.jsx:641-657,1900-1932` — gate identity,
  in-flight guard, persisted write, and delayed continuation.
- `src/frontend/src/containers/AnnotateContainer.rateGate.test.jsx` — double-pick, failure,
  dismissal-during-write, and continuation tests.
- `src/frontend/src/modes/annotate/components/RateThisPlayModal.jsx` — visible gate state.
- `src/frontend/src/modes/annotate/components/RatingMeaningsList.jsx` — selectable rows.
- `.claude/knowledge/annotate.md` and `.claude/knowledge/persistence-sync.md` — gesture-based
  persistence invariants.

### Risks

- Navigation before persistence can lose or misreport the required rating.
- Optimistically hiding the modal without a recoverable failure state can strand the user.
- Rapid taps or a stale continuation can submit/exit twice.

## Implementation

### Steps

1. [ ] Measure the delay and map success/failure/navigation continuations.
2. [ ] Add red tests for immediate visual acknowledgement and one-shot continuation behavior.
3. [ ] Implement a recoverable pending state without changing the persistence guarantee.
4. [ ] Verify slow success, write failure/retry, double-click, and 5-star Highlight-choice flows.

## Acceptance Criteria

- [ ] A rating pick receives visible acknowledgement in the same render frame.
- [ ] Users cannot submit a second rating while the first write is pending.
- [ ] The requested exit still waits for a confirmed rating write and runs exactly once.
- [ ] A failed write leaves or restores an actionable rating/retry surface.
- [ ] Picking Brilliant still proceeds to the Make Highlight choice after persistence.
