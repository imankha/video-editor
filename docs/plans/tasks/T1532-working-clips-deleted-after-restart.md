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

**Only multi-clip / manual reels are affected.** Observed on staging:
- Auto-created single-clip projects (1/2/3, `is_auto_created=1`) kept their
  working_clips across the restart+load cycle.
- Manual multi-clip project Spring 2026 (`is_auto_created=0`) lost all 3.

The distinguishing trait is that manual multi-clip working_clips reference
raw_clips whose `auto_project_id` points to a DIFFERENT project (or NULL).
A hydration flow likely treats "working_clip where raw_clip.auto_project_id
!= working_clip.project_id" as stale and deletes it. Auto projects pass this
check trivially (IDs match by construction); manual projects that reuse clips
from auto projects fail it.

## Goal

Identify the code path that deleted working_clips for project 4 between
versions 81 and 84. Add a safeguard that NEVER silently deletes working_clips
on read/hydration — deletion must be explicit user action or migration.

## Investigation pointers

Primary suspects found via `DELETE FROM working_clips` grep:
- [src/backend/app/routers/projects.py:866](src/backend/app/routers/projects.py#L866) —
  `DELETE ... WHERE project_id=? AND exported_at IS NULL AND version>1`. Fires in
  a restore/state path. If version somehow >1 for the multi-clip project, this
  would purge them.
- [src/backend/app/services/project_archive.py:397](src/backend/app/services/project_archive.py#L397) —
  "Delete old working_clips versions (keep only latest per identity)". T1160
  pruning. Runs in archive flow — confirm if triggered on load.
- [src/backend/app/services/project_archive.py:127](src/backend/app/services/project_archive.py#L127) —
  Archive-project deletion.

Also check: `restored_at` column on projects implies a restore flow. The
`PATCH /api/projects/{id}/state` observed on staging at 20:42:02 (post-restart)
is a possible trigger.

Other angles:
- `current_mode='framing'` hydration on project GET.
- Version-identity logic: `latest_working_clips_subquery` — verify it doesn't
  treat manual-project working_clips as "old" when they share raw_clip_ids
  with auto-project working_clips.

## Prime suspect

[src/backend/app/queries.py:63](src/backend/app/queries.py#L63)
`latest_working_clips_subquery` partitions by
`COALESCE(rc.end_time, uploaded_filename)` — NOT by project_id. When called
with `project_filter=False` (as at
[project_archive.py:397](src/backend/app/services/project_archive.py#L397)),
the "latest" is computed across ALL projects. A manual multi-clip project
reusing raw_clips that already belong to auto-projects shares the same
partition key (rc.end_time). ROW_NUMBER keeps exactly one row per partition
— if the auto-project copy wins the tie-break, the manual-project copies
are deleted. This matches the symptom exactly (auto projects survived,
manual project lost all its clips).

Fix direction: partition must include project_id OR the subquery should
never run with project_filter=False on a per-user DB.

## Related

- Backfill script at `scripts/backfill_clip_dimensions.py` has a separate
  download-old/upload-new race: it re-heads R2 at upload time and bumps that
  version, but its content is based on the earlier download. If the backend
  wrote between download and upload, the upload clobbers those writes. Fix:
  compare head version at download vs upload and skip/re-apply on mismatch.
  (Not the cause here — the DB we uploaded contained the working_clips —
  but worth fixing to prevent future data loss.)
