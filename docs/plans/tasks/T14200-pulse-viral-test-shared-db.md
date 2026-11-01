# T14200: Pulse viral-conversion test fails on the shared dev DB

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-31
**Updated:** 2026-10-31

Found during T14010 (2026-10-31).

## Problem

`tests/test_analytics_dashboards.py::TestPulseEndpoint::test_viral_conversion_matches_referrer_id_counts` fails on master (seen 2026-10-31: `assert 5.6 == 5.3`). It compares the pulse card against a direct whole-DB `user_segments` ratio over a date window, so it depends on unrelated users in the shared dev DB and on the date boundary the two sides use (the endpoint works in UTC; the direct query uses `CURRENT_DATE` in the DB session's time zone). Not a 10K item; found during T14010.

## Solution

Find which of the two differs (time zone boundary or a filter such as test-account exclusion) and make the test compare like with like, scoped to its own seeded users. Fix the endpoint instead if the endpoint is the side that is wrong.

## Context

### Relevant Files
- `src/backend/tests/test_analytics_dashboards.py`
- `src/backend/app/routers/admin.py` (analytics_pulse) if the endpoint is wrong

### Notes
Load: backend-services.md.

## Acceptance Criteria

- [ ] The test passes on the shared dev DB at any hour of the UTC day
- [ ] If the endpoint was wrong, a regression test fails before the fix
