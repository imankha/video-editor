# T7510: Activity tracking: attempted vs successful, everywhere

**Status:** STAGING
**Priority:** P1 (observability: the dashboard actively misled a prod incident diagnosis)
**Impact:** 7
**Complexity:** 5
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

The admin activity/journey views present INTENT events as ACCOMPLISHED FACTS. The 2026-08-24
investigation of two prod accounts proved the cost: the dashboard showed "annotated clips
and game uploads" for users whose accounts held zero durable content, sending diagnosis down
a data-loss rabbit hole when the truth was "everything they attempted failed."

Concretely, today's vocabulary lies:

- **`game_created`** fires when the pending placeholder row is inserted, BEFORE a single
  byte is uploaded (`uploadManager.js` createGame -> onGameCreated). It reads as "uploaded a
  game" but means "started trying to."
- **`annotation_completed`** fires from `POST /api/games/{id}/finish-annotation` purely
  because `viewed_duration > 0`, i.e. "left annotate mode having watched some video." It has
  nothing to do with clips existing. (It even fired against already-deleted games; T7500
  fixes that half.)
- **`clip_rated` / `played_annotations`** achievements are frontend-fired off UI state
  (`questAchievements.js`), with no persisted clip required.
- The one honest signal that existed (`daily_counters.clips_created` = 0 on both days) is
  not surfaced anywhere an admin would see it next to the milestones.

The deeper principle, per user direction 2026-08-24: **tracking what users ATTEMPTED is just
as important as tracking what SUCCEEDED, and the two must never be conflated.** Attempts
tell us where users are trying to go; successes tell us whether the product got them there;
the GAP between them is precisely where the product is failing, and it is currently
invisible (5 failed uploads across 2 users produced dashboards indistinguishable from
success).

## Solution

Design-gated (Architect): an event taxonomy pass over the whole funnel, then the dashboard
surfaces the attempt/success/failure distinction. Target shape:

1. **Taxonomy: every funnel action gets an explicit outcome dimension.** For each tracked
   action (game upload, annotation session, clip creation, framing export, overlay export,
   publish, share, move, payment): an ATTEMPT event at gesture time, and an OUTCOME
   (succeeded / failed with reason) at the durable completion point, defined as the point
   where the result provably persists (e.g. finalize-upload success after R2 confirms, clip
   row committed, publish durably synced). Never emit success from intent-side code paths.
   Existing event names keep firing during a transition window if renaming breaks
   continuity; the design decides rename-vs-augment per event.
2. **Failure reasons are first-class.** A failed attempt carries a coarse machine-readable
   reason (timeout, network, refused, sync_failed, user_abandoned/unknown) so "what did
   users try that didn't work" is queryable per reason. T7480's failure beacon feeds the
   upload reasons.
3. **Dashboard: attempted vs completed, side by side.** The journey/actions admin views and
   the funnel/pulse views render attempts and completions as distinct columns/series, with
   the conversion gap visible per action type. A user like bigajosue must read as "attempted
   4 uploads, 0 succeeded, paid $3.99, lost" at a glance.
4. **Milestones/quests bind to OUTCOMES, not attempts.** `record_milestone` calls move to
   the durable completion points (aligned with T7500's rule: no milestone without a real
   write). Frontend-fired achievements either move server-side to outcome points or are
   explicitly labeled as UI-engagement signals in the dashboard, distinct from content
   outcomes; the design decides per achievement.

## Frustration-signal requirements (measurement review, 2026-08-24)

Retrospective from the funnel investigation: attempt/outcome covers the funnel's ENDPOINTS,
but frustration lives in the middle (refusals, errors, repetitions) and that middle layer
has zero instrumentation today. The design must also cover, ranked by investigation cost:

1. **Interaction-outcome pairs on critical CTAs** (Add Game, Add Clip, Save Clip,
   Create Reel/Export, Share, Pay): clicked -> next stage reached (picker opened / form
   saved / job started) or failed(reason). Without this, "tapped and nothing happened"
   (bug #18) is indistinguishable from "never tapped" - the exact ambiguity that kept the
   mobile cliff a hypothesis instead of a verdict.
2. **Client error capture**: ring buffer of console.error / window.onerror / unhandled
   rejections, flushed via the T7480 beacon channel + attached to bug reports (T7560).
   A mobile Safari exception currently leaves zero server trace.
3. **Blocking-dialog and error-toast impressions** (name + per-session count): the T7540
   tag-trap would have been visible as "Tag not submitted shown 5x, clips saved 0". A
   repeated refusal impression in one session is a near-direct frustration measurement.
4. **Session exit breadcrumbs**: last screen + per-screen dwell, written to the user's
   own user_action_log (per-event detail belongs in user.sqlite; PG stays aggregate).
   Bug reports' `actions` array proves the value - it is the only place this trail exists
   today, and only when someone complains.
5. **Derived frustration flags in the admin journey view**: retry-burst (same action >=3x
   within 60s), repeat-visit-no-progress (returned to a stage, no new durable outcome),
   rapid-fire bursts. All three existed in raw timestamps (bigajosue 3 uploads/29s,
   lisagee 13 events/31s, cschwartz 4 visits/0 clips) and required a human to find.

Second tier: real device/UA/touch capture once per session (replace the viewport-width
guess); pin viewed_duration semantics (accumulated vs furthest position); acquisition
attribution (UTMs all NULL - frustration cannot be tied to the promise that recruited the
user); help-seeking signals (tutorial rewatches, help opens, abandoned/empty bug reports)
as first-class frustration events.

## Context

### Constraints (binding)
- Analytics stack rules (user decision 2026-08-20, memory
  `feedback_analytics_in_house_aggregates_only`): in-house only, no external SDKs;
  aggregates (counts + latest), NOT per-event rows; any NEW analytics state goes in
  analytics.sqlite, not new Postgres tables. The attempt/outcome split therefore lands as
  new counter dimensions (e.g. `game_upload_attempted` / `game_upload_succeeded` /
  `game_upload_failed:{reason}` counters), not an event-log rewrite. Existing tables
  (`user_actions` PG aggregate, `user_action_log` in user.sqlite, `daily_counters`) are
  extended, not paralleled (leverage existing systems rule).
- The success-criteria scorecard (T7460, memory `project_success_criteria_targets`)
  consumes activation/export metrics; renames must not silently break its inputs.

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - counters, milestone recording
- `src/backend/app/routers/admin.py` - journey ~1184-1246, user actions ~1250-1288, funnel
  ~886, pulse ~1325 (the views that must show attempted vs completed)
- `src/backend/app/routers/games.py` - finish_annotation milestone site
- `src/backend/app/routers/games_upload.py` - finalize_upload (the real upload success
  point)
- `src/frontend/src/services/uploadManager.js` - game_created emission site
- `src/frontend/src/utils/questAchievements.js` - frontend-fired achievements
- `src/backend/app/services/user_db.py` - user_action_log / daily_counters helpers
- Admin frontend dashboard components rendering journey/actions/funnel

### Related Tasks
- Upload Failure Integrity epic (T7470-T7500): fixes the failures themselves and stops
  false success events; this task makes the attempt/success distinction structural
- T7480 specifically: its client failure beacon is the transport for upload failure reasons
- T7460 (RAG scorecard): downstream consumer, keep inputs stable
- **T7400 (Investor-Grade Analytics epic — analytics.sqlite store + rollup):** this task is
  NOT a child of that epic (different trigger — a P1 diagnostic-honesty bug, not a growth
  report — and a much larger blast radius across live product code, not read-only reports)
  but the two are bound by the same "extend existing systems, aggregates-only" constraint
  and will physically touch the same store. **Before landing new counter dimensions
  (`game_upload_attempted`/`_succeeded`/`_failed:{reason}` etc.), reuse T7400's
  `analytics_store.py` module and its `PRAGMA user_version`/etag-assert R2 conventions
  rather than inventing a second aggregate store or bolting new columns onto
  `daily_counters` independently** — the design doc should confirm whether T7400 has
  landed first (its store didn't exist as of this task's filing) and pick a schema that
  doesn't collide with `rollup_action_weekly`/`rollup_engagement_monthly`.

### Technical Notes
- Emission sites must respect the impersonation guard (`get_current_impersonator_id`):
  admin impersonation leaves no footprint, including on the new attempt/outcome counters.
- Outcome events on the backend fire inside existing gesture-originated request flows or
  their durable completion callbacks; no reactive useEffect emissions on the frontend.
- "Durable completion point" must follow the persistence knowledge doc's definitions (e.g.
  publish success = durable sync reported OK, not handler-reached).

## Implementation

### Steps
1. [ ] Inventory every current emission site (event name, fires-on, intent-or-outcome) into
       a table in the design doc
2. [ ] Architect design: taxonomy (attempt/outcome/reason per action), storage shape within
       the aggregates-only constraint, dashboard changes, migration/continuity plan.
       USER APPROVAL GATE.
3. [ ] Implement backend emission changes + analytics.sqlite counter dimensions
4. [ ] Implement dashboard attempted-vs-completed views
5. [ ] Verify: replay the bigajosue scenario on staging (failed uploads + annotate) and
       confirm the dashboard reads as attempts-without-success

## Acceptance Criteria

- [ ] Design doc approved by user before implementation
- [ ] No success/milestone event fires from an intent-side code path anywhere in the funnel
- [ ] Failed attempts are queryable with reasons; the admin journey view for a user shows
      attempted vs completed per action type
- [ ] A staging replay of the incident scenario renders honestly (attempts visible, zero
      completions, failure reasons present)
- [ ] Impersonation leaves no footprint on any new counter
- [ ] T7460 scorecard inputs unaffected or migrated in the same change
- [ ] Tests pass; CI green
