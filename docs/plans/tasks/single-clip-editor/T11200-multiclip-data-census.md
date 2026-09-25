# T11200: Read-only census of multi-clip drafts and reels (all envs)

**Status:** STAGING (merged PR #509, 7b6b2c60; staging + prod census runs complete 2026-09-25, all ACs met)
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

- [x] Script runs read-only on dev, staging and prod; prod run results posted to the user
- [x] Verified read-only: no R2 PUT, all SQLite opened `mode=ro`
- [x] Results recorded in this file's Progress Log and summarized in the R3 decision

## Progress Log

**2026-09-25**: Staging and prod runs completed (dev run was already done pre-merge). Reports at
repo root (gitignored): `census_multiclip_staging_2026-09-25.json`, `census_multiclip_prod_2026-09-25.json`.

**Staging** — 73/73 profiles read, 0 errors, 225 archives scanned:
- 4 framing-only multi-clip drafts (2 users); everything else (published, rendered-not-published,
  archived, published multi-clip finals, Postgres shares) is 0.

**Prod** — 193 profiles found, **188 read, 5 errored**, 197 archives scanned:
- 8 framing-only multi-clip drafts (5 users)
- 1 `is_auto_created=0` project with exactly 1 clip (a "reel" that never got a 2nd clip)
- **17 published multi-clip finals (4 users)** — real, live, currently-served output
- 2 archived multi-clip projects, R2-archive-only (1 user)
- **11 Postgres video shares pointing at those 17 multi-clip finals**; 0 collection shares
  (advisory) by the affected sharer profiles

**Known gap — 5 unreadable profiles (2 users, both flagged in the raw log):**
`OperationalError: no such column: fv.clip_count`. These 5 profile DBs are on a `final_videos`
schema version older than the migration that added `clip_count`, and (per CLAUDE.md's Migration
System long-tail property) never came online long enough for JIT to touch them. Per the script's
own contract this is NOT a false all-clear — their rows are **absent from every bucket above**,
not counted as zero. Whatever those 2 users hold (multi-clip or not) is currently unknown. Options
before R3 fully closes: (a) accept the gap as acceptably small (2/193 users) and proceed, since
T11220's "keep reachable" design doesn't depend on knowing the count in advance, or (b) re-run
after those 2 accounts migrate (their next login) or after extending `census_profile_db` to
degrade gracefully on a pre-`clip_count` schema (catch the column error, run buckets 1/2/4 without
bucket 3, and flag the profile as "partial" rather than fully skipped) — not done here since it
changes tested script behavior; flagging as a follow-up rather than doing it under this task.

**R3 verdict, now with real numbers:** counts support **option A (keep reachable)** as scoped —
17 live published multi-clip reels and 11 live shares in prod make "hide" or a lossy split
migration clearly wrong; the volume (17 finals / 4 users, 8 drafts / 5 users, out of 193 total
prod users) is small enough that option A's per-item handling (T11220) is proportionate, not
over-engineering. The 5-profile gap above does not change this verdict — it bounds unknown users,
not a reason to distrust the known ones.
