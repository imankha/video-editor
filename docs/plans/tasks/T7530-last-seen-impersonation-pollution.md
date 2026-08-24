# T7530: users.last_seen_at is polluted by admin impersonation

**Status:** TODO
**Priority:** P2 (metrics integrity; silently corrupts retention analysis)
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

Impersonating a user updates that user's `users.last_seen_at` in Postgres. Proven on prod
(2026-08-24): cschwartz78 shows `last_seen_at = 2026-08-23 22:46:55` while
`impersonation_audit` id 85 shows the admin STARTING impersonation at 22:46:53; same
pattern for bigajosue (05:05:25 vs audit id 89) and rooom1h (05:07:15 vs audit id 91).

Consequence: every retention/WAU metric built on `last_seen_at` overstates activity, and
investigating a churned user marks them active. This will bite the T7460 success-criteria
scorecard (WAU/MAU targets) directly.

The codebase already has the pattern for exactly this: T1515 added
`get_current_impersonator_id()` (user_context.py) so ANALYTICS writers skip recording
during impersonation. The session-touch/last-seen writer never got the same guard.

## Solution

1. Find the writer(s) that update `users.last_seen_at` (and any session-touch bookkeeping
   with the same exposure) and skip the update when the session carries
   `impersonator_user_id` / `get_current_impersonator_id()` is set.
2. Audit for OTHER per-user "activity" fields updated on request that lack the
   impersonation guard (e.g. anything in user_segments touched per-request;
   `user_segments.last_active_at` appeared CLEAN in the investigation, verify why and keep
   it that way).
3. Optional data repair: the polluted values cannot be reliably rewound (no history), so
   document that `user_segments.last_active_at` is the trustworthy field and point any
   dashboards/queries at it.

## Context

### Relevant Files
- `src/backend/app/user_context.py` - `get_current_impersonator_id` (T1515 pattern)
- `src/backend/app/middleware/db_sync.py` - request path where the impersonator id is set
- `src/backend/app/services/auth_db.py` / `pg.py` - wherever last_seen_at is written
- `src/backend/app/analytics.py` - reference implementation of the skip guard

## Acceptance Criteria

- [ ] Impersonated requests no longer touch last_seen_at (test: impersonate on staging,
      confirm value unchanged)
- [ ] Audit note in this file listing every per-user activity field checked and its guard
      status
- [ ] Dashboards/queries guidance: last_active_at is the metric source
