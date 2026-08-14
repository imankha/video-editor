# T4947: Cache Stitched Downloads

**Status:** TODO — depends on T4946
**Impact:** 5 | **Complexity:** 2 (dropped from 3 — no credit-recharge exemption to build; free
downloads are never charged in the first place, per Decision 4 resolved 2026-08-14)
**Epic:** [Collection Download](EPIC.md)
**Follows:** [T4945](T4945-core-stitch-owner-download.md) (what gets cached),
[T4946](T4946-access-control-and-credits.md) (the permission gate this wraps)

## Problem

The original design recommended NO cache for v1 (regenerate on demand, measure before adding
complexity). The user's review reversed that: **"It should cache."** This task builds the cache
the original design deliberately deferred. (The user's original phrasing also asked to "not
re-charge when it has a cached version" — moot now that Decision 4 resolved downloads as free;
there is no charge to skip.)

## Solution

1. **R2 cache**, disposable, keyed so any input change invalidates naturally — no DB row, no
   migration:
   ```
   collection_downloads/{sha256(
     ordered member ids + each member's filename
     + resolved_card_id + card content-hash
     + BRANDED_OUTRO_ENABLED
     + budget_sec
   )}.mp4
   ```
2. HEAD-before-build: check the key exists before running `concat_segments`/`compose_serve_time`
   at all; write-after-build on a miss (atomic — don't let two concurrent requests for the same
   key race a partial write into place).
3. Tests: identical inputs → cache hit, no recompute; any single input change (member set, rank
   order, card, outro flag, budget) → cache miss, fresh build; two concurrent requests for the
   same uncached key don't corrupt each other's output.

## Context

### Relevant Files
- Wherever T4945's endpoint lives — this task wraps it with a cache-check/cache-write step
- R2 storage helpers already used elsewhere for disposable, derived caches (audit the existing
  pattern rather than inventing a new one — e.g. the poster cache conventions in
  `services/poster.py`)

### Related Tasks
- Depends on: [T4945](T4945-core-stitch-owner-download.md), [T4946](T4946-access-control-and-credits.md)

## Acceptance Criteria

- [ ] Repeat download of an unchanged collection serves from cache, no recompute
- [ ] Any relevant input change produces a cache miss and a fresh build
- [ ] Concurrent requests for the same uncached key don't corrupt each other's output
- [ ] No DB row, no migration — cache existence is fully derivable from the R2 key
- [ ] Tests pass
