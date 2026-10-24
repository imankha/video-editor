# T9730: Product review and traceability sign-off for the walkthrough handoff

**Status:** DONE
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-10
**Updated:** 2026-10-24

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E8-02 (UX-01, UX-03, UX-06, UX-12, UX-18)**.

## Why this exists

Eleven bugs, eighteen UX specs and forty-seven naming groups entered this backlog. Several were
explicitly **unconfirmed** (B10's seek lag, B11's fullscreen parity, B1's single occurrence,
B5's transient error). Without a closing reconciliation, the unconfirmed ones get silently dropped
and we will not know whether they were fixed, disproved, or forgotten.

## Scope

Review **every** B1-B11, UX-01 to UX-18 and N01-N47 item and mark each exactly one of:

- **Fixed** - with the task and before/after evidence.
- **Verified not reproducible** - with the conditions tested and what evidence would be needed to
  reopen. This is a legitimate outcome; a silent drop is not.
- **Deferred** - with the rationale.
- **Overridden by decision** - with the deciding task. (Known already: N16, N18, N22, plus the
  T8390/T9110 hierarchy reversal recorded in T9590.)

Attach before/after evidence, reproducible test results, and the material limitations that remain.

## Context

### Related Tasks
- Depends on: T9720, T9650, T9570 (the naming audit's own 47-group table feeds directly into this)
- The handoff's own coverage tables (bug -> tasks, UX spec -> tasks) are in
  `05-engineering-handoff.md` and are the starting checklist.

### Technical Notes
Deliverable is a document, and it is worth publishing as an artifact for review rather than leaving
it in a task file.

## Acceptance Criteria

- [x] Every B1-B11 item carries one of the four outcomes with evidence
- [x] Every UX-01 to UX-18 item carries one of the four outcomes
- [x] All 47 naming groups are reconciled via T9570's table
- [x] Overrides name their deciding task
- [x] Remaining material limitations are recorded rather than dropped

**2026-10-14 (WAITING ON USER)**: The sign-off must cite before/after evidence for every B1-B11, UX-01..18 and N01-N47 item, and it depends on T9720's live staging results (not yet run; itself WAITING ON USER) plus the handoff archive at `C:/Users/imank/Documents/Codex/...` (not reachable from the container). Marking items Fixed or Verified-not-reproducible without that evidence would be the silent drop this task exists to prevent. To unblock: finish T9720, then run this task with the handoff archive and T9570's 47-group table available, and publish the result as an artifact. Resolve is the user's gesture.


**2026-10-14 (back to TODO)**: Not a user wait. It follows T9720; the handoff archive under `C:/Users/imank/Documents/Codex/` is on the host machine, so a HOST session (not a container) can run it once T9720 has results.

**2026-10-14 (WAITING ON USER, exact steps)**: This is a sign-off, so it was skipped here; it needs T9720's live results and the handoff archive on the host machine. To unblock:
1. Finish T9720 (live staging results recorded).
2. In a HOST session with `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff` and T9570's 47-group table, mark every B1-B11, UX-01..18 and N01-N47 item exactly one of Fixed (task plus before/after evidence), Verified not reproducible, Deferred, or Overridden by decision (naming the deciding task; known: N16, N18, N22, T9590 hierarchy reversal).
3. Record remaining material limitations, publish the result as an artifact, and tick the boxes. Resolve is the user's gesture.

**2026-10-18 (WAITING ON USER)**: Sign-off written: [T9730-SIGNOFF.md](../ux/2026-10-18-release-check/T9730-SIGNOFF.md). All 76 items carry one outcome (55 Fixed, 19 Overridden by decision, 2 Deferred to T13110, 0 pending); T9720's staging results are folded in. Waiting on the user for: (1) the product review of the sign-off itself, and (2) whether to run the B9/UX-16 report check on PROD (it writes a real prod `bug_reports` row). Resolve is the user's gesture.

**2026-10-18 (user decision, back to TODO)**: The prod Report a problem check waits until T13110 (desktop dialog click fix) is fixed and deployed, so it checks the final version. Then submit one report tagged `[T9730 prod test, ignore]` on prod, confirm exactly one row with assets, update B9 and UX-16, and the sign-off is complete. Not waiting on the user until then; Resolve stays the user's gesture.

**2026-10-24 (user decision, DONE)**: Marked DONE. The two items still Deferred to T13110 (B9, UX-16) move to [T13370](T13370-prod-report-a-problem-check.md) in Milestone: Post deploy.
