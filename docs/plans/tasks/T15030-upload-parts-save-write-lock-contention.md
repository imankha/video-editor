# T15030: Resume-state saves serialize every 5 MB part on the per-user write lock (16 s waits during a clip batch)

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Tier:** M (backend + frontend; design note first)
**Created:** 2026-11-04
**Updated:** 2026-11-04
**Milestone:** Production incident 2026-11-04 follow-ups, see PLAN.md

## Source

Found while root-causing the 2026-11-04 upload-rate incident (T15020). Prod `/tmp/logs/app.log`,
user cometlawal, 17:48 to 18:08 UTC.

## Problem

`uploadParts` PATCHes `/api/games/upload/{session}/parts` after EVERY completed part
(`SAVE_BATCH_SIZE = 1`, uploadManager.js). Each PATCH is a write to the profile DB, so it takes the
per-user write lock and is followed by the db_sync middleware's R2 upload of the whole
profile.sqlite. During one user's clip batch the log shows:

- `[WRITE_LOCK_WAIT] PATCH /api/games/upload/.../parts waited_ms=14426`, `16662`, `15884`, `15024`
  (one 15 MB clip = 3 parts = 3 PATCHes + prepare + finalize, all queued on one lock)
- `[SYNC] Upload lock busy >0.5s, deferring user=... db=profile` several times per second
- `[ExportWorker] Failed to sync user.sqlite to R2` on every attempt for minutes
- `POST /api/games/finalize-upload` total 20.0 s with `handler_ms=3019` and `overhead_ms=16200`

The user saw a bar that barely moved for a 15 MB file on a fast uplink and re-picked the zip,
which is what triggered the T15020 collision. The waits are the per-user lock, not R2 or the
network (`sync_ms=0`, `handler_ms` small).

## Solution

Design note first (which option, with the lock-wait numbers above as the baseline), then implement:

1. Resume state does not need a durable sync per part. Options, cheapest first:
   - batch the PATCH client-side (every N parts or every T seconds, and once at the end), keeping
     the end-of-upload save so a resume after a crash loses at most one batch;
   - make `/parts` a "light" write that updates `parts_json` without marking the profile DB dirty
     for the R2 sync (resume state is rebuilt from R2 ListParts on prepare anyway:
     `r2_multipart_parts_match_size`), so the sync only runs on prepare and finalize;
   - or drop server-side resume state for CLIP uploads entirely (a 15 MB file re-uploads in
     seconds; the resume machinery was built for multi-GB games).
2. Whatever is chosen, the finalize must stay a durable write (T4320).

## Acceptance Criteria

- [ ] A 10-file clip batch on a local stack with an artificial 2 s sync delay shows no
      `WRITE_LOCK_WAIT` above 2 s on `/parts` (today: one per part, additive)
- [ ] Game-upload resume after a reload still resumes from the last saved batch (existing
      `uploadManager` resume tests stay green)
- [ ] Knowledge doc `backend-services.md` records the chosen save cadence and why

## Context

### Relevant Files
- `src/frontend/src/services/uploadManager.js` (`uploadParts`, `saveCompletedParts`, `SAVE_BATCH_SIZE`)
- `src/backend/app/routers/games_upload.py` (`save_upload_parts`)
- `src/backend/app/middleware/db_sync.py` (write lock, sync after write)

### Related Tasks
- T15020 (the collision this contention provoked), T7480 (5 MB parts), T4320 (durable finalize)
