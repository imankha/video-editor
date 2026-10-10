# T12420: Locked Review plays card needs a visible locked state (decision)

**Status:** TODO (blocked on a ruling from the T12310 walkthrough)
**Impact:** 4
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-10
**Updated:** 2026-10-10
**Found by:** [T12320](T12320-restore-frontend-unit-tests-green.md) item 4

## Problem

A locked Review plays card looks the same as an enabled one. T11750's visual cues (no outline, Lock icon, dimmer text) were removed in 31b50fab5; only `aria-disabled` and the toast remain, so users learn it is locked only after tapping.

## Solution

Ruling needed: **restore the cues** (visible before tapping, partly reverts the action-card redesign) or **keep plain**. Judged during [T12310](staging-qa-2026-10-08/T12310-re-run-staging-walkthrough.md): does tapping a locked card feel like a surprise? Use the shared look from the CTA-consistency epic, not the old one-off styling.

## Context

### Relevant Files (REQUIRED)

- The Annotate action card for Review plays (find via the `aria-disabled` card in `src/frontend/src/modes/`)
- T11750 task file for the removed cues

## Implementation

### Steps

1. [ ] Get the ruling from T12310
2. [ ] If restore: failing test first (Lock icon and dim style when locked), then implement
3. [ ] Commit with subject starting `T12420:`

## Acceptance Criteria

- [ ] Ruling recorded in this file
- [ ] If restored, locked and enabled cards are visually distinct, covered by a test
