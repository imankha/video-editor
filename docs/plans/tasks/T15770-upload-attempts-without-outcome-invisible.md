# T15770: Uploads that start and never record an outcome are invisible to the success rate; 4 of 12 build-7102 uploaders, all on mobile

**Status:** WIP
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Production incident 2026-11-04 (bugs first), see PLAN.md

## Source

Read-only prod pull 2026-11-09 (`user_actions`, `upload_failures`, `daily_counters`) while
confirming the 54% upload success shown for build #7102 (7705c3f, prod v308, deployed 2026-11-03).
The 54% itself reconciles exactly (44 `game_upload_succeeded` vs 38 `game_upload_failed`; 36 of the
38 are cometlawal's T15020 collision). This task is about what that number does NOT count.

## Problem

Four of the twelve users who tried an upload on build 7102 have `*_upload_attempted` rows and no
outcome at all: no `*_uploaded`/`*_upload_succeeded`, no `*_upload_failed:*`, no `upload_failures` row.

| User (signup) | Platform | Attempted | Outcome |
|---|---|---|---|
| liligvball29 (2026-11-03) | webapp-mobile | 14 clip attempts at 05:15 UTC | none; came back at 16:10 the same day, still nothing |
| daniel.cassidy7 (2026-11-04) | webapp-mobile | 2 clip attempts | none |
| yeremyking17 (2026-11-04) | webapp-mobile | 1 game attempt (game_created, file selected) | none |
| holly.schwendinger (2026-11-08) | webapp-mobile | 1 clip attempt | none |

All four are mobile. Two mechanisms make them invisible:

1. **The abandonment reaper runs only when the user re-opens the upload surface.**
   `GET /api/games/pending-uploads` (`list_pending_uploads`, `games_upload.py:1168`) is the only
   writer of `user_abandoned`, and the frontend calls it only from `useGameUpload.js:34`. A parent who
   never comes back to Add Game never produces a failure row. liligvball29 came back and still has
   none, so either the upload surface was not opened or the attempts left no `pending_uploads` row
   (prepare answered `exists` and the client went idle: the T15440 shape).
2. **The rate's denominator is `succeeded + failed`, not `attempted`.** `admin.py:2696`
   (`upload_success_pct`) and the pulse card divide by recorded outcomes. An attempt with no outcome
   lowers nothing. `*_upload_attempted` is already booked at prepare (`games_upload.py:455`), so the
   data to count them exists.

Server logs cannot answer what happened: prod's `/tmp/logs/app.log` starts 2026-11-09 06:03 UTC (the
machine was relaunched then, `fly machine status 843e15c2d26718`) and the disk is ephemeral (T12890).

## Solution

Two parts; the first is the measurement fix, the second the product fix. Design note first (the
reaper touches per-profile SQLite under the JIT seam, see persistence-sync.md; the attempted counter
has known over-counts documented at `games_upload.py:440-453`).

1. **Count attempts without an outcome as not-succeeded.** The builds table, the Journey upload stage
   and the pulse card report `succeeded / attempted` (or show "N started, no outcome" beside the
   existing rate). Attempts are already recorded per user and per day; no new telemetry.
2. **Record the abandonment without waiting for the user to come back to Add Game.** Options for the
   design note: run `list_pending_uploads`' reap at login (bootstrap) as well as on the upload surface;
   or a server sweep inside the existing hourly `cleanup._do_cleanup()` loop that reaps
   `pending_uploads` rows older than the liveness window for profiles it can open without blocking.
   Either way the outcome is the existing `user_abandoned` row through the one writer (T10270 F3).
3. **Find the mobile cause.** Reproduce liligvball29's shape on an iPhone: pick clips whose hashes are
   already on the server (prepare answers `exists`) and pick clips that are new; confirm whether the
   modal goes idle (T15440) or Safari suspends the tab mid-upload. Fix lands in T15440 if it is the
   `exists` path; file a new task if it is tab suspension.

## Acceptance Criteria

- [ ] The admin builds table and the pulse card show an upload success rate whose denominator includes attempts with no recorded outcome (or show the no-outcome count next to the rate); the build-7102 row changes accordingly.
- [ ] An upload that stops without an outcome produces a terminal `user_abandoned` `upload_failures` row within 24 h without the user re-opening Add Game (test: prepare, no parts, no finalize, next login or sweep -> row exists).
- [ ] The four users above are listed (by the admin Users filter from T14740 or the upload-failures list) as attempted-no-outcome.
- [ ] One documented reproduction on iPhone Safari of an attempt that leaves no outcome, with its cause named (T15440 or a new task).

## Context

### Evidence
- Prod pull output (local, gitignored): `C:\Users\imank\AppData\Local\Temp\claude\1ca763295c075470\edbe40a9-7c69-4c77-8847-76151d3edf93\scratchpad\prod_upload_failures.txt`
- Cohort rows: `user_actions` for users created >= 2026-11-03 (query in the session that filed this task).

### Related Tasks
T15020 (the 36 collision failures), T15440 (mobile `exists` leaves the modal idle), T15050 (flow id tracing, not yet in prod), T12890 / T10350 (log retention; the logs that would have answered this are gone), T14800 (Journey "Upload started" stage), T9000 (failure matrix).

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games_upload.py` (`prepare_upload` attempted milestone ~L440-457; `list_pending_uploads` reaper L1168-1290)
- `src/frontend/src/hooks/useGameUpload.js` (L34, the only `listPendingUploads` caller)
- `src/frontend/src/services/uploadManager.js` (`listPendingUploads` ~L1819)
- `src/backend/app/routers/admin.py` (`upload_success_pct` ~L2696; builds table ~L3285; pulse card ~L3400-3530)
- `src/backend/app/analytics.py` (`add_upload_outcome` L1536)
- `src/backend/app/services/upload_failures.py` (one writer, F1-F5 fence)
- `src/backend/app/services/cleanup.py` (hourly loop, if the sweep option is chosen)
- Knowledge: `.claude/knowledge/backend-services.md` (Upload-failure observability T10270, T15020, T15050), `.claude/knowledge/persistence-sync.md` (JIT seam)
