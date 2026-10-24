# T13370: Prod check: Report a problem on desktop (closes T9730 B9 and UX-16)

**Status:** TODO
**Impact:** 6
**Complexity:** 1
**Created:** 2026-10-24
**Updated:** 2026-10-24
**Milestone:** Post deploy, see PLAN.md

## Source

Split out of [T9730](T9730-product-review-and-traceability-signoff.md) on 2026-10-24. T9730's sign-off ([T9730-SIGNOFF.md](../ux/2026-10-18-release-check/T9730-SIGNOFF.md)) marks all 76 items, with B9 and UX-16 still Deferred to T13110 because the Report a problem dialog could not be clicked on desktop.

## Problem

B9 and UX-16 cannot be settled without evidence from prod. A dotask container has no prod access and no push credentials, so this runs from a host session with the user's go-ahead.

## Solution

Prerequisite: [T13110](T13110-report-problem-dialog-not-clickable-desktop.md) is deployed to prod (PLAN.md shows it past STAGING).

1. On prod, at 1440 px with a real mouse, open Report a problem and submit one report with the text `[T9730 prod test, ignore]`, with an asset attached.
2. Confirm exactly one new `bug_reports` row with its assets (read-only query).
3. Update B9 and UX-16 in T9730-SIGNOFF.md to Fixed with this evidence and tick the boxes.

## Acceptance Criteria

- [ ] The desktop click path works on prod (Send report reached by a real mouse click).
- [ ] Exactly one `[T9730 prod test, ignore]` row exists with assets.
- [ ] B9 and UX-16 are Fixed in T9730-SIGNOFF.md with the evidence recorded.

## Context

### Relevant Files
- `docs/plans/ux/2026-10-18-release-check/T9730-SIGNOFF.md`

### Related Tasks
- T13110 (prerequisite), T9730 (parent sign-off)
