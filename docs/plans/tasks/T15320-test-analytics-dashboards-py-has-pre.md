# T15320: test_analytics_dashboards.py has pre-existing failures against shared Postgres test state

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-08
**Updated:** 2026-11-08

## Problem

Found by the /dotask verifier on group g-t15280-3 at 7b191a6ef, which judged it unrelated to that branch. Impact and complexity are unscored defaults.

**Steps:** Run `python3 -m pytest tests/test_analytics_dashboards.py` in src/backend on this branch's HEAD or on origin/master.

**Expected:** All tests pass in isolation.

**Actual:** 15 failures / 1 error (e.g. test_dashboard_sections_match_individual_endpoints gets 403 instead of 200; test_record_milestone_upserts_action errors with psycopg2.errors.UniqueViolation on users_pkey; 'campaigns table missing (v038 not applied)'). Reproduced identically on a clean origin/master worktree, so this is pre-existing shared-Postgres test-state pollution, not caused by this branch.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- To be found.
