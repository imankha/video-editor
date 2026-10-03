# T11400: Required-rating gate should respond immediately after a rating is picked

**Status:** STAGING
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-28
**Updated:** 2026-10-03
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

1. [x] Measure the delay and map success/failure/navigation continuations.
2. [x] Add red tests for immediate visual acknowledgement and one-shot continuation behavior.
3. [x] Implement a recoverable pending state without changing the persistence guarantee.
4. [x] Verify slow success, write failure/retry, double-click, and 5-star Highlight-choice flows.

### Progress Log

**2026-10-03**: Round 1 review found 1 MAJOR: after a failed write, re-tapping the SAME rating
was a silent no-op (local state already matched, judged "clean", no retry sent) -- stranded
mobile users with no Escape-key workaround. Fixed via `regionWriteQueue.hasFailedKey` tracking
so a previously-failed key always re-sends on the next pick. Round 2: APPROVED, 0 blocking/0
major, confirmed clean interaction with T11410 (already merged) via `git merge-tree`. Proof
Verifier: VERIFIED, independently reproduced red-to-green plus 5 additional spy-based tests for
the exit-continuation-runs-once guarantee across fail/retry/double-pick sequences, full suite
38/38 + 53/53 merged-tree check, CI green. Merged PR #558 (`f3bf68212`).

## Acceptance Criteria

- [x] A rating pick receives visible acknowledgement in the same render frame.
- [x] Users cannot submit a second rating while the first write is pending.
- [x] The requested exit still waits for a confirmed rating write and runs exactly once.
- [x] A failed write leaves or restores an actionable rating/retry surface.
- [x] Picking Brilliant still proceeds to the Make Highlight choice after persistence.
