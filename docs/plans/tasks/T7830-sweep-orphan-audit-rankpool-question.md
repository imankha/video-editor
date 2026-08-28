# T7830: Sweep orphan audit + rank-pool raw-1080p question

**Status:** STAGING
**Priority:** P3 (cost/correctness hygiene)
**Impact:** 4
**Complexity:** 3
**Created:** 2026-08-27
**Updated:** 2026-08-27

## Problem

Split off [T7600](T7600-sweep-duplicate-raw-clip-exports.md) during the 2026-08-26 prod deploy
reconciliation. T7600's idempotency fix (deterministic naming / exists-check before the expiry
sweep re-exports a raw clip) shipped and is verified on master. Two of T7600's original
acceptance-criteria items were never executed and are carried forward here so they are not lost:

1. **Orphan audit across prod profiles.** T7600 found lisagee1443's profile had 24 objects for 8
   distinct clips (~423MB vs ~141MB needed) from pre-fix triplicate sweep exports. That was one
   profile found while investigating the bug — the same orphan pattern likely exists on other
   profiles that hit repeated sweep runs before the idempotency fix landed.
2. **Rank-pool raw-1080p question.** Re-answer the open question from the rank raw-clips sweep
   bug memory: does the expiry sweep's auto-export still publish raw 1080p clips into the 9:16
   ranking pool? Separate bug, same code corner as the sweep fix — confirm still-live, already
   fixed, or file separately.

## Solution

1. Query all profiles for raw_clips objects with duplicate (clip_id, byte-size-family) groupings
   from before the T7600 fix's deploy date; produce a dry-run report of orphan candidates + bytes
   reclaimable.
2. Get user sign-off on the dry-run report (data-safety rule: confirm exact scope before deleting).
3. Execute the cleanup pass across all affected profiles; report bytes reclaimed.
4. Check whether the expiry sweep's `auto_export_game` path still writes raw 1080p exports into
   the ranking pool; if still live, file a separate task (do not fix silently here per T7600's
   original note).

## Context

### Relevant Files
- `src/backend/app/sweep_scheduler.py` - expiry sweep phases
- `src/backend/app/storage.py` - object naming / listing

### Related Tasks
- [T7600](T7600-sweep-duplicate-raw-clip-exports.md) - parent task, idempotency fix already shipped
- T6770 (refcount derived set) shares the sweep corner; coordinate, do not entangle

## Progress Log

**2026-08-27**: Phase 1 done via dotask container, merged [PR #288](https://github.com/imankha/video-editor/pull/288).
- Rank-pool question answered: ALREADY FIXED, no code change. `_export_brilliant_clip` (T4175)
  writes no `final_videos` row; `rank._rankable_pool` selects only published `final_videos`;
  historical leaked rows purged by migration v021.
- Reviewing the existing `scripts/cleanup_orphan_raw_clips.py` (from T7600) for the orphan-audit
  pass surfaced a CRITICAL data-loss false-positive: its reference set only checked
  `raw_clips.filename`, missing `working_clips.uploaded_filename` (user-uploaded multi-clip
  sources, also stored under `raw_clips/`, read directly by `multi_clip.py`/`export_helpers.py`).
  Under `--apply` it would have deleted live user uploads. Fixed the reference-set gap, added a
  defense-in-depth gate (only `auto_`-prefixed sweep objects are ever deletion candidates), added
  5 regression tests. The actual prod dry-run cannot run from a container (no R2 creds by
  design) — remaining work is an admin running
  `python scripts/cleanup_orphan_raw_clips.py --env prod --report ...` for the reclaimable-bytes
  total, then user sign-off, then a separate `--apply` pass.
- **Packaged the cleanup as a migration** (user directive: "package any cleanup code as a
  migration"). Extracted the script's reviewed classification logic (`is_sweep_orphan_name`,
  `classify_objects`, the `raw_clips.filename` + `working_clips.uploaded_filename` reference-set
  union) into `src/backend/app/services/orphan_raw_clips.py` — this was the second occurrence of
  that exact logic, and the data-loss-bug history above made a hand-copied second version too
  risky, so extraction won over inlining. Both the standalone script and the new migration now
  import from this one module. Added `src/backend/app/migrations/profile_db/v048_cleanup_sweep_orphan_raw_clips.py`
  — a profile_db migration that, per profile, computes the reference set, lists `raw_clips/`
  objects, classifies them, and deletes ONLY `auto_` sweep-signature orphans (never non-sweep
  unreferenced objects), R2_ENABLED-guarded, idempotent, logging every delete at INFO for an
  audit trail (this is the first migration that deletes from R2 — no existing migration did
  before it). Registered in `profile_db/__init__.py`'s `MIGRATIONS` list; bumped
  `test_t6030_migration_window_structural_guard.py`'s `HEAD_VERSION_AUDITED` to 48 (v048 adds no
  columns, so no `POST_V023_COLUMNS` entry needed). Added `tests/test_v048_migration.py` (6 tests:
  sweep-signature delete, non-sweep left alone, both reference columns respected, R2-disabled
  no-op, idempotent re-run). The standalone script is UNCHANGED in behavior and still exists for
  a human-readable dry-run report before an admin triggers this migration (`POST
  /api/admin/migrate` per this project's migration rules — AI does not trigger it). Execution
  path is now: admin runs the script with `--report` for a pre-migration audit (optional but
  recommended, since the migration itself has no dry-run step once it's registered), then
  triggers a normal migrate run once satisfied.

## Acceptance Criteria

- [ ] Orphan audit across prod profiles produced; cleanup executed after dry-run sign-off
  (script fixed + tested; prod dry-run itself is a pending admin action)
- [x] Rank-pool question answered (still live? filed or confirmed fixed) — confirmed already fixed, no code change
