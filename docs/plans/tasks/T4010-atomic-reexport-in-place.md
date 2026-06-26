# T4010: Atomic Re-Export-In-Place for Published Reels (No Lost Final-Video References)

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-06-26
**Updated:** 2026-06-26

## Problem

Editing an already-exported/published reel and re-exporting can **destroy the existing
final video before the new one is built**, with no rollback. A failed (or never-completed)
re-export leaves a reel that looks "Done" but is **unplayable and unpublishable**:
`projects.final_video_id = NULL`, an orphaned/absent `final_videos` row, and no R2 `.mp4`.

This was reproduced on prod for account imankh@gmail.com:

- **project 30 "Brilliant Dribble and Pass"** — `final_video_id` NULL, **no** `final_videos`
  row, **no** R2 final object, **no** archive. Its single `working_clip` (id 32 -> raw_clip
  115, game 6) survives with the edit state; the game-6 source video is intact on R2 at
  `games/1c8a48db750fa43e9e40408ed0d844ecf71d249deaf2516bc9c815b8ec83b404.mp4` (3.05 GB).
  So the reel is fully **re-exportable** — only the rendered final video was lost.

(A second reel, project 45 / `final_videos.id=30`, has a *different* symptom — slow re-edit
restore + stale archived crop. That is a separate perf/UX concern, tracked as a follow-up,
NOT part of this task.)

## Root Cause (verified against current `master`)

The export pipeline's **framing pre-step speculatively NULLs `final_video_id` BEFORE the new
video exists**, and the failure handler never restores it:

- `src/backend/app/routers/export/framing.py:367` (`POST /render`):
  `UPDATE projects SET working_video_id = NULL, final_video_id = NULL` fires at job-accept,
  before anything is built. The background-render failure path (`_run_render_background`,
  ~L633-654) only refunds credits + emits a WS error — it does **not** restore the old
  pointers. Net: `final_video_id = NULL` + old `final_videos` row and R2 object orphaned.
  **This is the precise signature of project 30.**
- Same destructive-before-constructive pattern (speculative `final_video_id = NULL` before the
  new working video is committed):
  - `src/backend/app/routers/export/framing.py:246-248` (`POST /framing` legacy path)
  - `src/backend/app/services/export_worker.py:335`
  - `src/backend/app/routers/export/multi_clip.py:1649` (local path), `:1837` (regress block)
- `src/backend/app/services/auto_export.py:210-220` (`_export_brilliant_clip`): `delete_from_r2`
  of the OLD final object + `DELETE FROM final_videos` for the old row happen BEFORE the new
  row is INSERTed (~L232-241). The new R2 object is built first (~L187) so risk is lower, but
  the DB-row gap is real: a crash between delete and insert loses the old object with no row.

### What is already correct (do NOT "fix")

- **Overlay finalize is already constructive.** `_finalize_overlay_export`
  (`src/backend/app/routers/export/overlay.py:59-124`) and `export_final` (`POST /final`,
  `:1061-1235`) only INSERT a new `final_videos` version (`next_version = MAX(version)+1`) then
  `UPDATE projects SET final_video_id = <new>` in one transaction. They never delete the old
  row/object mid-flight (old artifacts are merely orphaned, which is harmless until cleaned up).
- **`final_videos` already supports old+new coexisting.** `version NOT NULL DEFAULT 1`, readers
  always take `MAX(version)` via `latest_final_videos_subquery` (`src/backend/app/queries.py:104-131`),
  and there is **no UNIQUE constraint** on `(project_id, version)` — only a non-unique index
  `idx_final_videos_project_version` (`database.py:822-823`). **No schema migration is required
  for atomicity.** FK note: `projects.final_video_id` is `ON DELETE SET NULL`;
  `before_after_tracks.final_video_id` is `ON DELETE CASCADE` (`database.py:609-610, 786`).

## Approved Design Direction (from user)

1. **Re-export in place, stay published.** Editing a published reel re-renders and atomically
   swaps the final video; the reel never leaves My Reels and needs no second "Move to My Reels".
2. **Fix code first, then a targeted recovery** of this account's affected reel(s).

## Target State — atomic swap, never-destroy-before-build

Invariant to establish: **a reel's currently-published final video (row + R2 object + pointer)
is never destroyed until a new final video has been fully built and the pointer atomically
moved to it.** Then, and only then, clean up the old R2 object.

### Fix 1 — Stop speculative `final_video_id = NULL` in the framing pre-step

Do not null `final_video_id` at job-accept. Keep it pointing at the existing final until the
re-export actually produces a new one. The pointer should only change inside the same commit
that establishes the new `working_video_id` (and ultimately the new `final_video_id` at overlay
finalize). Concretely:

- `framing.py:367` — remove `final_video_id = NULL` from the job-accept UPDATE (keep
  `working_video_id` handling as needed, but do not pre-null the *final* pointer). If
  `working_video_id` must be reset to gate "needs overlay", confirm that does not by itself make
  the reel unplayable; the **final** pointer must survive a failed render.
- Apply the same reasoning to `framing.py:246-248`, `export_worker.py:335`,
  `multi_clip.py:1649` and `:1837`: never null the final pointer before the replacement exists.
- Ensure the framing-render **failure** path leaves the project exactly as it was before the
  job (old `working_video_id` + old `final_video_id` intact). Add restoration if the job mutated
  them. This is the rollback that's currently missing.

### Fix 2 — Post-commit cleanup of the OLD final R2 object after an atomic swap

After overlay finalize commits the new version and repoints `final_video_id`, delete the PRIOR
version's R2 object (and optionally prune the prior `final_videos` row) — only after the commit
succeeds. Never before.

- `_finalize_overlay_export` (`overlay.py:59-124`) and `export_final` (`overlay.py:1061-1235`):
  after the transaction that sets the new `final_video_id` commits, look up the prior version's
  filename and `delete_from_r2` it. Guard against deleting the just-written object. Keep this
  best-effort + logged (R2 is external; a failed cleanup must not roll back the successful swap —
  it only leaves a harmless orphan to be GC'd later).

### Fix 3 — Reorder `auto_export._export_brilliant_clip` to insert-new-then-delete-old

`auto_export.py:203-241`: build + upload the new R2 object (already first, ~L187), INSERT the
new `final_videos` row and repoint, COMMIT, and only THEN `delete_from_r2` the old object +
delete the old row. Eliminates the DB-row gap.

## Recovery (separate step, AFTER the code fix is merged + verified)

Do NOT bundle prod mutation into the code PR. After merge, recover the damaged reel(s) for
imankh@gmail.com (prod user_id `3ed03fb5-949d-4cfd-b708-0c758ea68ef3`, profile `9fa7378c`):

- **project 30**: re-export from the surviving `working_clip` 32 against source
  `games/1c8a48db...b404.mp4` to regenerate its final video + pointer. Time-sensitive: game-6
  `storage_expires_at` is **2026-07-09** — recover (or extend retention) before then.
- This is admin-run, gesture-traceable recovery (re-trigger export), not a silent data patch.
  Decide whether a one-off script or simply driving the now-fixed export flow is cleanest.

## Test Scope (test-first — backend bug-reproduction skill)

Write failing tests FIRST, then fix:

1. **Re-export failure preserves the old final video** (core regression test): given a project
   with `final_video_id` set + a `final_videos` row, simulate a framing/render job that FAILS
   after job-accept; assert `final_video_id` and the `final_videos` row are UNCHANGED (the reel
   stays playable). This test fails on current code (project-30 reproduction).
2. **Successful re-export swaps atomically**: a full re-export produces a new `final_videos`
   version, repoints `final_video_id` to it, and the reel is continuously playable (the pointer
   is never NULL at any committed point). Old R2 object is deleted only after the new pointer is
   committed.
3. **auto_export reorder**: a crash between old-delete and new-insert can no longer leave zero
   rows (assert new row exists before old is deleted).

## Classification

**Stack Layers:** Backend
**Files Affected:** ~6 files
**LOC Estimate:** ~120 lines
**Test Scope:** Backend

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Code paths already mapped in this file (file:line refs verified). |
| Architect | Yes | Atomicity/ordering invariant across multiple export paths; design-gate the approach before edits. |
| Tester | Yes | Test-first reproduction of the lost-reference bug is mandatory. |
| Implementor | Yes | Multi-file ordering changes + failure-path rollback. |
| Reviewer | Yes | Data-integrity + persistence rules (gesture-based, no fallbacks); high blast radius (export path). |
| Migration | No | No schema change — `final_videos` versioning already supports old+new coexisting. |

## Key Rules (from CLAUDE.md)

- **No fallbacks / correct data**: fix the root cause (ordering), not a read-time guard. Do NOT
  add "if final video missing, rebuild" fallbacks — make the pipeline never lose it.
- **Gesture-based persistence**: every write traces to a user gesture (export click / sweep).
  No reactive writes.
- **No defensive fixes for internal bugs**: don't paper over the orphan with cleanup-at-read.
- Branch `feature/T4010-atomic-reexport-in-place`; commit with explicit `git add <paths>` only;
  do NOT change task statuses.

## Relevant Files

- `src/backend/app/routers/export/framing.py` — L367 (`/render` speculative NULL, ROOT CAUSE),
  L246-248 (`/framing`), `_run_render_background` failure path (~L633-654)
- `src/backend/app/services/export_worker.py` — L333-337
- `src/backend/app/routers/export/multi_clip.py` — L1649, L1837
- `src/backend/app/routers/export/overlay.py` — `_finalize_overlay_export` L59-124;
  `export_final` L1061-1235 (add post-commit old-R2 cleanup)
- `src/backend/app/services/auto_export.py` — `_export_brilliant_clip` L203-241 (reorder)
- `src/backend/app/queries.py` — `latest_final_videos_subquery` L104-131 (no unique constraint)
- `src/backend/app/database.py` — final_videos/projects/before_after_tracks FKs L609-610, L786,
  schema/index L822-823
- `src/backend/app/routers/downloads.py` — `publish_to_my_reels`, `delete_download`,
  `restore_project_from_archive` (context for the publish/unpublish/restore surface)

## Acceptance Criteria

- [ ] A failed framing/render re-export leaves `final_video_id` + the `final_videos` row + R2
      object intact (reel stays playable) — covered by a test that fails on current code.
- [ ] Successful re-export inserts a new `final_videos` version, atomically repoints
      `final_video_id`, and deletes the OLD R2 object only AFTER the new pointer is committed.
- [ ] `auto_export._export_brilliant_clip` inserts-new-before-deleting-old (no zero-row window).
- [ ] No speculative `final_video_id = NULL` remains in any framing/export pre-step.
- [ ] Backend tests green; no schema migration introduced.
