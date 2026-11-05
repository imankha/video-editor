# T15040: prepare-upload hands a live, in-progress session to a second flow for the same file

**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Tier:** M (backend + frontend)
**Created:** 2026-11-04
**Updated:** 2026-11-04
**Milestone:** Production incident 2026-11-04 follow-ups, see PLAN.md

## Source

Root cause of the 2026-11-04 upload-rate incident (T15020). T15020 makes two flows for one file
CONVERGE on one outcome; this task stops the second flow from uploading the same bytes at all.

## Problem

`prepare_upload`'s resume branch returns the existing `pending_uploads` row and its multipart
to ANY caller with the same hash and kind. It was written for "the browser crashed, resume my
upload", but it cannot tell that case from "another flow is uploading this right now" (a second
tab, a second pick, a retry while the first attempt is still in flight). The second flow then
re-uploads the same parts to the same multipart, and the two race on finalize. After T15020 the
race is harmless, but the bytes are still sent twice and the user still sees two progress bars for
one file.

## Solution

- Track activity on the session: `pending_uploads.last_part_at` (profile_db migration) updated by
  `/parts` saves, or an in-process per-(user, hash) in-flight marker.
- In the resume branch: if the session saw activity within the last N seconds (say 60 s),
  return `{status: "in_progress", upload_session_id, progress_percent}` instead of presigned
  URLs. The client treats `in_progress` as "wait": poll prepare every few seconds until it answers
  `exists` (the other flow finished) or `upload_required` (the other flow died, resume for real).
- Resume after a real crash is unchanged: no activity for N seconds, same code path as today.
- `useClipUpload` and `uploadGame` show the waiting file as "Already uploading..." rather than a
  second bar.

## Acceptance Criteria

- [ ] Two concurrent `ensureVideoInR2` calls for one file on a local stack: only one uploads
      parts; the other polls and resolves with the same hash and `uploaded: false`
- [ ] A session with no activity for N seconds still resumes with remaining parts (existing
      resume tests)
- [ ] Backend test: prepare on a session with recent `/parts` activity returns `in_progress`
- [ ] Migration agent included if a column is added; knowledge doc updated

## Context

### Relevant Files
- `src/backend/app/routers/games_upload.py` (`prepare_upload` resume branch, `save_upload_parts`)
- `src/frontend/src/services/uploadManager.js` (`ensureVideoInR2`), `src/frontend/src/hooks/useClipUpload.js`

### Related Tasks
- T15020, T7950 (resume + double-UploadId), T8160 (UploadId aliases: never compare ids across responses)
