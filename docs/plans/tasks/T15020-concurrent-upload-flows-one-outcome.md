# T15020: Two upload flows for one file collide: upload success rate read 43.8% from one user whose every file landed

**Status:** WIP
**Impact:** 9
**Complexity:** 3
**Tier:** M (backend + frontend)
**Created:** 2026-11-04
**Updated:** 2026-11-04
**Milestone:** Production incident 2026-11-04 (bugs first), see PLAN.md

## Source

Analytics alert 2026-11-04: "Upload success rate has collapsed to 43.8% (28/64 succeeded today)."
Read-only prod pull (`upload_failures`, `daily_counters`, `user_actions`) plus `/tmp/logs/app.log`
on the prod machine (Fly's live log buffer only holds the last 100 lines).

## Problem

All 68 `upload_failures` rows of the day belong to one user (cometlawal, signed up 16:33 UTC,
Chromebook) who uploaded a Veo zip of ~30 "Shot on goal" clips as clips at 17:48 UTC. Every one of
those files landed on R2 (22 `clip_uploaded`, the rest dedup hits), yet the day booked
`game_upload_failed:refused` x27, `game_upload_failed:unknown` x9, `clip_upload_failed:sync_failed`
x6 and `clip_upload_failed:r2_rejected` x5.

Mechanism, from the log (`[UPLOAD_LIFECYCLE]` per session: `prepare 1 | resume 1-2 | finalize
success 1 | finalize FAILED 1-3`; 138 prepare requests for ~30 files; exactly one page load in the
window, so not multiple tabs):

1. The empty-state Add Video button (`EmptyTabGuide` `ClipsActions`) is not disabled while a
   batch runs. The user re-picked the same zip while the first batch was uploading (and once more
   later): up to three concurrent batches of the same files.
2. The later batch raced through already-landed files via prepare's EXISTS dedup until it was in
   lockstep with the first (the per-user write lock, `WRITE_LOCK_WAIT` up to 16 s on PATCH
   `/parts`, kept every flow slow). From then on each file had two or three flows sharing ONE
   session: `prepare-upload`'s resume branch returns the existing `pending_uploads` row and
   multipart to any flow that asks for the same hash.
3. The flow that finished second: part PUTs 404 (NoSuchUpload, the first flow completed the
   multipart) -> `r2_rejected`; finalize found the row deleted -> 404 `session_not_found`, filed
   under the GAME default kind because the router had nothing to file it under ->
   `game_upload_failed:refused`; each PATCH `/parts` 404 was a terminal failure too; a finalize that
   lost the CompleteMultipartUpload race booked `sync_failed` and aborted a finished upload.

Same signature on 2026-10-27 (apexcontent, 41 rows, before the 11-02 deploy): not a deploy
regression. The genuine upload rate that day is 100% of files landed.

## Solution

Make two flows for one file converge on one durable outcome, and stop the second pick at the entry.

Backend (`app/routers/games_upload.py`):
- `FinalizeUploadRequest` gains optional `blake3_hash` + `kind`. Missing pending row -> HEAD the
  object by kind/hash: present -> 200 `{status: success, already_finalized: true}`, nothing
  recorded; absent -> 404 as before, failure filed under the client-declared kind.
- CompleteMultipartUpload failed but the object is on R2 at the declared size -> success, no
  abort, no metadata copy, row released.
- PATCH `/upload/{session}/parts` on a missing session records `terminal=False`.

Frontend:
- `uploadManager.ensureVideoInR2` sends `blake3_hash` + `kind` on finalize; a part PUT 404
  re-runs prepare once and accepts EXISTS as the outcome (a fresh session minted by that
  re-prepare is cancelled; a resumed one is left to its owner).
- `useClipUpload` queues batches on a module-level chain; `isUploading` stays true until the last
  queued batch settles.
- `EmptyTabGuide` takes `addVideoLoading`; `ProjectManager` passes `isUploadingClips`.

Not fixed here (filed as a finding): the per-user write-lock contention that made each flow slow
(PATCH `/parts` after every 5 MB part waits on the same lock as the R2 sync; `[SYNC] Upload lock
busy` thrash; one `BadDigest` on a user.sqlite PUT at 17:55:04).

## Context

### Relevant Files
- `src/backend/app/routers/games_upload.py` (`finalize_upload`, `save_upload_parts`,
  `_landed_object`, `_client_declared_kind`)
- `src/frontend/src/services/uploadManager.js` (`ensureVideoInR2`, `prepareReportsExists`)
- `src/frontend/src/hooks/useClipUpload.js` (`batchQueue`)
- `src/frontend/src/components/shared/EmptyTabGuide.jsx`, `src/frontend/src/components/ProjectManager.jsx`
- Knowledge: `.claude/knowledge/backend-services.md` (T15020 section)

### Related Tasks
- T8160 (part PUT 404 outage, UploadId aliases), T10270 (upload_failures), T8370 (clip upload),
  T13247 (zip of clips), T7510 (attempted vs succeeded)

## Acceptance Criteria

- [x] A finalize for a session another flow already finalized returns 200 with the object's size and
      records no failure (`test_missing_session_but_object_landed_is_success_not_failure`)
- [x] A genuinely lost session is still a 404 and is filed under the client's kind
      (`test_missing_session_and_no_object_records_client_kind`)
- [x] A finalize whose CompleteMultipartUpload fails but whose object landed returns 200, aborts
      nothing, releases the row (`test_complete_fails_but_object_landed_is_success`)
- [x] A PATCH `/parts` on a missing session is non-terminal
      (`test_missing_session_is_recorded_non_terminal`)
- [x] finalize-upload carries `blake3_hash` + `kind`; a part PUT 404 followed by an EXISTS prepare
      resolves the file as uploaded with no beacon (`uploadManager.concurrentFlows.test.js`)
- [x] A second `uploadClips` call waits for the running batch (`useClipUpload.test.js` T15020 block)
- [x] `EmptyTabGuide` Add Video is disabled while `addVideoLoading` (`EmptyTabGuide.test.jsx`)
- [ ] Staging: upload a zip of clips, re-pick the same zip mid-batch; every clip lands once, the
      admin upload pair shows no failures for the run
