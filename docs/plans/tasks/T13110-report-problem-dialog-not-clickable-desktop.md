# T13110: Report a problem dialog cannot be clicked on desktop

**Status:** STAGING
**Impact:** 8
**Complexity:** 2
**Tier:** S (frontend)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T9720 staging release check, 2026-10-18 ([T9720-RESULTS.md](../ux/2026-10-18-release-check/T9720-RESULTS.md)). Screenshots are local only, in the session scratchpad `t9720/shots/` on the host that ran the check.

## Problem

At 1024 px and wider, a real mouse click cannot reach Send report, Retry, Copy error details or Close in the Report a problem dialog. The click falls through to the page behind (on Home it opened a game, `/annotate`) and nothing is sent. Computed `pointer-events` is `none` on the dialog root, its parent and the Send button. Mobile touch works, and keyboard Enter or a scripted DOM click works, which is why the jsdom tests and the release check's own scripted submits passed. Desktop users therefore cannot report a problem at all. This reopens B9 and UX-16 in the T9730 sign-off. Evidence: rp1, rp-desktop-form, rp-desktop-fail.

## Solution

Cause read from the code: `GlobalReportButton` in `main.jsx` renders the dialog inside `CornerStack`, which is `pointer-events-none` (`CornerStack.jsx:13`); only the small trigger sets `pointer-events-auto`. Render the dialog outside that stack (a portal), or set `pointer-events-auto` on the dialog root. Add a real-browser e2e that hit-tests Send, Retry, Copy and Close with `document.elementFromPoint` at 1440 and clicks Send with a real mouse.

## Context

### Relevant Files
- `src/frontend/src/main.jsx` (`GlobalReportButton`)
- `src/frontend/src/components/` `CornerStack.jsx`, `ReportProblemButton`
- Existing tests: `ReportProblemButton.failure.test.jsx`, `ReportProblemButton.retry.test.jsx`

### Related Tasks
- Found by T9720 (2026-10-18)

## Acceptance Criteria

- [ ] A real mouse click on Send at 1440x900 sends exactly one report (one `bug_reports` row)
- [ ] Retry, Copy error details and Close are clickable with a real mouse
- [ ] An e2e hit-test with `elementFromPoint` fails before the fix and passes after
- [ ] Mobile touch still works
- [ ] T9730 rows B9 and UX-16 updated with the evidence
