# T12820: "Highlight ready" View fails because export recovery reports COMPLETE before finalize commits

**Status:** WIP
**Impact:** 7
**Complexity:** 4
**Tier:** M (backend, ~2 files, ~15 LOC + test; concurrency, Opus-verified mechanism)
**Created:** 2026-10-16
**Milestone:** Next build (external QA 2026-10-16). Present on prod, so it does not block the deploy.

## Problem

External QA B05 ([report](../../ux/2026-10-16-external-qa/QA-REPORT.md), screenshot
`screenshots/B05_game_1440x900_ready-view-fails.png`, network log `screenshots/B05_network.txt`).
Parent starts a paid highlight render, moves around the app (here: signed out and back in), and when
the "Highlight ready" card appears clicks View: "Couldn't open the preview. Open the highlight from
Clips to finish it." Opening from Clips a few seconds later works. The paid moment of the product
fails at the exact point the parent is waiting for.

## Mechanism (expert agent, high confidence)

Network order: `GET /api/exports/{job}/modal-status` 200, then
`GET /api/projects/1/working_video/playback-url` 404, then `[ResumeFocus] no working-video preview URL`.

1. After the re-login `useExportRecovery.checkModalStatusOnce` (`hooks/useExportRecovery.js:221-245`)
   polls `/modal-status` for the still-processing job.
2. `reconcile_dispatched_export` (`routers/exports.py:325-326`) checks R2 first and says `rendered` as
   soon as Modal writes the output, while the in-band request is still in `finalize_export`
   (`routers/export/multi_clip.py:1587`: detection, persist, sync) holding the DETECTING claim.
3. The recovery's `finalize_modal_export` loses the claim: `{"finalized": False, "already_finalizing": True}`
   (`services/export_finalize.py:422-424`), but `/modal-status` still answers `status: COMPLETE`
   (`exports.py:988-997`).
4. Frontend shows the ready card (`FocusCompletionRecovery.jsx:140-145`); View calls
   `resumeFocusCompletion.js:90-95`, and `projects.working_video_id` is still NULL (written only in
   `upsert_working_video`, `export_finalize.py:270-339`), so `projects.py:1295-1296` returns 404.

Confirm on staging logs near req_id `3b6e2193`: "[Finalize] Job ... is already being finalized
elsewhere" then "[ExportJobs] Finalization failed for ...: None".

On prod: no commits between the prod tags and master touch this path. Introduced by d32a71ad8
(T9285, card), 0bc6947d5 (T7210, claim), b6f5cddaa (T10360, R2-first verdict).

## Solution

Fix the source, not the frontend. In `exports.py:966-997` report COMPLETE only when
`finalization['finalized']` is true:
- `already_finalizing`: `await _await_concurrent_finalize(job_id)` (`multi_clip.py:1320`, what the
  in-band loser already does). Finalized: COMPLETE with `working_video_id`. None: `{"status": "running"}`.
- Genuine finalize failure: `running`, not COMPLETE (the 60 s re-poll retries).
- Apply the same guard to the `rendered` branch of `resume-progress` (`exports.py:1143-1145`), which
  the `running` reply makes the frontend call.

Rejected: gating the card on `working_video_id` in the frontend (defensive fix for a backend lie).

## Acceptance Criteria

- [ ] Red-first backend test: hold the in-band claim (stage `detecting`), call `/modal-status`; it must not return COMPLETE while `working_video_id` is NULL (fails on master)
- [ ] Same guard on `resume-progress`, with a test
- [ ] Live: start a render, sign out and in during it, click View on the ready card; the preview opens
