# T11330: Explanatory Popup When an Export Is Rejected as Too Large

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-25
**Updated:** 2026-09-26

## Problem

T11320 stops the backend from dispatching an export Modal can't finish in time, but a bare
rejection is only half the fix — Bug 58p's user had no way to know what to change even after the
fact (he retried the identical export 4 times over 13 hours). Once the guard exists, the user
needs to be told the concrete levers, not just "export failed."

## Solution

When the export dispatch call in Focus returns T11320's structured over-budget rejection, show a
popup (not a toast that can be missed) explaining:
1. Why: this export is too large for our video processor to finish in time
2. What to do: crop in tighter on the clip(s) contributing the most (name them if the guard's
   response identifies the worst offenders), and/or export fewer clips at once / split into
   batches
3. No credits were charged (the guard rejects before the credit deduction that currently happens
   at dispatch — confirm this ordering holds; if the deduction happens first, this task must also
   fix that ordering so a rejected export never touches credits)

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/framing/` — Focus mode export trigger + progress UI
- Wherever the export dispatch fetch/error handling currently lives for Focus (find via the
  `export_started`/`export_progress` action-logging call sites, same events seen in Bug 58p's
  breadcrumbs)
- Backend: whatever structured error shape T11320 lands on (read T11320's implementation before
  starting this task — do not guess the response shape)

### Related Tasks
- Depends on: T11320 (needs the structured rejection reason; do not start until T11320's response
  shape is decided/implemented)

### Technical Notes
- Per CLAUDE.md UI rules: no backdrop-close on this modal (consistent with existing modal
  conventions — see `.claude/knowledge` / UI style guide).
- Reuse existing crop-adjustment UI affordances (jump the user to the offending clip in Focus)
  rather than just describing "crop in" in prose, if feasible within this task's scope — but don't
  expand scope if it turns into a bigger UI project; a clear text explanation is the acceptance bar.

## Implementation

### Steps
1. [ ] Read T11320's final rejection response shape
2. [ ] Build the popup component (or extend an existing error-modal pattern)
3. [ ] Wire it to the export dispatch failure path in Focus
4. [ ] Confirm credits are not deducted on a T11320 rejection (fix ordering if they are)

### Progress Log

**2026-09-25**: Filed from Bug 58p investigation, alongside T11320. Not started.

## Step 4 decision (credit ordering) — option (a), net-zero

T11320 reserves + confirms (deducts) credits synchronously in the request handler BEFORE the
background `_export_clips` task starts; the guard rejection fires inside that background task and
the same handler refunds the deducted credits (`multi_clip.py` `except Exception` -> `refund_credits`).
So a rejected export is a DEDUCT-then-REFUND that nets to zero — it is NOT literally "never
deducted". Chosen option (a): leave the deduct+refund pattern as-is (matches Bug 58p's own
auto-refund precedent; option (b), computing the estimate before the 202 to skip the ledger
entirely, would duplicate the clip-assembly that lives inside `_export_clips` and was judged not a
clean/contained change). The acceptance criterion below is reworded to the net-zero contract and a
backend test (`tests/test_t11330_rejection_credit_refund.py`) pins it.

## Acceptance Criteria

- [x] Triggering T11320's guard shows a popup with the "why" and concrete next steps, not a bare
      error (`ExportTooLargeModal`, rendered from `GlobalExportIndicator`)
- [x] Credits net to zero for a rejected export (deduct-then-refund; `test_t11330_rejection_credit_refund.py`)
- [x] Frontend test covering the rejection -> popup path via the real WS channel
      (`ExportWebSocketManager.test.js`, `ExportTooLargeModal.test.jsx`, `GlobalExportIndicator.test.jsx`)

## Landed (2026-09-26)

Merged via PR #516 (merge commit `38104e53`), full executable landing gate. Two fresh-context
reviews caught real issues before landing:
- **BLOCKING** (round 1): the popup never rendered in production — `ExportButtonContainer`'s WS
  `onError` callback wrote to the export store a second time after `ExportWebSocketManager`
  already set `budgetRejection` correctly, clobbering it back to `null`. Fixed via a single-write-
  path correction (the WS manager is now the sole writer for terminal WS errors), with a real
  integration regression test (`ExportButtonContainer.budgetRejection.test.jsx`) proven red-to-
  green.
- **Human decision required** (final landing-gate round): a fresh reviewer traced that the Step 4
  net-zero decision (above) deviated from this task's own written acceptance criterion ("no
  credits deducted") without recorded user sign-off. Escalated; user decision recorded 2026-09-26
  via `landing_gate.py record-human-decision`: accept net-zero, land as-is.
Also normalized 3 pre-existing CRLF files to LF (mechanical, zero content change, fixed a CI
whitespace-check failure) and removed em-dashes from shipped copy per project convention.
