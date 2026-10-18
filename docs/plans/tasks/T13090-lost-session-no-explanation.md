# T13090: Lost session shows the bare sign-in card with no reason

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Tier:** S (frontend copy)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-18 ([RESULTS.md section 10](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only, under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk.

## Problem

When a second login replaces the session, the app returns to the plain sign-in card with no sentence saying the session ended, so a parent does not know why they were signed out. Evidence: r2-lostsession-* at all four viewports.

## Solution

When the app detects a replaced or expired session, show one line on the sign-in card (for example "You were signed out because you signed in on another device", or the expiry equivalent).

## Context

### Relevant Files
- `src/frontend/src/` auth gate / sign-in card, session-expiry handling

### Related Tasks
- Found by T12590 (2026-10-18 re-walk)

## Acceptance Criteria

- [ ] A replaced session shows the explanation line on the sign-in card
- [ ] A fresh sign-in shows no such line
