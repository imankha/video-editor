# T12310: Re-run the first-time walkthrough on staging (milestone close)

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Milestone close](README.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

The milestone must prove the walkthrough that produced it now passes.

## Solution

Repeat the 2026-10-08 Playwright walkthrough on staging with a blank account and the same game video; for every finding in findings.md capture a screenshot showing it fixed (or file a follow-up). Check: no overlapping floating elements, main CTA first on every screen, a guide on every state in the guide table, no jargon from the findings list.

## Context

### Relevant Files (REQUIRED)

- `docs/plans/ux/2026-10-08-staging-qa-walkthrough/findings.md`

### Related Tasks

- All other tasks in the milestone.
- T12320 (items 2-6 handed off here; item 1 runs before this pass).

## Implementation

### Steps

1. [ ] Use a fresh staging fixture account (never a real user's), enough credits for one upload and one generation
2. [ ] Drive the journey at 1440x900 and 390x844 (Playwright, `reference_drive_app_as_user`): sign in, upload `staging-verification-fixture-5min.mp4`, mark a play, make it a highlight, set a focus point, Generate, Done for now, find the clip in Clips
3. [ ] Also load Games, Clips, Annotate and Focus at 768x1024 and run `assertNoHorizontalOverflow` on /annotate, /focus, /overlay, /home at 320, 360, 375, 390, 768 (feeds T11900)
4. [ ] Screenshot each finding fixed under `docs/plans/ux/2026-10-08-staging-qa-walkthrough/re-run/`; write `re-run/RESULTS.md` (finding -> fixed / partly / not fixed -> screenshot)
5. [ ] Check copy against the guide table: no jargon from the findings list, no claim that the app frames, tracks or follows automatically
6. [ ] Rule on the T12320 hand-off items (see "Hand-off from T12320" below): for each, capture a screenshot and record keep / restore / drop in RESULTS.md
7. [ ] Anything not fixed becomes a new task; set `WAITING ON USER` with the RESULTS link (human judgment of clarity is the user's call)
8. [ ] Commit docs with subject starting `T12310:`

### Hand-off from T12320

T12320 (frontend unit tests green) landed its fixes; its leftover product questions are judged by using the app, so they are checkpoints in this pass. Details: [T12320](../T12320-restore-frontend-unit-tests-green.md) "Remaining".

Run T12320 item 1 (e2e selector drift, 13 Playwright specs) BEFORE this pass so it starts from known-good specs. It is a separate small task, not part of this one.

Checkpoints to rule on (each: screenshot at 1440 and 390, then keep / restore / drop):

- **Overlay Text lane** cannot be hidden once shown (T12320 item 2). Is the always-open lane confusing or in the way?
- **Annotate capture-window hint** ("6 seconds before, 2 after") is gone (T12320 item 3). Does a first-time user understand what a mark captures without it?
- **Locked Review plays card** looks the same as an enabled one (T12320 item 4). Does a tap on a locked card feel like a surprise?

Watch for and record as findings if hit (small, file as tasks, not blockers):

- Edit play card accessible name runs title into description (T12320 item 5).
- Annotate coach guidance still shows after the first play (T12320 item 6).

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.
**2026-10-09**: Rewritten as a no-code verification task. This is the ONE staging pass for both this milestone and the Parent Usability Audit close (T11900 reads these screenshots instead of re-driving the journey).

## Acceptance Criteria

- [ ] Every finding B1-B8 and every guide row has a before/after screenshot or a filed follow-up
- [ ] Journey from blank account to finished highlight completes at 1440 and 390 widths
- [ ] RESULTS.md written; any "not fixed" finding has a filed task
- [ ] Screenshots cover the 768 viewport and the overflow check, so T11900 can reuse them
