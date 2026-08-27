# T7600: Expiry sweep auto-exported the same clips three times (triplicate R2 storage)

**Status:** DONE (deployed 2026-08-26 prod) — idempotency fix shipped; remaining items split to [T7830](T7830-sweep-orphan-audit-rankpool-question.md)
**Priority:** P3 (cost/correctness hygiene)
**Impact:** 4
**Complexity:** 3
**Created:** 2026-08-24
**Updated:** 2026-08-27

## Problem

Prod evidence (2026-08-24): lisagee1443's profile `94b06403` has 24 objects under
`profiles/94b06403/raw_clips/` for 8 distinct clips (8 distinct byte-sizes), uploaded in
three waves on 2026-07-13 (00:00:31-01:12, 00:01:30-01:40, 19:33:54-34:06), each wave
with fresh random filename suffixes. ~423 MB stored where ~141 MB was needed, for a user
who had churned a month earlier. Consistent with the known expiry-sweep auto-export bug
class (memory: rank raw-clips sweep bug): the sweep's clip materialization is not
idempotent, so re-runs re-export and re-upload with new names, orphaning prior copies.

## Solution

1. Make sweep clip materialization idempotent: deterministic object naming (content hash
   or clip id based, not a fresh random suffix per run) or an exists-check before
   re-export; a re-run must be a no-op.
2. Confirm whether the DB rows point at the LAST wave only (making waves 1-2 pure
   orphans) and add an orphan-detection query to the sweep report.
3. Cleanup pass (dry-run first, user sign-off per data-safety rules) deleting orphaned
   duplicates across ALL profiles, not just lisagee's; report bytes reclaimed.
4. Check the related open question from the rank-sweep memory: whether the sweep's
   auto-export still publishes raw 1080p into the 9:16 ranking pool (separate bug, same
   code corner; file separately if still live, do not fix silently here).

## Context

### Relevant Files
- `src/backend/app/sweep_scheduler.py` - expiry sweep phases
- Sweep clip materialization/export helpers (locate the raw_clips upload site)
- `src/backend/app/storage.py` - object naming

### Related Tasks
- T6770 (refcount derived set) shares the sweep corner; coordinate, do not entangle
- **T4390/T4410** (export-write-path epic) name this exact class structurally: T4390 cites
  "the sweep [writer] caused the raw-clips-in-ranking incident (T4160)", and T4410 slice 4
  is explicitly "sweep onto shared rails" — putting `auto_export_game` through a real
  `export_jobs` record + the one durable publish writer, which would make re-runs a
  structural no-op rather than a re-upload. That epic is gated behind T4370's golden
  harness and not close — **this task should proceed now as the smaller, immediate hygiene
  fix**, not wait on the epic. When T4410 slice 4 is picked up, its author should read this
  task's outcome first (idempotency fix + orphan audit) so the structural rework doesn't
  redo or contradict it.

## Acceptance Criteria

- [x] Re-running the sweep against an already-exported profile uploads nothing new (test)
- [ ] ~~Orphan audit across prod profiles produced; cleanup executed after dry-run sign-off~~ — split to [T7830](T7830-sweep-orphan-audit-rankpool-question.md)
- [ ] ~~Rank-pool question answered (still live? filed or confirmed fixed)~~ — split to [T7830](T7830-sweep-orphan-audit-rankpool-question.md)
