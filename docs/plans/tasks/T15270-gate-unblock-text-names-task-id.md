# T15270: Spend gate 1 unblock text names a task id

**Status:** TODO
**Impact:** 2
**Complexity:** 1
**Tier:** S (backend text, no schema change)
**Created:** 2026-11-06
**Updated:** 2026-11-06

Low-severity item from independent verification of T14910.

## Problem

`analytics_spend_readiness.py` puts "T7410" in gate 1's `unblock.text` on a `kind: task` row. T14910's
design section 3 says these rows carry no task ids, because the roadmap export owns which tasks move
a gate (T14920). A renumbered task would leave stale text in the panel.

## Solution

Drop the id from both strings. Keep it in the `visit_daily` log warning, where it helps a reader.

## Context

### Relevant Files (REQUIRED)

- `src/backend/app/services/analytics_spend_readiness.py`
- `src/backend/tests/test_admin_spend_readiness.py`

### Related Tasks

- T14910, T14920, T7410.

## Acceptance Criteria

- [ ] No `unblock.text` contains a task id.
- [ ] A test fails if one does.
