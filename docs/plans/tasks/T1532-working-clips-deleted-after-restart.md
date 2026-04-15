# T1532: working_clips silently deleted for manual project after backend restart

**Status:** TODO
**Impact:** 9 (silent user data loss)
**Complexity:** 5
**Created:** 2026-04-15
**Updated:** 2026-04-15

## Problem

Sequence on staging 2026-04-15:
1. User `efaecd77...` had manual project "Spring 2026" (project_id=4) with 3
   working_clips (ids 4/5/6). Dims were null (T1500 gap).
2. Backfill script (commit `b120a64`) downloaded DB, filled dims on all 3
   working_clips, uploaded as db-version 81. DB contained Spring 2026 intact.
3. Staging backend restarted. Backend pulled db-version 81.
4. User opened Spring 2026 at 20:56:32.
5. db-version advanced to 84 via 3 writes.
6. Spring 2026 now has **0 working_clips**. raw_clips (1/2/3/4) intact; projects
   row intact.

The backfill script only performs `UPDATE working_clips SET width/height/fps`;
it cannot delete rows. Deletion happened in backend code between the reel
opening and the next sync.

## Hypothesis

A load/hydration flow for manual projects (`is_auto_created=0`) may be reconciling
working_clips against some invariant and deleting rows that fail validation —
possibly a check against raw_clips.auto_project_id or video_sequence. Spring 2026
is manual, so none of its raw_clips point to it via auto_project_id.

## Goal

Identify the code path that deleted working_clips for project 4 between
versions 81 and 84. Add a safeguard that NEVER silently deletes working_clips
on read/hydration — deletion must be explicit user action or migration.

## Investigation pointers

- Search `DELETE FROM working_clips` in src/backend.
- Search hydration paths invoked on project load (`GET /api/projects/{id}`,
  `PATCH /api/projects/{id}/state`).
- Check startup / restore flows that fire on backend boot.
- Spring 2026 is `is_auto_created=0` — check if any code treats manual vs
  auto projects differently in working_clips cleanup.

## Related

- Backfill script at `scripts/backfill_clip_dimensions.py` has a separate
  download-old/upload-new race: it re-heads R2 at upload time and bumps that
  version, but its content is based on the earlier download. If the backend
  wrote between download and upload, the upload clobbers those writes. Fix:
  compare head version at download vs upload and skip/re-apply on mismatch.
  (Not the cause here — the DB we uploaded contained the working_clips —
  but worth fixing to prevent future data loss.)
