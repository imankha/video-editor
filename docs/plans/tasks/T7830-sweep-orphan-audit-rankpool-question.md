# T7830: Sweep orphan audit + rank-pool raw-1080p question

**Status:** WIP
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

## Acceptance Criteria

- [ ] Orphan audit across prod profiles produced; cleanup executed after dry-run sign-off
- [ ] Rank-pool question answered (still live? filed or confirmed fixed)
