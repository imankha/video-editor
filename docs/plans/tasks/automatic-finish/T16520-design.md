# T16520 design: the server finishes a highlight when sharpening ends

**Status:** approved by the owner 2026-11-16 (see the Ruling in the task file). This task builds only the backend half; the Frontend section below is task T16525.
**Task:** [T16520-finish-when-sharpening-ends.md](T16520-finish-when-sharpening-ends.md) | **Epic:** [EPIC.md](EPIC.md)
**Knowledge:** export-pipeline.md, persistence-sync.md, guidance.md

## In plain words

Today a highlight is finished by the browser: after sharpening, the parent taps Finish. The browser then asks the server to make the shareable video, waits for it, and asks the server again to put it in Highlights. A closed tab breaks that chain. With this change the server does all three steps itself at the moment it saves the sharpened video, and it does them in the same place whether the parent is still watching or comes back later. The browser only reports what happened.

## Current state

```
POST /api/export/render (framing, long request, Modal)        GET /api/exports/{id}/modal-status
  -> finalize_export (detect -> persist working_video -> sync)  <- recovery: same finalize_export, run
  -> WS "Your highlight is ready"                                  on the owner's next visit
browser (only if open):
  Finish tap -> startOverlayPublishRender -> POST /api/export/render-overlay
     no keyframes -> R2 copy working->final -> _finalize_overlay_export
                     (publish_final_video INSERT, published_at NULL) -> poster -> sync
  -> handleOverlayExportCompletion reads publishIntentStore
  -> POST /api/downloads/publish/{project_id}
     (published_at, highlight_finished [T16510], archive_project) -> durable_sync
```

The finish needs the browser twice: to start the overlay render and to call publish.

## Target state

```
finalize_export (in-band OR recovery, unchanged up to stage COMPLETE)
  -> finish_highlight(user_id, profile_id, project_id, trigger="framing")   NEW, services/finish_highlight.py
       1. if the latest final_video was not made from this working_video:
            R2 copy working_videos/X -> final_videos/final_{pid}_{hex}.mp4
            _finalize_overlay_export(...)       (existing writer, unchanged)
            generate_poster_at_export(...)      (existing)
       2. mark_published(cursor, project_id)    (moved out of publish_to_my_reels)
            published_at + name freeze; returns newly_published
       3. record highlight_finished if newly_published   (moved, T16510 rule)
       4. sync_export_db_to_r2 (CAS upload)
     returns {finished: True, final_video_id} or {finished: False, reason}
  -> WS complete frame carries finished + final_video_id

render-overlay with spotlight keyframes (Modal or local) completes
  -> _finalize_overlay_export -> mark_published + highlight_finished rule -> sync
     (same helper; the second Finish tap goes away)

POST /api/downloads/publish/{project_id}  (kept: the manual fallback)
  -> mark_published + highlight_finished rule + archive (as today)
```

### Step by step

1. **One finish service.** `services/finish_highlight.py` holds the steps above. `publish_to_my_reels` keeps its route and calls the same `mark_published` helper, so there is one writer of `published_at` and one place that records `highlight_finished`.
2. **Where it runs.** In `finalize_export`, after its sync gate passes, under a claimed `finishing` stage (see Expert review 1). `finalize_export` is already shared by the in-band request and the `/modal-status` recovery. A rerun is safe: see Expert review 2 and 3.
3. **Local (no Modal) framing path.** The local in-band writer calls `upsert_working_video` directly. It gets the same `finish_highlight` call after its sync.
4. **Spotlight render.** Every `_finalize_overlay_export` caller (no-keyframes copy, local, Modal, test mode) calls `mark_published` plus the event rule before its existing sync barrier. `publish_final_video` already inserts a new version and keeps the prior object when it has an active share (`prior_final_is_shared`), so a share link made before still plays.
5. **Archive waits.** The server finish does **not** archive. Archiving deletes the working data the Spotlight editor needs, and T16530 needs the crop and spotlight editable afterwards. The existing session-start sweep `archive_completed_projects` (session_init step 8) already archives every published, unarchived project on the owner's next session, so the database still stays small. T16530 then decides whether redo after that point uses the existing restore path (`useReEditReel`) or keeps the project unarchived. The manual `POST /publish` keeps archiving as today.
6. **Failure.** Every step of `finish_highlight` runs in a `try`. On any failure it logs `[Finish] FAILED project=... step=...` at ERROR and returns `finished: False`. It never raises into `finalize_export`: the sharpen is saved, charged and announced exactly as today. A copy or insert failure leaves no published row. A failure after the final row is inserted leaves it unpublished, the state today's panel already handles. The browser shows today's panel with its Finish button (the manual publish route). The credits path is untouched (charged at render start; refunded only by the existing render-failure handler, which a finish failure never reaches).

### Persistence rules (restore-if-newer, CAS)

- This is a server lifecycle operation, not editor reactive persistence: it is triggered by the export-job contract (render complete), the same class as `finalize_export` itself.
- **Who holds the DB.** Both callers run inside the owner's own request (the long `POST /api/export/render`, or the owner's `GET /modal-status`), with that request's user and profile context, through `get_db_connection` and the per-user seam. No cross-user or session-less writer is added, so the T4315 restore-if-newer duty for writers that open a DB they do not hold does not apply. The structural check in the shared connection path still runs.
- **Upload.** One `sync_export_db_to_r2` at the end of `finish_highlight` (CAS). On a CAS conflict it freezes and marks sync pending, the same as the framing finalize. The finish reports `finished: False, reason: sync_failed`, and the browser shows the existing retryable sync-failed UX. No blind retry.
- **Long request.** The in-band request runs for minutes, but its connection is opened per step (`with get_db_connection()`). No snapshot is read early and written late. `mark_published` reads the latest `final_videos` row in the same transaction that updates it.

### Frontend

- `FocusScreen` completion: when the WS/HTTP completion says `finished: true`, the panel says the highlight is in Highlights (`displayNames.js` strings) and offers Spotlight. "Finish without spotlight" and the publish-intent stake (`publishIntentStore`, `startOverlayPublishRender`, and the publish branch of `handleOverlayExportCompletion`) are removed from this path. When `finished: false`, the panel is unchanged from today.
- Overlay screen: after a spotlight render with `finished: true` there is no Finish tap. It goes to the Highlights view, which today runs after publish.
- Waiting message (`progressExport` guide string): it says the highlight will be in Highlights when it is done, and no longer invites the parent to go mark more plays as if nothing were at stake.
- Home tile and Highlights "new" mark: no change needed. The highlight is published, so it lists in Highlights with its existing new mark (`watched_at` NULL). Drafts filters `archived_at IS NULL`, so an unarchived finished project would still show as a draft until the next-session sweep. Home must classify a project whose latest final video is published as finished, not "In progress". The design team should confirm that one query change (projects.py drafts list) during review.

### Tests (red first)

- Backend: `tests/test_t16520_server_finish.py`
  - framing finalize with no browser call leaves a published final video listed by `GET /api/downloads`, and one `highlight_finished` event;
  - recovery finalize (modal-status path) does the same, and a repeat finish adds no row and no event;
  - a forced failure in the copy step leaves the highlight unpublished, logs `[Finish] FAILED`, and a later manual `POST /publish` succeeds;
  - a spotlight render publishes the new version and keeps a shared prior object;
  - the credit balance changes once per sharpen.
- Frontend unit: the completion panel copy for finished and not-finished results.
- Checks: browser check for the in-Highlights message; code checks for the backend tests. The closed-browser criterion on staging is checked by a test that runs finalize with no browser, plus a `human` check for the staging walk.

## Expert review (Opus, 2026-11-16) and what changed

An independent review of the persistence and idempotency claims found these gaps. The design adopts all of them:

1. **The finish must be retried, not skipped.** A finish that runs after stage `complete` is never retried, because recovery returns early. **Adopted:** a new `export_jobs.stage` value `finishing` sits between `persisting` and `complete`. It is entered by a CAS claim (`_claim_stage_for_finalize(job, persisting, finishing)`), so the in-band request and a recovery poll can never both run step 1. `complete` is set only after the finish succeeds or fails terminally (a logged failure leaves the manual Finish button).
2. **Step 1 needs a stored link.** "The latest final video was made from this working video" must be a column, not a guess from the filename. **Adopted:** `final_videos.source_working_video_id` (profile_db migration plus a `_SCHEMA` update; NULL on old rows). The copy uses a deterministic key `final_{pid}_wv{working_video_id}.mp4`, so a retry after a copy that succeeded but was never recorded overwrites the same object.
3. **`highlight_finished` once per highlight, not per version.** With archiving deferred, a re-sharpen in the same session inserts and auto-publishes a new version. **Adopted:** record the event only when no earlier version of the project has ever been published (`newly_published AND NOT EXISTS(published version for project)`). This also covers the manual route. T16510's test for "a repeat publish adds none" still holds.
4. **The spotlight publish targets its own row.** `mark_published` takes the `final_video_id` returned by `publish_final_video`, never "the latest row".
5. **No R2 delete before a durable sync** (biggest flaw). `publish_final_video` callers delete the superseded final object right after the local commit, before the CAS sync. If the sync is frozen and the local file is later replaced from R2, the R2 copy of the database points at a deleted object. **Adopted for the finish path:** the delete moves after a confirmed sync success. If the process dies in between, the object is orphaned (it costs storage but loses nothing). The orphan cleanup and the same reordering for the existing manual `POST /publish` and overlay paths are filed as follow-ups, not done here.

Point 5 of the review (deferring the archive means the sweep later deletes working data a parent wanted to refine) is answered by T16530: redo goes through the existing restore path.

## Risks

| Risk | Mitigation |
|------|-----------|
| Finish lengthens the in-band request by the R2 copy, poster and sync time (seconds) | The WS progress frame "Putting it in your Highlights" is sent before the finish starts |
| The in-band request is cancelled mid-finish (deploy) | The job stays at `finishing`, and recovery claims it and reruns the finish. That is safe: the copy key is deterministic, step 1 is skipped once the linked row exists, and the event is recorded once. |
| A parent re-sharpens within 25 minutes (13%) | The second framing export produces a new working video, so step 1 copies it and inserts a new final version, which replaces the finished one. That is the redo behavior the epic wants. |
| Analytics: `overlay_exported` now fires on every sharpen | It is no longer read by the Journey's Finished stage (T16510). Funnel charts that read it will jump; noted in the PR. |

## Questions for the owner

1. **Archive waits** until the next session's sweep instead of happening at finish (step 5). Approve?
2. **Schema change:** add `final_videos.source_working_video_id` (profile_db migration) and the `finishing` export stage (see Expert review 1 and 2). Approve?
3. **Event rule:** count `highlight_finished` once per highlight, so a re-sharpen does not count again (Expert review 3). Approve?
4. **Size:** with the migration this is about 10 files across the backend and frontend. Ship it as one task, or split it into T16520a (server finish, backend only; the browser still shows Finish when the server did not finish) and T16520b (frontend copy and removing the Finish tap)? Recommend splitting.
