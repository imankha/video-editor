# T16830: Sharpen lost to a server restart waits forever

**Status:** STAGING
**Impact:** 4
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

**Today.** If the server restarts while a parent's highlight is being sharpened (a deploy, or a crash), the
sharpen can disappear: no export job is left on the server. Frame keeps showing the progress and never says
anything went wrong. Found by T16800 on staging on 2026-11-17: two sharpens started during backend deploys
(14:03 and 16:27 UTC, account `e2e-gate@test.local`) left no job at all, and the check waited 8 minutes.

**What we will do.** First find out why the job row is gone (the export row was written on the old machine and
never reached R2 before it stopped, or the render request was cut off mid-way), then make Frame tell the parent
the sharpen was interrupted and offer to start it again, instead of waiting forever.

**Why.** Production deploys happen while parents use the app. A lost sharpen with an endless spinner looks like
the app is broken, and the parent has no way to know they should press Sharpen again.

**How we will know.** A sharpen whose job no longer exists on the server shows an "interrupted, try again"
message within a minute instead of progress that never ends.

## Acceptance Criteria

- [ ] When the server has no record of a sharpen that Frame is waiting on, Frame stops waiting within a minute and tells the parent to sharpen again.

## Context

### Relevant Files

- `src/frontend/src/services/ExportWebSocketManager.js`: `_pollExportStatus` returns null on a 404 and
  `_startPeriodicPolling` keeps polling while the store still says processing; the WebSocket also reconnects
  to the new server, which may never send anything for a job it does not know.
- `src/backend/app/main.py` (`/ws/export/{export_id}`), `src/backend/app/routers/exports.py`
  (`GET /api/exports/{job_id}`), `export_worker.recover_orphaned_jobs`.
- Knowledge: `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/persistence-sync.md`.
