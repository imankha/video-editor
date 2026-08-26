# T7530: users.last_seen_at is polluted by admin impersonation

**Status:** WIP
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

### Related Tasks
- **NOT T6780** — T6780's "guard-asymmetry" is a different class entirely (migration-window
  schema-version guards on reads vs writes, e.g. `detections_data`/`games.shared_by`
  reachability against a below-head DB). This task's guard is the impersonation-footprint
  class (T1515), unrelated despite the naming similarity — do not conflate fix shapes.
- **T7520** (impersonation creates a cross-tenant profile DB) — same 2026-08-24
  investigation, same impersonation start/stop transition, adjacent request-context code.
  Different mechanism; see T7520's Related Tasks note for the shared staging test setup.

## Acceptance Criteria

- [x] Impersonated requests no longer touch last_seen_at. Guard added inside the single
      writer `auth_db.update_last_seen` (services/auth_db.py) — skips the `UPDATE users SET
      last_seen_at = now()` when `get_current_impersonator_id()` is set, mirroring the T1515
      guard shape in `analytics.update_session` exactly. Verified against real dev Postgres:
      with an impersonator set the value is UNCHANGED; a normal (non-impersonated) call still
      UPDATES it. Regression test: `tests/test_t7530_last_seen_impersonation.py`.
- [x] Audit note — every per-user activity field updated on the request path:

      | Field | Writer | Guard status |
      |-------|--------|--------------|
      | `users.last_seen_at` | `auth_db.update_last_seen` (auth.py:320 login, auth.py:469 `/me`) | **FIXED (T7530)** — was unguarded, now skips on impersonation |
      | `user_segments.last_active_at` | `analytics.update_session` (auth.py:473 `/me`, auth.py:755 heartbeat) | **CLEAN (already guarded, T1515)** — analytics.py:403 skip-guard |
      | `user_segments.current_session_start` / `total_usage_seconds` | `analytics.update_session` / `close_session` | CLEAN — same T1515 guard (analytics.py:403 / :535) |
      | `user_milestones` / `user_actions` (`record_milestone`) | `analytics.record_milestone` | CLEAN — T1515 guard (analytics.py:272) |

      **Why `last_active_at` stayed clean is now proven, not assumed:** its only per-request
      writer (`update_session`) runs via the exact same `asyncio.create_task` →
      `asyncio.to_thread` path as `update_last_seen` (auth.py:473 sits one line below
      auth.py:469). If the impersonator contextvar did NOT propagate through that path, the
      `update_session` guard would silently no-op and `last_active_at` would be polluted too —
      it isn't, which confirms the contextvar reaches the writer and the writer-internal guard
      is the correct, established shape. `update_last_seen` was the ONLY sibling missing it.
- [x] Dashboards/queries guidance: `user_segments.last_active_at` is the trustworthy
      per-user activity/recency metric (never contaminated by admin impersonation, T1515).
      Historically-polluted `users.last_seen_at` values (pre-2026-08-26) cannot be rewound —
      there is no history to reconstruct the true last-seen from — so NO destructive data
      repair was attempted (per kickoff Step 4). Prefer `last_active_at` for retention/WAU/MAU
      going forward; `users.last_seen_at` is correct only from this fix onward.
