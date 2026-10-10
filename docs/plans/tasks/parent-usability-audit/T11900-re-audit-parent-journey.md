# T11900: Re-run the parent journey on staging (milestone close)

**Status:** TODO (runs after T12310 and after every other task in the milestone is on staging)
**Impact:** 7
**Complexity:** 2
**Tier:** S (verification only, no code)
**Created:** 2026-10-04

## Context

Closing task of the [Parent Usability Audit](README.md) milestone. The original audit
([reelballers-ux-audit.md](../../ux/2026-10-04-parent-usability-audit/reelballers-ux-audit.md)) ran
on staging at 1440x900, 768x1024 and 390x844.

## Steps

Do NOT drive the journey again. [T12310](../staging-qa-2026-10-08/T12310-re-run-staging-walkthrough.md)
is the single staging pass for both milestones (1440, 768, 390, plus `assertNoHorizontalOverflow`).

1. Confirm T12310 is done and its screenshots cover 1440, 768 and 390.
2. For every CRITICAL and HIGH finding in the audit table, link the T12310 screenshot that shows it
   fixed, or take one more screenshot for a finding T12310 did not cover. Save under
   `docs/plans/ux/2026-10-04-parent-usability-audit/re-audit/`.
3. Write `re-audit/RESULTS.md`: a table of each audit finding -> fixed / partly fixed / not fixed,
   with the screenshot link. Any "not fixed" becomes a new task.

## Acceptance Criteria

- Every CRITICAL and HIGH finding has a screenshot proving the fix, or a filed follow-up task.
- The full journey completes at 1440 without any step that needs a hidden gesture.

## Notes

- KNOWN GAP: T11890 (silent Google sign-in failure) was closed 2026-10-09 by user decision WITHOUT
  the Google console origin check or the real-device repro, so nothing covers it. List it in
  RESULTS.md as "not verified (T11890 closed unchecked)"; `[auth-diag]` log lines are the only signal.
- Human judgment (does it feel clear?) is the user's call: set `WAITING ON USER` with the RESULTS
  link when done.
