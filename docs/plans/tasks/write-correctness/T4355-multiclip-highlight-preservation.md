# T4355: Multi-Clip Highlight Preservation on Re-Export

**Status:** DONE (deployed 2026-08-24 prod)
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

- [x] A multi-clip re-export with a timing change on ONE clip preserves highlights on the
  OTHER (unchanged) clips correctly, not just via the loud-fallback reset
- [x] A highlight on the clip whose timing changed transforms old→raw→new the same way T4350's
  single-clip path does
- [x] A highlight on a clip that's been removed/reordered such that it no longer maps drops
  LOUDLY (user-visible), never silently
- [x] Fixtures cover: offset-only shift (other clips unaffected), same-clip timing change,
  clip removal

## Progress Log

**2026-08-23**: Design doc (`T4355-design.md`) approved by user via artifact gate — 5 decisions,
all shipped as recommended: (1) attribution derived at transform time from OLD concat offsets +
region `start_time`, not a persisted clip-ref field (only mechanism that covers pre-existing
highlights); (2) additive `transition` key added to the existing `framing_snapshot` msgpack blob
so OLD-side offsets are dissolve-aware — **no migration**; (3) reorder is positionally-identified
only (no stable clip id) — an unmappable region drops+flags loudly rather than risking a silent
wrong-clip landing; (4) multi-clip success-with-drops reuses `dropped:N` verbatim, no new note
code, no frontend change; (5) confirmed no migration needed.

Implementation: rewrote the `clip_count > 1` branch in `services/highlight_carry.py` into
`_transform_multi_clip` (attribute → offset-subtract → per-clip transform → offset-add →
id-merge), extracted a shared `concat_offsets` helper, added the `transition` snapshot key in
`multi_clip.py`. **Reviewer caught + the worker fixed one real BLOCKING bug**: the dissolve-offset
guard originally keyed off OLD-side snapshot key presence, which would have reset EVERY legacy
multi-clip project (even plain `cut` re-exports) instead of only genuinely-dissolve ones —
contradicted the approved design's "absent key ⇒ assume cut" rule. Fixed to key off the NEW-side
transition; 2 new regression fixtures added (legacy+cut transforms correctly, legacy+dissolve
still resets).

32/32 relevant tests green (new multi-clip fixtures + extended T4350 regression suite), ruff
clean, import check clean. Branch CI green (`32671719764`: `changes`/`backend` success,
`frontend` correctly skipped — no frontend files touched). **QA deferred to staging, not
faked**: the headless container has no Modal auth/GPU/real account, so live-driving a real
multi-clip export → re-trim → re-export cycle isn't possible in-container (same gap T4350's
worker hit) — pure-function fixture coverage exercises every acceptance criterion against the
real production transform/canonicalize helpers as ground truth. Dev stack running at
`http://localhost:5174` (backend :8001) for live testing. Knowledge docs
(`export-pipeline.md`, `keyframes-framing.md`) updated with the attribution mechanism, dissolve
handling, reorder limitation, and the reviewer-caught guard landmine.

**Awaiting user's live test** (per T4350's precedent, do not merge on green CI alone — place
highlights on 2+ clips in a multi-clip project, re-trim one, re-export, confirm each highlight
lands on its correct visual moment or drops+flags if genuinely unmappable) before merge.

**2026-08-24**: User's live test surfaced two findings while testing on the T4355 container's
dev stack — neither traces to this task's diff:

1. **Real bug, unrelated, fixed same session (master `21fd971c`):** a false "This project was
   edited elsewhere" 409 on the first overlay edit after any re-export. Root cause is in T4330
   (merged 2026-08-21): `GET /overlay-data` seeded the frontend's conflict-check baseline from
   `working_videos.version` (the export row-counter) instead of `overlay_version` (the mutation
   counter the actual 409-check compares against) — a field-name collision on the same table.
   Fixed directly per user request (S-tier), documented in `keyframes-framing.md`.
2. **Not a bug — container-environment limitation, not new:** no spotlight/tracker visible
   after a fresh multi-clip export. Reproduced live (Playwright, dev-login as the real account):
   `ultralytics package not installed` in the dotask container, so local player detection
   silently returns zero boxes / 0x0 dimensions — a known, documented tradeoff (T4120/T4180,
   containers run Modal OFF and don't bundle YOLO). Auto-detected regions start keyframe-less
   by design (user clicks a detection box to place the first keyframe); with zero boxes there
   is nothing to click. Real verification of highlight-placement/carry behavior needs staging
   (Modal GPU) or a real account, same gap T4350's own worker hit.

User approved merge given both findings are unrelated to this task. **MERGED to master
`7c0273e1`.**
