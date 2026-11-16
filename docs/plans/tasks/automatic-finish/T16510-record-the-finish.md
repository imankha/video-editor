# T16510: Record the finish

## In plain words

A highlight (a finished short clip) only reaches the Highlights tab when the parent taps Finish, and today nothing is recorded when they do. The admin Journey guesses instead: it counts a highlight as finished when a spotlight is rendered. On 2026-11-14 that guess was hiding the largest loss in the product: 42 of 72 exported highlights were never finished, and the Journey showed the step as healthy. We will record the real moment a highlight is finished, and have the Journey's Finished stage count that. It comes first in the epic so the loss is on the chart before the fix ships. Done when the Journey's Finished count for a test account matches the number of highlights in its Highlights tab.

**Status:** WIP
**Impact:** 7
**Complexity:** 2
**Created:** 2026-11-14
**Updated:** 2026-11-14
**Milestone:** Automatic finish (see [EPIC.md](EPIC.md)). Task 1 of 4.

## How we got here

Frame is the step where the parent crops around their athlete and pays to sharpen the result; Spotlight draws a circle around their athlete. The Journey's "Finished highlight" stage was defined before Finish was a separate tap, when rendering a spotlight was the last thing a parent did. The 2026-11-14 read of production accounts ([evidence](../../bi/finish-step-evidence-2026-11-14.md)) had to open every account's own database to find out who had finished, because the shared analytics could not say.

## The problem

The stage is wrong in both directions. A highlight with a rendered spotlight that was never finished counts as finished (11 of them). And the 31 sharpened highlights that never went further do not show as a loss at this step, because the stage before it was only measured from 2026-11-04.

## What we will do

1. Record an event at the moment a highlight is finished, on the server, where the finish is saved.
2. Make the Journey's Finished stage count that event.
3. Mark the stage as measured from the day this ships, the way other late-instrumented stages are marked, so older sign-ups are not read as losses.

## Why this and not something else

Reading every account's database, as the 2026-11-14 pull did, is too slow to repeat for a chart. Filling in history was considered and left out: the per-account databases already hold the truth for old highlights, and the evidence file records the baseline.

## How we will know it worked

- [ ] Finishing a highlight on staging, with or without a spotlight, adds one finish event for that account.
- [ ] Rendering a spotlight without finishing adds none.
- [ ] The Journey's Finished stage for a test account equals the number of highlights in its Highlights tab.
- [ ] The stage shows the date its data starts.

## For the implementer

### Relevant files
- `src/backend/app/services/publish_final_video.py` - the single publish writer; the event belongs at its success point.
- `src/backend/app/routers/downloads.py` - `POST /api/downloads/publish/{project_id}`.
- `src/backend/app/analytics.py` - `FLOW_EVENTS`, `JOURNEY_LADDER` (the `finished` stage reads `overlay_exported` today), `EVENT_INSTRUMENTED_AT`, `SPORT_TAG_INSTRUMENTED_AT`.
- `src/backend/tests/test_analytics_dashboards.py`, `src/backend/tests/test_t14710_frame_export_events.py` - neighbouring tests.

### Notes
- Knowledge docs: `export-pipeline.md`, `backend-services.md`.
- No Postgres migration: a new action name is a new free-text row in `user_actions`.
- The stage key `finished` is frozen (inspector URLs, rollup rows); only its `actions` change.
- Impersonated sessions must not record it (existing `record_milestone` guard).
