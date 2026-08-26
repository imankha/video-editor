# T7515: Frustration mid-funnel instrumentation (blocking-dialog/toast impressions + session-exit breadcrumbs)

**Status:** TODO
**Priority:** P2 (observability follow-up to T7510)
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-26

> **Filing note:** The T7510 design doc recommended filing this as "T7520", but **T7520
> was already assigned** to "Impersonation creates cross-tenant profile DB under admin's
> user_id". Filed as T7515 (free gap ID adjacent to T7510) instead. Rename if you prefer a
> different slot.

## Problem

T7510 delivered the attempt/outcome/failure taxonomy for the funnel's ENDPOINTS (tiers 1+2 of
the frustration-signal review, plus retry-burst from tier 5). Frustration that lives in the
MIDDLE of the funnel — repeated refusals, error toasts, and where a session died — is still
uninstrumented. This task picks up the deferred tiers named in `T7510-design.md` §7 so the gap
between "attempted" and "succeeded" can be explained, not just counted.

## Scope (deferred from T7510, see T7510-design.md §7)

- **Tier 3 — Blocking-dialog and error-toast impressions** (name + per-session count). The
  T7540 tag-trap would have been visible as "Tag not submitted shown 5x, clips saved 0". A
  repeated refusal impression in one session is a near-direct frustration measurement. Needs a
  small toast/dialog instrumentation layer (component-level) feeding the existing aggregate
  counters (same aggregates-only constraint as T7510: counts, not per-event rows in shared
  stores).
- **Tier 4 — Session-exit breadcrumbs**: last screen + per-screen dwell, written to the user's
  own `user_action_log` (per-event detail belongs in user.sqlite; PG stays aggregate). Bug
  reports' `actions` array proves the value — today it's the only place this trail exists, and
  only when someone complains. Sequence AFTER T7480 beacon + T7560 bug-report ring buffer (it
  overlaps their transport).

## Deferred second-tier items (also named in T7510-design.md §7, decide in this task's design)

Real device/UA/touch capture once per session (replace the viewport-width guess); pin
`viewed_duration` semantics (accumulated vs furthest position); acquisition attribution (UTMs
all NULL); help-seeking signals (tutorial rewatches, help opens, abandoned/empty bug reports)
as first-class frustration events.

## Constraints (inherited from T7510)

- Aggregates-only in-house analytics (`feedback_analytics_in_house_aggregates_only`): counts +
  latest, NEVER per-event rows in shared PG stores; per-event detail only in per-user
  `user_action_log`.
- Impersonation leaves no footprint on any new counter (`get_current_impersonator_id` guard).
- Gesture-based emission only — no reactive `useEffect` → write.

## Related

- **T7510** (parent): attempt/outcome/failure taxonomy — this task extends its dashboard with
  the mid-funnel frustration layer. Reuse T7510's `record_milestone(reason=)` mechanism and the
  extended `daily_counters`/`user_actions` aggregates.
- **T7480** (client failure beacon), **T7560** (bug-report recent-client-errors ring buffer):
  shared transport for tier 4.
- **T7540** (tag-trap): the canonical case tier 3 would have surfaced.
