# T4175: Sweep Preserves Never-Framed Clips as Reel Drafts (Not Raw Published Reels)

**Status:** DONE (deployed 2026-07-06 prod)
**Impact:** 8
**Complexity:** 7
**Created:** 2026-07-05
**Updated:** 2026-07-05

## Problem

When a game nears storage expiry, the cleanup sweep (`auto_export._export_brilliant_clip`)
stream-copies each never-framed brilliant clip out of the game video at its **original 16:9
resolution** and **publishes it as a finished reel** (`final_videos` row, `published_at` set),
then **archives the auto-project** so it leaves Reel Drafts.

The result: raw, unframed 16:9 game footage sits in **My Reels** masquerading as a completed
reel. T4160 stopped the sweep from *deleting* already-framed reels, and T4170 (v019) corrected
the *aspect-ratio label* (9:16 -> 16:9) so these clips stop being mis-scaled into the 9:16
ranking pool. But neither addressed the core wrongness: **an unframed clip should never be a
finished reel.** It should be a **Reel Draft the user can frame.**

Observed live on imankh dev (2026-07-05): reels `id 37-57` (21 reels, all created in one
~90s burst on 2026-06-28, `source_type='brilliant_clip'`, `aspect_ratio='16:9'`, filenames
`auto_6_*`) are the Legends game-6 sweep artifacts. Example the user hit: "Legends March 28
8'37"" is one of these — raw wide footage, never framed. The same class of rows exists on
**prod** (e.g. sarkarati fv 16-22, healed to 16:9 by v019 but still published + unframed).

## Solution

Change the model so the sweep **preserves never-framed clips as draftable sources**, not as
published reels, and remediate the rows already written.

Three parts (all one task per user decision 2026-07-05):

### 1. Sweep behavior (going forward)
For a never-framed brilliant clip, the sweep must:
- Still preserve the clip footage before the game source is reclaimed (the `auto_*.mp4` extract
  is the surviving source — keep producing it).
- **Leave / (re)create the auto-project as a Reel Draft** instead of publishing a `final_videos`
  row and archiving the project. Nothing unframed ever enters My Reels.
- The T4160 skip stays: clips that **already** have a framed published reel are left untouched
  (their highlight is already preserved in framed form).

User decision (2026-07-05): **draft-needs-framing**, NOT auto-center-crop and NOT
"publish raw + also draft". A center-crop guess is usually wrong for soccer; the user frames
it deliberately later.

### 2. Framing pipeline accepts the preserved extract as source (the enabler)
Normally framing crops out of `games/{blake3_hash}.mp4` — exactly what expiry deletes. For a
post-expiry draft to be frameable, the framing/render path must resolve its source to the
preserved per-clip extract (`final_videos/auto_{game}_{clip}_{hex}.mp4`) when the game video is
gone.

**This overlaps T4140 directly.** T4140 introduces `resolve_clip_source` (prefer game video,
else the surviving recap at clip offsets, else fail). This task adds "else the preserved
per-clip auto-extract" to that same resolution layer. **Do not build a parallel resolver** —
share/extend T4140's. See Risks for sequencing.

### 3. Remediate existing rows (migration + data heal)
The `auto_`-prefixed published brilliant_clip reels already written (dev 37-57; prod sarkarati
fv 16-22 and any other users) must be moved from My Reels back to Reel Drafts:
- Un-publish (remove the `final_videos` published row) and restore the auto-project to drafts
  (reverse the T4160/v020 archive), wiring the draft's framing source to the preserved extract.
- Idempotent, generic predicate (`auto_\_%`-filename brilliant_clip rows), tuple-row-factory
  discipline (v017 lesson). Runs on dev/staging/prod via the admin migrate endpoint.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/auto_export.py` — `_export_brilliant_clip` (the publish-vs-draft
  decision), `auto_export_game`. THE behavior change.
- `src/backend/app/services/project_archive.py` — `archive_project` (currently called by sweep;
  the draft path must NOT archive).
- `src/backend/app/routers/export/framing.py` — `render_project` / source resolution; where the
  preserved-extract source must be accepted (coordinate with T4140).
- `src/backend/app/services/export_helpers.py` — shared source-resolution helper home
  (`resolve_clip_source`, T4140) if it lands here.
- `src/backend/app/routers/downloads.py` — publish/restore contract (draft vs published
  invariant; grouping).
- `src/backend/app/migrations/profile_db/vNNN_unpublish_unframed_sweep_reels.py` — NEW
  remediation migration (next free version after v020).
- `src/backend/app/services/pg.py` / `database.py` `_SCHEMA_DDL` — only if a column is needed to
  mark "needs framing" drafts (design open question).
- Frontend: Reel Drafts card / My Reels list — surface these restored drafts correctly (may
  reuse T3540 "Framing started" / in-progress treatment; a never-touched draft should read as
  "needs framing", not "ready").
- `src/backend/tests/test_auto_export.py` — extend (regression: sweep produces a draft, not a
  published reel, for never-framed clips; framed clips still skipped).

### Related Tasks
- **Depends on / overlaps: T4140** (Recap as re-edit source) — shares the `resolve_clip_source`
  post-expiry source layer. Sequencing is an open question (do T4140 first, fold it in, or land
  the resolver here and let T4140 extend it).
- Follows: T4160 (sweep no longer overwrites framed reels), T4170/v019 (aspect-ratio + name
  heal — metadata only, explicitly NOT framing).
- Related: T4130 (recap "+Create Clip", `updateClip(create_project)` — the "clip becomes a
  draft" mechanic), T4190 (My Reels grouping — restored drafts must not orphan).
- Context: the "clips have NO independent source" gap noted in T4130 is precisely what the
  preserved `auto_*.mp4` extract closes for swept clips.

### Technical Notes
- The sweep is the one gesture-less writer (CLAUDE.md persistence rule) — keep the draft-create
  path explicit and synced (`sync_db_to_r2_explicit`), same as today.
- A Reel Draft = a `projects` row with `archived_at IS NULL` + working state
  (`projects.py list_projects` filters `archived_at IS NULL`). Restoring = unarchive + ensure a
  frameable working-clip exists. Verify the auto-project still carries a usable working clip /
  raw_clip after v020 archived it.
- The preserved extract is the raw clip range at original resolution — framing is **reframe-only**
  (crop 16:9 -> chosen ratio); no wider trims are possible post-expiry (frozen bounds), matching
  T4140's reframe-only decision.
- Remediation can't complete without part 2 (a restored draft with a dead game source is not
  frameable) — this is why the three parts are one task.

## Implementation

### Steps
1. [ ] Architect design doc (`docs/plans/tasks/T4175-design.md`) — settle the T4140 sequencing,
       the draft-source wiring, whether a "needs framing" marker column is required, and the
       remediation reversal of archive/publish. **Approval-gated.**
2. [ ] Tester Phase 1 — failing tests: sweep produces a draft (not a published reel) for a
       never-framed clip; framed clips still skipped; framing renders from the preserved extract
       when the game source is gone; remediation migration moves an `auto_*` published reel to
       drafts idempotently.
3. [ ] Implement sweep behavior change in `_export_brilliant_clip` (draft, don't publish/archive).
4. [ ] Implement/extend `resolve_clip_source` to accept the preserved per-clip extract
       (coordinate with T4140).
5. [ ] Write remediation migration (unpublish + unarchive + source-wire; generic predicate).
6. [ ] Frontend: restored/never-framed drafts read as "needs framing" in Reel Drafts; verify
       they don't appear in My Reels.
7. [ ] Tests green; run migration on dev; verify imankh Legends reels move to drafts and frame
       correctly from the preserved extract.

### Progress Log

**2026-07-05**: Created from the imankh-dev "unframed Legends reels in My Reels" investigation.
Root cause confirmed against live dev data (reels 37-57, `auto_6_*`, 16:9, one 2026-06-28 burst)
and the sweep code (`_export_brilliant_clip` publishes + archives). v019 already ran on dev
(profile `user_version=20`) — it only heals metadata, which is why the reels are correctly
labeled 16:9 yet still unframed. User chose draft-needs-framing behavior + full fix as one task.

## Acceptance Criteria

- [ ] After a game expires, never-framed brilliant clips appear in **Reel Drafts** ("needs
      framing"), never in My Reels as finished reels.
- [ ] Already-framed clips remain untouched by the sweep (T4160 skip preserved).
- [ ] A post-expiry draft frames + renders correctly from the preserved `auto_*.mp4` extract
      (reframe-only), producing a real 9:16 (or chosen-ratio) reel.
- [ ] Remediation migration moves every existing `auto_`-prefixed unframed published reel
      (dev + staging + prod) back to a frameable draft; idempotent; tuple-row-factory safe.
- [ ] imankh dev Legends reels (37-57) are drafts again and frame from the preserved footage.
- [ ] No parallel source resolver — shares T4140's `resolve_clip_source`.
- [ ] Backend tests + regression tests pass; `from app.main import app` clean.
