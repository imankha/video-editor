# T14710: Pressing "Sharpen my highlight" in Frame records no analytics event, so the Journey shows "Pressed Export 0"

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M
**Created:** 2026-11-03
**Updated:** 2026-11-03

User report 2026-11-03 (admin Journey map, prod): "why is Pressed Export 0".

**Runs after the Copy audit milestone (T14500-T14670).** Words in this ticket follow the copy
glossary ([copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md)): the paid AI step in Frame is
**Sharpen my highlight** (T14620 renames the button from "Generate highlight"; revised 2026-11-03 from "Make highlight", which now names the button that starts a highlight; code names like
`export_started`, `ExportButtonContainer` and `/api/export/render` do not change). T14720
renames the Journey stage "Pressed Export" to "Pressed Sharpen my highlight"; this ticket only fixes
the data behind it. Before you start:
- T14540 edits the `HTTPException` detail strings in `routers/export/framing.py` and
  `routers/exports.py`, and T14530/T14620 edit `ExportButtonContainer.jsx` and `exportStore.js`.
  Line numbers below are from master `04b4c0962`; re-grep, don't trust them.
- If a test you add asserts on an error message from `render_project` (409 / 402), assert on the
  status code and `detail.error` key, not on the wording T14540 rewrote.

## Problem

On the admin Journey map, **Pressed Export** reads 0 for every filter, while the stages on either
side have real counts (Moved framing window 77, Exported 28). The count is not a fold bug: the
event behind that stage is never written to the database by the export the app actually uses.

How a stage gets counted: each Journey stage lists the `user_actions` rows that mean "this user
reached it" (`JOURNEY_LADDER` in `src/backend/app/analytics.py`). **Pressed Export** is
`export_started`; **Exported** is `export_completed`.

What a code read on 2026-11-03 found (confirm each with your own grep before changing anything):

1. `export_started` is written by `record_milestone(...)` in only one place:
   `src/backend/app/routers/exports.py` `start_export` (`POST /api/exports`). That is the legacy
   job route. The Frame screen's paid button (Sharpen my highlight) calls `POST /api/export/render`
   (`src/frontend/src/containers/ExportButtonContainer.jsx`, `endpoint = .../api/export/render`),
   handled by `render_project` in `src/backend/app/routers/export/framing.py`, which records nothing.
2. The frontend also calls `track('export_started')` in `src/frontend/src/stores/exportStore.js`,
   but `track()` (`src/frontend/src/utils/analytics.js`) only sends to Cloudflare Zaraz / the CF
   beacon. It never reaches our `user_actions` table. (Only events in `CLIENT_FUNNEL_EVENTS`
   reach it, through the funnel beacon, and `export_started` is not one of them on purpose: it has
   a natural server endpoint.)
3. The same gap probably applies to **finishing** a Frame export: `export_completed` and
   `framing_exported` with `type: "framing"` are only written in
   `src/backend/app/services/export_worker.py` (the legacy job worker). If the `/render` path
   never records them, then today's "Exported" count (renamed "Highlight made" by T14720) is really overlay (Spotlight) exports
   (`routers/export/overlay.py` line ~142) plus recovered jobs, not Frame exports. Verify this:
   it changes what "Exported 28" means.

## Solution

Record the events at the backend point where each gesture becomes durable, using the existing
`record_milestone(user_id, event, context)` helper. No new events, no schema change, no migration
(`user_actions` is a free-form `(user_id, action, platform)` aggregate).

- `export_started`: in `render_project`, **after** the in-flight guard
  (`insert_export_job_if_none_active`) and the credit check succeed, so a double-click (409) or
  an insufficient-credits response (402) is not counted as a press. Context:
  `{"export_id": export_id, "type": "framing"}`, the same shape the legacy route uses.
- `export_completed` + `framing_exported`: at the point the `/render` pipeline marks the job
  complete (follow `_export_clips` from `render_project` to where the export_jobs row becomes
  `complete`). Mirror the two calls in `export_worker.py` lines ~193-194 exactly.
- Decide with the reviewer whether the overlay render (`render_overlay`, `POST
  /api/export/render-overlay`) should also record `export_started`. The legacy route recorded it
  for every export type. Write the decision in the Progress Log.

Use `get_current_user_id()` captured at request start (`captured_user_id` in `render_project`).
Background code cannot read the request context later, which is why that variable exists.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/export/framing.py` - `render_project` (`POST /api/export/render`): add `export_started`; find the completion point
- `src/backend/app/routers/export/overlay.py` - `render_overlay` and the overlay `export_completed` call (reference for the pattern)
- `src/backend/app/services/export_worker.py` - lines ~193-194: the legacy completion calls to mirror
- `src/backend/app/routers/exports.py` - `start_export`: the only current `export_started` writer (reference)
- `src/backend/app/analytics.py` - `record_milestone`, `FLOW_EVENTS`, `JOURNEY_LADDER`, `EVENT_INSTRUMENTED_AT`
- `src/backend/tests/test_analytics_journey_endpoint.py`, plus the existing export render tests (find them with `grep -rln "export/render" src/backend/tests`)

### Related Tasks
- Runs after: the Copy audit milestone, especially T14540 (server error text in the same routers) and T14620 (the paid button becomes "Sharpen my highlight")
- Related: T14720 (Journey counts strictly decreasing, and the stage relabel). Independent; this one goes first.
- Original stage design: [admin-journey-dropoff-design-2026-10-30.md](../admin-journey-dropoff-design-2026-10-30.md) Section 5.1

### Technical Notes
- `record_milestone` already skips admin impersonation (T1515). Don't add your own check.
- `EVENT_INSTRUMENTED_AT["export_started"]` says `2026-06-04`, but the event has effectively not
  been recorded since Frame moved to `/render`. After this fix, change it to the date this lands
  in prod, so the map badges older signup windows "data from ..." instead of showing a false 0.
  Do the same for `export_completed` / `framing_exported` if item 3 is confirmed. Find when
  Frame moved to `/render` with `git log -S "api/export/render" -- src/frontend/src/containers/ExportButtonContainer.jsx`
  and write it in the Progress Log.
- Past data is not backfilled. The fix only counts exports from now on.
- Backend tests TRUNCATE the dev Postgres. Warn before running them on a machine where someone
  is using dev data.

## Implementation

### Steps
1. [ ] Grep to confirm findings 1-3 above; record the results in the Progress Log
2. [ ] Write a failing backend test: calling `POST /api/export/render` for a valid project writes an `export_started` row in `user_actions` for that user (and, if item 3 is confirmed, a successful render writes `export_completed` and `framing_exported`)
3. [ ] Add a test that a 409 duplicate click and a 402 insufficient-credits request do NOT write `export_started`
4. [ ] Add the `record_milestone` calls
5. [ ] Update `EVENT_INSTRUMENTED_AT`
6. [ ] Run the relevant tests (named files only, not the full suite) and lint (`ruff check` on changed files)

### Progress Log

**2026-11-03 (funnel walk-through, not started):** Confirmed on master `5020e2526`: `grep -rn record_milestone src/backend/app/routers/export/framing.py src/backend/app/routers/export/multi_clip.py` returns nothing, so the live render path records no `export_started`, `export_completed` or `framing_exported`. A fresh `empty`-preset account that framed, generated (Modal, 131 s), added a spotlight and finished produced this `[Analytics] Recorded` sequence: `framing_opened, framing_point_added, crop_adjusted, credits_consumed, overlay_offered, overlay_opened, overlay_players_assigned, export_completed (type overlay, from overlay.py:142), overlay_exported, share_completed, video_downloaded`. So **Exported counts Spotlight exports only**, and every parent who sharpened a highlight and skipped Spotlight is shown as lost at Moved framing window (prod 2026-11-03: 77 reached, 42 lost). `credits_consumed` (`credit_ledger.py:559`) is the one event the paid render already records and is a usable proxy for a historical re-read once this lands. Journey ranking context: docs/plans/PLAN.md "Funnel fall-off order" section.


**2026-11-04 (implemented):** Findings 1-3 confirmed by grep. `record_milestone` had no call in `framing.py` or `multi_clip.py`; the frontend `track('export_started')` never reaches `user_actions`. Frame has posted only `/api/export/render` since T11240 (`e83ba246c`, 2026-09-27), and `git log -S` shows the route already in `ExportButtonContainer.jsx` at `82531fcc7` (2026-02-10), so the legacy route stopped carrying Frame presses no later than 2026-09-27.

- `export_started`: recorded in `render_project` after the credit block, so 409, 402 and every other 4xx write nothing. A zero-credit render still counts.
- `export_completed` + `framing_exported`: recorded in `_export_clips` (Modal branch after finalize, local branch after the sync gate), not in `_run_render_background`, which cannot tell success from the 503 `sync_failed` return. `/api/export/multi-clip` shares the pipeline and has no caller in `src/frontend`, `e2e` or `scripts`.
- No double count: when a recovery poll wins the finalize CAS it has already written `export_completed` (type `recovered`), so the in-band loser records nothing. That recovered export has no `framing_exported`, matching the T8230 comment in `admin.py`.
- **Overlay decision:** `render_overlay` does NOT record `export_started`. This stage means "pressed Sharpen my highlight" (T14720 label), and Spotlight is a different, later button; counting it would mark a user as having pressed Sharpen when they only pressed Spotlight. No reviewer ran in this group, so this needs the owner's confirmation at landing.
- `EVENT_INSTRUMENTED_AT` for `export_started`, `export_completed`, `framing_exported` set to 2026-11-04, the implementation date. **If prod deploys later, change these three to the deploy date.**
- Removed `client_beacon` from the `export_pressed` stage: `export_started` is server-side, so the map's "client beacon" badge was false.
- Tests avoid `pg_conn` (it truncates tables on the shared dev Postgres): they run the real `record_milestone` against an in-memory `user_actions`. `test_analytics_journey_endpoint.py` uses `pg_conn` and was NOT run; Branch CI covers it.

## Acceptance Criteria

- [ ] Pressing Sharpen my highlight in Frame writes `export_started` to `user_actions`; the Journey's Pressed Export stage (Pressed Sharpen my highlight after T14720) goes up by one for that user
- [ ] A successful Frame export writes `export_completed` and `framing_exported` (if confirmed missing)
- [ ] A rejected press (409 duplicate, 402 no credits) writes nothing
- [ ] `EVENT_INSTRUMENTED_AT` is updated so older windows show "data from ..." instead of 0
- [ ] Tests fail before the fix and pass after it
