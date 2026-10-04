# T11900: Re-run the parent journey on staging (milestone close)

**Status:** TODO (runs after every other task in the milestone is on staging)
**Impact:** 7
**Complexity:** 2
**Tier:** S (verification only, no code)
**Created:** 2026-10-04

## Context

Closing task of the [Parent Usability Audit](README.md) milestone. The original audit
([reelballers-ux-audit.md](../../ux/2026-10-04-parent-usability-audit/reelballers-ux-audit.md)) ran
on staging at 1440x900, 768x1024 and 390x844.

## Steps

1. Use a fresh staging fixture account (never a real user's account; see the memory note on staging
   fixture clones) with enough credits for one upload and one generation.
2. Drive the same journey as the audit at **1440x900** (Playwright, `reference_drive_app_as_user`):
   sign in, upload `staging-verification-fixture-5min.mp4`, mark a play, make it a highlight, set a
   focus point, Generate, choose Done for now, find the clip in Clips.
3. Refresh the same account at **768x1024** and **390x844** and inspect Games, Clips, Annotate, Focus
   (no state-changing actions, same as the audit).
4. For every CRITICAL and HIGH finding in the audit table, take one screenshot that shows it fixed,
   and save them under `docs/plans/ux/2026-10-04-parent-usability-audit/re-audit/`.
5. Run `assertNoHorizontalOverflow` on /annotate, /focus, /overlay, /home at 320, 360, 375, 390, 768.
6. Write `re-audit/RESULTS.md`: a table of each audit finding -> fixed / partly fixed / not fixed, with
   the screenshot link. Any "not fixed" becomes a new task.

## Acceptance Criteria

- Every CRITICAL and HIGH finding has a screenshot proving the fix, or a filed follow-up task.
- The full journey completes at 1440 without any step that needs a hidden gesture.

## Notes

- The Google sign-in in-app browser check is covered by T11890's real-browser verification; do not
  repeat it here.
- Human judgment (does it feel clear?) is the user's call: set `WAITING ON USER` with the RESULTS
  link when done.
