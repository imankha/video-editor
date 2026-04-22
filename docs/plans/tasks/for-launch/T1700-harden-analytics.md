# T1700: Harden Analytics

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-04-21

## Problem

Analytics pipeline needs hardening before launch to ensure reliable event capture, storage, and querying across all key user flows.

## Scope

- Audit existing analytics events for completeness and reliability
- Ensure key user flows are instrumented (upload, annotate, frame, export, share)
- Add missing error/failure tracking for critical paths
- Verify analytics survive edge cases (offline, reconnect, tab close)
- Ensure data is queryable for product decisions

## Implementation

TBD — requires audit of current analytics state first.

## Acceptance Criteria

- [ ] All key user flows have analytics events
- [ ] Events are reliably delivered (no silent drops)
- [ ] Error/failure paths are tracked
- [ ] Analytics data is queryable for product decisions
