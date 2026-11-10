# T15840: A game upload survives a network drop without the parent doing anything

## In plain words

Today, when a parent's connection drops for a few seconds during a game upload, the whole upload fails and they see an error. Fifteen parents lost uploads this way, almost all on files of two to ten gigabytes that died after four to seven minutes. The server already remembers which parts arrived, but the app only uses that memory if the parent comes back and picks the same file again. We will have the app pause when the network goes away, wait up to about ten minutes, and continue from where it was once the connection returns, with nothing for the parent to do. Done when a simulated thirty-second outage mid-upload finishes on its own and the network and timeout failures per hundred attempts fall.


**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 4, Big-file upload (see PLAN.md)

## How we got here

Prod `upload_failures` 2026-11-09: 12 users with `network` and 3 with `timeout` terminal game
failures; they cluster on 2 to 10 GB desktop files that died after 200 to 400 s (3.4 GB at 409 s,
5.7 GB at 262 s, 3.1 GB at 371 s and 215 s). Of 246 successful game uploads, 202 were under 1 GB and
2 were over 6 GB. Big files almost never land, and the recorded reason is one blip, not the file.

## The problem

Resume state exists (PATCH /parts, T15030 / T15130) but is used only when the user comes back and
re-picks the file. A transient loss of connectivity or a single failed part fails the whole upload
and the parent sees a terminal error.

## What we will do

1. In `uploadManager.js`, a failed part retries with backoff for a bounded window (for example up to
   10 minutes), listening to `online` / `offline` and `visibilitychange`; the UI shows "Paused, waiting
   for connection" rather than failing.
2. On reconnect the manager re-prepares (T15040 answers `in_progress` or `resume`) and continues from
   the recorded parts; parts already on R2 are never re-sent.
3. If the window expires, the failure is terminal as today, with the parent copy from T14530 and the
   file left resumable on the next pick.
4. `upload_failures` gains `resumed_after_drop` in the lifecycle lines (T15050 flow id) so the effect
   is measurable.

## How we will know it worked

- [ ] Playwright with a mocked network drop of 30 s mid-upload: the upload pauses, resumes, and finishes without the user acting; no duplicate parts (server-side count matches parts_total).
- [ ] A drop longer than the window yields the existing terminal failure with parent copy.
- [ ] Prod `network` and `timeout` terminal game failures per 100 attempts fall against the 2026-11-09 baseline after one deploy, read from the upload-failures admin list.

## For the implementer

### Related Tasks
T15030, T15040, T15130 (resume state and liveness), T15050 (flow id), T14530 (error copy), T15780
(size pre-flight), T8865 (make highlights before the whole upload finishes), T15850 (shrink spike).

### Relevant Files (REQUIRED)
- `src/frontend/src/services/uploadManager.js`
- `src/frontend/src/hooks/useGameUpload.js`
- `src/backend/app/routers/games_upload.py` (prepare, parts, finalize)
- `src/backend/app/analytics.py` (`game_upload_failed:*` reasons)
