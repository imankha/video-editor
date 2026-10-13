# Epic E: Release check

**Status:** TODO
**Started:** 2026-10-13
**Milestone:** Deploy Candidate (P1), see PLAN.md and the [decision artifact](https://claude.ai/artifact/3RNsjmukcE75aU2y3xHhYx)

## Goal

Runs last on staging after A to D are merged: re-run the T12590 staging walk, the end-to-end and failure-path check, the product sign-off, and the tutorial videos that gate the email.

Gates the deploy and the all-user email.

## Tasks (implement in this order)

| ID | Task | Status |
|----|------|--------|
| T12590 | [T12590](../../T12590-guide-coverage-and-responsive-sweep.md) | WIP |
| T9720 | [T9720](../../T9720-end-to-end-and-failure-path-release-check.md) | TODO |
| T9730 | [T9730](../../T9730-product-review-and-traceability-signoff.md) | TODO |
| T10320 | [T10320](../../T10320-reshoot-tutorial-videos-v3.md) | TODO |

## Completion Criteria

- [ ] All tasks complete and merged to master
- [ ] Verified on staging by the T12590 re-walk (Epic E) for the screens it touches
- [ ] Knowledge docs updated where an invariant or entry point moved
