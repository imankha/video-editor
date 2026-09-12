# T9690: Failure-path regression coverage for onboarding and reporting

**Status:** STAGING
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E2-05 (UX-15, UX-16; bugs B3, B7, B9)**.

## Why this exists

The three bugs this covers all share a shape: **an operation half-succeeded and the UI reported the
optimistic half.** That class does not stay fixed without tests that exercise the failure path
explicitly, because the happy path passes either way.

## Scope

Automated coverage for:

- Interrupted completion saves (the quest step persists, or it does not - never both).
- Refresh and resume mid-flow: no replay of already-saved work.
- Offline report submission and retry: content preserved, exactly one report filed.
- Duplicate requests on both paths.

## Context

### Related Tasks
- Depends on: T9400, T9410, T9440 - the fixes this guards. Each of those files its own red-green
  proof; **this task is the durable net across all three**, not a substitute for them.

### Technical Notes
Failure injection, not mocking away the failure. Recorded project lesson: a permissive harness fails
open and proves nothing.

## Acceptance Criteria

- [ ] 5/5 and a rejected completion cannot coexist, asserted by test
- [ ] Offline retry resumes without replaying already-saved work
- [ ] Two saved plays never trigger the first-play guidance, asserted by test
- [ ] A failed report send preserves the report and a retry files exactly one
- [ ] Tests exercise injected failures rather than mocking the failure away
