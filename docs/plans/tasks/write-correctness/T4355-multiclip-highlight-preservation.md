# T4355: Multi-Clip Highlight Preservation on Re-Export

**Status:** WIP
**Impact:** 5
**Complexity:** 6
**Created:** 2026-08-22
**Epic:** [write-correctness](EPIC.md) · follow-up from T4350

## Problem

T4350 fixes single-clip re-export so a user's edited highlights survive a timing change
(trim/speed) instead of being silently discarded and replaced by fresh auto-detection. **T4350
explicitly excludes multi-clip** — for a multi-clip project, a timing-changed re-export still
falls back to the loud "highlights reset, re-place them" notice rather than transforming
correctly. This task closes that gap.

Multi-clip highlight preservation could not ship inside T4350 because two structural mechanisms
don't exist yet (see T4350's design doc, `docs/plans/tasks/T4350-design.md` § "Gap B", for the
full analysis — read it before starting):

- **No per-region clip attribution.** Multi-clip highlight regions carry `{id, start_time,
  end_time, enabled, keyframes, detections, ...}` with times in **concatenated working-video
  seconds**, but nothing on a region says which source clip it belongs to. Mapping a
  concatenated-timeline time back through the correct per-clip transform requires first
  attributing it to a clip via the OLD concat offsets.
- **No old/new concat-offset remapping.** `transform_all_regions_to_raw`/
  `transform_all_regions_to_working` (`app/highlight_transform.py`) are single-clip and
  concat-offset-UNAWARE — they operate on one clip's crop/segments/dims as if that clip were
  the whole timeline. After attributing a region to its clip, its time needs to be re-expressed
  relative to that clip's OLD concat offset, transformed old→raw→new via the existing
  single-clip machinery, then re-expressed via the clip's NEW concat offset.

## Solution

Depends on T4350 landing first — reuse its OLD-framing-snapshot mechanism (per-`working_videos`-
version framing capture) rather than building a second one. On top of that:

1. Add per-region clip attribution: either persist a clip reference on each region at write
   time (Overlay screen already knows which clip a highlight was placed on), or derive it at
   transform time from the OLD concat offsets + region start time (whichever T4350's snapshot
   shape makes cheaper — decide in this task's design doc).
2. Extend the old→raw→new transform to work per-region: attribute → subtract OLD clip concat
   offset → `transform_all_regions_to_raw` (single clip) → `transform_all_regions_to_working`
   (single clip, new framing) → add NEW clip concat offset.
3. Drop-and-notify for regions that don't map cleanly (clip removed/reordered, trimmed out) —
   same UX contract as T4350's single-clip path, extended to multi-clip.
4. Multi-clip export is `multi_clip.py`'s finalize path (contrast the single-clip
   `export_finalize.py` path T4350 touches) — confirm whether the shared `upsert_working_video`
   carry logic T4350 adds is reusable here directly or needs a multi-clip-specific wrapper for
   the attribution step.

## Context

- Depends on: T4350 (must merge first — reuses its snapshot mechanism and carry-forward
  concept; do not duplicate)
- Files (verify against current code, not this list — line numbers will have moved by the time
  this starts): `src/backend/app/routers/export/multi_clip.py` (multi-clip finalize, currently
  ~1774-1801, runs fresh detection same as the single-clip path did before T4350), `app/
  highlight_transform.py` (`transform_all_regions_to_raw`/`_to_working`, both single-clip today
  — read T4350's actual implementation of the single-clip old→raw→new composition before
  extending it, don't re-derive from scratch), `services/export_finalize.py`
  (`upsert_working_video`, the shared writer both single- and multi-clip finalize call through)
- Read T4350's Progress Log and design doc first — it documents the live-path audit (dead
  endpoint, discard-not-drift finding) that also applies here, plus the exact shape of the
  snapshot/carry mechanism this task extends.

## Steps

1. [ ] Read T4350's merged implementation + design doc; confirm the OLD-framing snapshot shape
   and decide the attribution mechanism (persisted-on-write vs derived-at-transform-time).
2. [ ] Tests first: multi-clip fixtures — a highlight on clip 2 of 3 survives a trim on clip 1
   (offset shift only, no re-transform needed for clip 2's own region); a highlight on the
   trimmed clip itself gets transformed; a highlight on a REMOVED clip gets dropped+flagged.
3. [ ] Implement attribution + per-region transform composition; wire into
   `multi_clip.py`'s finalize alongside (not duplicating) T4350's carry-forward logic.
4. [ ] Live QA: multi-clip project, place a highlight on each of 2+ clips, re-trim one clip,
   re-export, confirm each highlight lands on its correct visual moment (or is dropped+flagged
   if genuinely unmappable).

## Acceptance Criteria

- [ ] A multi-clip re-export with a timing change on ONE clip preserves highlights on the
  OTHER (unchanged) clips correctly, not just via the loud-fallback reset
- [ ] A highlight on the clip whose timing changed transforms old→raw→new the same way T4350's
  single-clip path does
- [ ] A highlight on a clip that's been removed/reordered such that it no longer maps drops
  LOUDLY (user-visible), never silently
- [ ] Fixtures cover: offset-only shift (other clips unaffected), same-clip timing change,
  clip removal
