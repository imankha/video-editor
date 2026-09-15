# T10010 — Activation metrics & funnel instrumentation (measurement deliverable)

This is the decision/measurement artifact the source brief (T25/EP06) asks for:
the explicit activation definitions, the cohort queries, and the privacy
guardrails. It is a MEASUREMENT spec, not a new parent-facing screen (the brief's
own "Proposed replacement copy" says none is required).

## What was instrumented (and what already existed)

All events route through the EXISTING aggregates-only mechanism — no new Postgres
table/column, no external vendor:

- **Server-side gestures** already fire `record_milestone(...)` at their durable
  backend point (unchanged): `game_created` (upload attempt), `game_upload_succeeded/failed`,
  `clip_created` (play/highlight saved), `export_started` (accepted), `export_completed`
  (succeeded), `export_failed`, `share_attempted` (share intent), `share_completed`
  (publish), `credit_purchased`, etc. See `app/analytics.py FLOW_EVENTS`.
- **Client gestures with no natural endpoint** are NEW (T10010), beaconed via
  `POST /api/telemetry/funnel-event` → `record_funnel_event` → `record_milestone`:
  `framing_point_added`, `preview_started`, `draft_saved`, `result_opened`,
  `playback_started`, `result_viewed`, `result_reopened`. All are engagement
  dimensions (`daily_col=None`) — a new free-text row in the per-`(user,action,platform)`
  `user_actions` aggregate + the per-user `user_action_log` detail trail.

Reconciliation with the brief's proposed names (reuse, don't duplicate):

| Brief event | Repository event |
|---|---|
| signup_completed | `create_user_segment` signups counter + `session_started` |
| upload_started / succeeded / failed | `game_created` / `game_upload_succeeded` / `game_upload_failed` |
| play_saved, highlight_created | `clip_created` (and `clip_uploaded` for direct uploads) |
| framing_opened | `framing_opened` (bridged from `opened_framing_editor`) |
| framing_point_added, preview_started | **NEW** (client beacon) |
| export_accepted / succeeded / failed | `export_started` / `export_completed` / `export_failed` |
| result_opened, playback_started, result_viewed | **NEW** (client beacon) |
| draft_saved, result_reopened | **NEW** (client beacon) |
| share_intent | `share_attempted` |
| publish_succeeded | `share_completed` |

Historical series (e.g. the ~5-exporters-per-100-signups baseline) are NOT
redefined — the existing keys/labels/columns are untouched, so their time series
stay continuous. The new activation metric is reported SEPARATELY (below) until
the historical denominator/window is formally reconciled.

## The "viewed" convention (a measurement, not a satisfaction claim)

`result_viewed` fires only when actual playback crosses a stated threshold, so a
bare load / autoplay-then-bail is never counted as a watch:

> **viewed** = ≥ 2.0s of playback for a clip long enough to afford it (≥ 4.0s),
> otherwise ≥ 50% of its duration.

Encoded once in `app/analytics.py is_playback_viewed()` and mirrored on the client
in `utils/funnelEvents.js computeViewed()`. The client only beacons a genuine
view; the server RE-VALIDATES with the same rule, so an optimistic/malformed
beacon can't inflate activation.

Render validation (`export_completed`) and actual playback (`result_viewed`) are
DIFFERENT events: a rendered highlight nobody watched is NOT activated. Publishing
(`share_completed`) is a separate, later fact — never conflated with "sent" or
"watched".

## Activation definitions (both explicit; baseline kept separate)

Cohort = completed signups in a window, keyed by anonymous `user_id`
(`user_segments`, which carries `created_at`/origin, no child-identifying data).

- **Primary (7-day, person-level, playback-validated):**
  unique signups with ≥ 1 `result_viewed` within 7 days of signup ÷ all eligible
  completed signups in the cohort.
- **Secondary (24-hour):** identical, with a 24h window. Reported alongside, never
  merged into the 7-day number.
- **Historical baseline (kept separately labeled):** the pre-existing
  export-based series (`export_completed` per signup). NOT silently merged into the
  new metric — the denominator/window differ and are reconciled in a later,
  separately-scoped task.

### Dedup / join contract (THE headline requirement)

Three renders of one highlight by one person = ONE activated person, NOT three:

```sql
-- Person-level activation numerator: COUNT(DISTINCT user_id), never SUM(count).
-- user_actions has ONE row per (user_id, action, platform); a person who watched
-- one highlight validated three times still contributes exactly one distinct
-- user_id here.
SELECT COUNT(DISTINCT ua.user_id) AS activated
FROM user_actions ua
JOIN user_segments s ON s.user_id = ua.user_id
WHERE ua.action = 'result_viewed'
  AND s.created_at >= now() - INTERVAL '7 days';
```

Finer joins (per **person / highlight / edit-revision / job**) are available in the
per-user `user_action_log` detail trail (SQLite), whose `context` carries the
coarse IDs (`highlight_id`, `clip_id`, `export_id`, `job_id`, `revision`,
`result_id`) — the brief's join keys — WITHOUT any Postgres schema change. Example
(per-user, admin read, never on a hot path):

```sql
SELECT json_extract(context, '$.highlight_id') AS highlight,
       COUNT(*) AS validated_views
FROM user_action_log
WHERE action = 'result_viewed'
GROUP BY highlight;
```

### Denominator & exclusions

- Denominator = completed signups in the cohort window (`user_segments`).
- **Internal/test accounts excluded** the same way every existing dashboard does
  (impersonation writes nothing — `record_milestone`/`record_funnel_event` carry
  the T1515 guard; internal-origin/test users are filtered at read time by the
  existing admin analytics exclusion, not re-invented here).
- Long-tail: an idle user only activates when they next come online — same
  by-design property as the rest of the funnel; not a gap.

## Privacy guardrails (acceptance criterion 4)

The instrumented data **excludes child names, raw video content, recipient emails,
and free-text report content.** Enforced structurally, not just documented:

- Postgres (`user_actions`, `daily_counters`) stores only the action KEY + a count
  — never a name/email/text.
- The client beacon's `context` is stripped server-side to a fixed allow-list
  (`FUNNEL_CONTEXT_ALLOWED_KEYS` in `app/analytics.py` — coarse IDs, bucket slugs,
  and durations ONLY). Any other key the client sends is DROPPED before the write;
  IDs are length-capped, numerics coerced. `_sanitize_funnel_context` is covered by
  a test that pins the drop of `child_name` / `recipient_email` / `report_text`.
- Call sites pass IDs/durations only — no names, emails, or free text leave the
  browser.

## Deviations / open items

- **T9950 (Focus/framing simplification) has NOT landed** (blocked at an Architect
  design gate) despite the kickoff assuming it would. `framing_point_added` is
  wired onto the CURRENT manual-crop gesture (`FocusContainer.handleCropComplete`),
  which is the semantically stable "user positioned the focus box" action;
  `preview_started` is wired onto the stable draft-preview gesture
  (`DraftTile` body-tap on a ready reel). If T9950 reshapes those surfaces, RE-VERIFY
  both call sites (flagged in-code). No other event depends on T9950.
- `automatic` / `wide` framing paths: `framing_point_added` currently tags
  `path: 'manual'` (the only path the current UI exposes via a manual crop drag).
  Add `automatic`/`wide` tags if/when those paths gain distinct gestures.
- Media-load failure for a result is already captured by the existing
  `POST /api/client-errors/video` beacon; `playback_started` marks the successful
  begin, so the two together give load-success vs load-failure without a new field.
