# T1515: Suppress Analytics During Admin Impersonation

**Status:** DONE
**Impact:** 6
**Complexity:** 3
**Created:** 2026-06-16
**Updated:** 2026-06-18

> **Shipped (deploy 2026-06-18):** request-path suppression complete — `_current_impersonator_id`
> ContextVar (user_context.py) set in db_sync middleware, guards `record_milestone()`,
> `update_session()`, `close_session()`; frontend `track()` early-returns on `authStore.impersonator`;
> unit + integration tests in `test_user_activity_sync.py`. **Gap (criterion 5):** the export-job
> background-worker path (`export_completed`/`export_failed` fired outside the request ContextVar)
> was neither implemented nor documented. Split into **T1516** to stamp an `impersonated` flag on
> the export job and skip the completion milestone.

## Problem

When an admin uses "Login as User" (T1510, shipped), every action they take is attributed to the impersonated user's analytics. That pollutes the user's real activity: it inflates `user_actions` counts, writes phantom rows to their `user_action_log` timeline, and fires milestones the user never earned. This is now actively harmful because that activity data drives downstream features — the lifecycle-email funnel classifier (T3580/T3590), the attribution/funnel views, and the viewer buckets (T3595) all read it. An admin clicking through a user's account to debug would, e.g., flip their `stuck_at` stage or mark milestones complete, corrupting who gets which lifecycle email.

Admin impersonation actions should be **invisible to analytics** — no server-side milestones and no frontend tracking while impersonating.

## Solution

Gate analytics recording on whether the current session is an impersonation session, on both ends:

- **Backend:** short-circuit `record_milestone()` when the request is an impersonated session.
- **Frontend:** short-circuit `track()` (and event posts) when `authStore.impersonator` is set.

This is a follow-up to T1510 — it reuses the impersonation flags T1510 already established.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` — `record_milestone(user_id, event, context)` (~line 218). Single choke point; add an early return when impersonating.
- `src/backend/app/user_context.py` — has the per-request `_current_user_id` ContextVar. Add a sibling `_current_impersonator_id` ContextVar + getter, so `record_milestone` can check it without a `request` handle.
- `src/backend/app/services/db_sync.py` — request middleware (~line 456 resolves `request.state.session`, ~line 501 sets the user_id ContextVar). Set `_current_impersonator_id` here from `session["impersonator_user_id"]`.
- `src/backend/app/services/auth_db.py` — impersonation session model: `impersonator_user_id` column, `create_impersonation_session()` (~line 261). Source of truth for "is impersonating."
- `src/frontend/src/utils/analytics.js` — `track()` (~line 45). Add early return when impersonating.
- `src/frontend/src/stores/authStore.js` — `impersonator` state (~line 26), set via `/api/auth/me` (`setSessionState`, ~line 125). The frontend impersonation flag.
- `src/frontend/src/components/ImpersonationBanner.jsx` — existing banner gated on `impersonator`; same flag the suppression keys off.

### Related Tasks
- Follow-up to **T1510 (Admin Impersonate User, DONE)** — reuses its session flags + banner state.
- Protects the data consumed by T3580/T3590 (lifecycle classifier), T3550/T3560 (attribution/access analytics), and T3595 (viewer buckets).

### Technical Notes
- **Backend choke point first.** Guarding `record_milestone()` covers the vast majority of events (it writes both Postgres `user_actions` and per-user `user_action_log`). Frontend `track()` mostly sends debug breadcrumbs / Cloudflare beacons; still gate it so impersonation isn't counted there either.
- **Background-task edge case:** some events fire from background workers, not the request (e.g. `export_completed` in `export_worker.py`, payment webhooks). A request-scoped ContextVar will NOT be set in those contexts, so an export *kicked off while impersonating* could still record on completion. Decide how to handle: either (a) stamp an `impersonated` flag on the export/job at creation time and skip recording when it completes, or (b) accept that async completions of impersonated jobs are out of scope (document it). Prefer (a) for the export path since admins debugging exports is plausible; webhooks are lower risk.
- **Don't suppress audit/impersonation logging** — T1510's own audit log of admin actions must still record. Only the *user-facing analytics* events are suppressed.
- **Log suppressions** at debug level for traceability ("skipped milestone X during impersonation").
- No DB schema change (reuses T1510's `impersonator_user_id`).

## Implementation

### Steps
1. [ ] Backend: add `_current_impersonator_id` ContextVar + getter in `user_context.py`.
2. [ ] Backend: set it in `db_sync.py` middleware from `session["impersonator_user_id"]`; clear per-request.
3. [ ] Backend: early-return in `record_milestone()` when impersonating (with a debug log).
4. [ ] Backend: handle the export-job path (stamp impersonated flag at job creation; skip on completion) or document it as out of scope.
5. [ ] Frontend: early-return in `track()` when `authStore.getState().impersonator` is set.
6. [ ] Tests: impersonated request records no milestone / no action-log row; normal request still records; export started while impersonating does not record on completion (if (a) chosen); audit log still records.

## Acceptance Criteria
- [ ] Actions taken while impersonating record no analytics milestones or action-log rows for the impersonated user
- [ ] Frontend `track()` events are suppressed during impersonation
- [ ] Normal (non-impersonated) sessions are unaffected
- [ ] T1510's admin audit log still records impersonated actions
- [ ] Export-job analytics started during impersonation handled per chosen approach (suppressed or documented)
- [ ] Tests pass
