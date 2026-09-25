# T11200: Read-only census of multi-clip drafts and reels (all envs)

**Status:** STAGING (merged PR #509, 7b6b2c60; script done, staging/prod runs still owed)
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Single-Clip Editor](EPIC.md)

## Problem

R3 (what to do with in-progress multi-clip drafts) cannot be decided without counts. Per-user
data lives in per-profile SQLite in R2, so there is no central query.

## Solution

A read-only script `scripts/census_multiclip_projects.py --env dev|staging|prod`, modeled on
`scripts/measure_migration_floor.py` (orphan-inclusive walk) and
`scripts/audit_rating_export_correlation.py` (env loading, R2 download to tempdir, `mode=ro`
connections, cleanup). Never writes, never uploads.

Per profile DB, report:
1. Projects with >1 latest working clip:
   ```sql
   SELECT p.id, COUNT(*) n, p.is_auto_created, p.working_video_id, p.final_video_id,
          fv.published_at, p.archived_at
   FROM projects p JOIN working_clips wc ON wc.project_id = p.id
   LEFT JOIN final_videos fv ON fv.id = p.final_video_id
   WHERE wc.id IN (<latest_working_clips_subquery(project_filter=False)>)
   GROUP BY p.id HAVING n > 1;
   ```
   Bucket: published / rendered-not-published (`working_video_id` set, exported final not
   published) / framing-only draft / archived.
2. `is_auto_created = 0` projects with exactly 1 clip (a 1-clip "reel" is possible via Create reel).
3. Latest-version `final_videos` published with `clip_count > 1 OR source_type = 'custom_project'`.
4. Archived multi-clip projects inside the R2 archive JSON (`project_archive.py`): profile_db
   migrations cannot reach these.
5. Postgres: share tokens and collection shares pointing at the rows in (3).

Output aggregates plus per-user counts (user id, not email) so affected users can be contacted.

## Context

### Relevant Files
- `scripts/measure_migration_floor.py`, `scripts/audit_rating_export_correlation.py` (patterns)
- `src/backend/app/queries.py:69-94` (`latest_working_clips_subquery`)
- `src/backend/app/services/project_archive.py`

### Related Tasks
- Blocks: T11220 (R3 ruling)

## Acceptance Criteria

- [ ] Script runs read-only on dev, staging and prod; prod run results posted to the user
- [ ] Verified read-only: no R2 PUT, all SQLite opened `mode=ro`
- [ ] Results recorded in this file's Progress Log and summarized in the R3 decision
