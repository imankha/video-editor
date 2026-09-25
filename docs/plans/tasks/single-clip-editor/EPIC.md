# Single-Clip Editor: remove Reels and multi-clip editing

**Status:** TODO (all questions answered 2026-09-24)
**Started:** 2026-09-24
**Impact:** 8 **Complexity:** 7 **Priority:** 1.1
**Sibling epic:** [Highlight-First Annotate Flow](../highlight-first/EPIC.md) (ships in the same version)
**Decision artifact:** https://claude.ai/artifact/CWHnjGEUCzqMhgeyQGrzwB (answers in its `answers` db collection)
**Future:** [T11300 Reels v2, post-publish stitcher](../T11300-reels-v2-post-publish-stitcher.md) (NOT next version)

## Goal

User's words (2026-09-24): remove "Reels" (it will come back later, the module isn't ready) and
remove the concept of editing multiple clips inside Framing or Spotlight, "all of the UI
associated with those things and even the code." The final idea: Reels comes AFTER Published, a
place to stitch published clips together, control transitions, add interstitial text frames and
make a college highlight reel. So Framing and Spotlight never have to handle multiple clips again.

Result: **one project = one clip = one highlight.**

## What "Reel" means in the code today (audit 2026-09-24)

- **Reel draft** (goes away): a `projects` row with `is_auto_created = 0`, assembled from several
  clips via "Create reel" / `GameClipSelectorModal` -> `POST /api/projects/from-clips`. The
  frontend splits Clips vs Reels on that flag (`ProjectManager.jsx:565,578`).
- **Reel as published output** (stays, noun to be ruled, R2): any `final_videos` row, single or
  multi-clip. Backend, admin, ranking, collections, share emails and `PublishedReelsPanel` all call
  these "reels". Multi-clip rows: `clip_count > 1` / `source_type='custom_project'`.

## Key audit findings

1. **Single-clip export already runs on the "multi-clip" pipeline.** `/api/export/render`
   (`routers/export/framing.py:214`) refuses >1 clip then calls `multi_clip._export_clips` with a
   list of one; Modal `process_clips_ai` skips concat for one clip (`video_processing.py:3252`).
   Removal deletes the N>1 BRANCHES, not the module. Goldens stay.
2. **Spotlight is nearly clip-agnostic**: it edits one concatenated `working_videos` row. A legacy
   multi-clip draft that already has a working video can still be spotlighted and published with
   zero multi-clip code; only RE-framing it needs that code.
3. **Latent bugs that become moot**: drag-reorder is never saved (`reorderClipsOnServer` has no
   callers); Modal never renders fade/dissolve yet boundary math subtracts a dissolve overlap
   (misaligned detection / highlight carry for dissolve renders).
4. **Dead today**: `/api/export/chapters`, `/api/export/concat-for-overlay`, `POST /api/projects`,
   `POST /api/projects/preview-clips`, `projectsStore.createProject`, `ProjectCreationSettings.jsx`.
5. **Collections already do most of Reels v2**: ordered play-as-one (`CollectionPlayer`), stitched
   download (T4945 `stitch_members`, `ffmpeg_concat.py`), intro/outro compose, collection share.
   KEEP (R5), they are the seed of T11300.
6. **Data risk**: in-progress multi-clip drafts become invisible once the Reels tab goes (Clips
   filters on `is_auto_created`). Worst case: an exported-but-unpublished draft the user paid
   credits to render. Published multi-clip reels stay reachable (Published -> "Mixes &
   compilations"), but CollectionPlayer shows Re-edit for any reel with a `project_id`
   (`CollectionPlayer.jsx:566`), which would restore a multi-clip project into a single-clip editor.

Size: ~35 production files, ~4,000 production LOC + ~2,500 test LOC deleted.

## Tasks

Refactoring rules apply (CLAUDE.md): characterization first, deletions and moves are separate
commits from behavior change, reviewable units < ~200 lines of meaningful diff (pure deletions
may exceed). **Order is dependency order.**

| ID | Task | Tier | Status |
|----|------|------|--------|
| T11200 | [Read-only census of multi-clip drafts and reels (all envs)](T11200-multiclip-data-census.md) | M | TODO |
| T11210 | [Characterization: single-clip Modal golden + delete dead endpoints](T11210-characterize-and-delete-dead-endpoints.md) | M | TODO |
| T11220 | [Legacy multi-clip data: keep drafts reachable, block re-edit/restore of multi-clip reels](T11220-legacy-multiclip-data-handling.md) | M/L | TODO |
| T11230 | [Remove Reels building surfaces (Reels tab, Create reel, from-clips)](T11230-remove-reels-building-surfaces.md) | M | TODO |
| T11240 | [Remove multi-clip UI from Framing and Spotlight](T11240-remove-multiclip-editor-ui.md) | L | TODO |
| T11250 | [Remove multi-clip backend: clip-management endpoints + export N>1 branches](T11250-remove-multiclip-backend-export.md) | L | TODO |
| T11260 | [Remove multi-clip highlight carry, clip boundaries, Spotlight gates](T11260-remove-multiclip-highlight-carry.md) | M | TODO |
| T11270 | [Collapse clip selection to "the clip" (mechanical)](T11270-collapse-clip-selection.md) | M | TODO |
| T11280 | [Reel vocabulary sweep on published, share, legal and landing copy](T11280-reel-vocabulary-sweep.md) | M | TODO |

T11200 gates T11220 (the counts pick option A/B/C). T11220 gates T11230 (no draft may vanish) and
T11260 (carry code is what keeps legacy highlights alive). T11240 before T11250 (frontend stops
calling before endpoints go). T11270 last among code tasks (move-only). T11280 depends on R2.

## Open questions (answered in the decision artifact)

**All R1-R12 ANSWERED 2026-09-24** (owner agreed with every recommendation; R6 amended as below).
Recorded in the decision artifact's `answers` collection.

| # | Question |
|---|---|
| R1 | Placement: both epics ship in the NEXT version (Deploy Candidate), before the Tutorial Redesign core (T7620/T7630/T7640), the T10320 reshoot and the T9720 gate, since guided mode anchors to final screens. [yes] |
| R2 | Published-output noun once Reels is gone: "highlight" everywhere (Published tab items, share emails, ReelTile, admin, legal, pricing), "Reel" reserved for T11300. Brand "ReelBallers" unchanged. [yes] |
| R3 | In-progress multi-clip drafts: A) keep reachable in Clips, Spotlight + publish still work, re-framing refused with a clear message; B) split into single-clip drafts via migration (loses rendered state); C) hide. [A, confirm after T11200 counts] |
| R4 | Published multi-clip reels: stay viewable / downloadable / shareable under Published "Mixes & compilations"; Re-edit and archive restore hidden for them. [yes] |
| R5 | Collections (play-as-one, stitched download, collection share, Top Plays, ranking): keep live, or hide until Reels v2? They are single-clip-member features and the seed of T11300. [keep live] |
| R6 | ~~Old `/home/reels-in-progress` deep links: redirect to Clips.~~ RULED 2026-09-24: any unsupported link goes Home (catch-all). |
| R7 | Landing site: the recruiting-reel page describes multi-clip assembly and ordering, which becomes false. Rewrite now (separate landing deploy). [rewrite now] |
| R8 | Swapping / replacing the clip inside a project: gone; "make a new clip" instead. [yes] |
| R9 | Framing rail: drop the clip list entirely; show the clip's name / status in the existing header. [yes] |
| R10 | Modal: leave the `process_clips_ai` concat branch untouched this epic (N=1 is already a no-op; avoids a Modal redeploy). [leave] |
| R11 | Marketing copy "make your own reel" (BrandedEndCard, SharePageInstallBanner): -> "make your own highlights". [yes] |
| R12 | T9720 acceptance item "optional multi-clip reel still assembles and publishes" and T7630/T7620 Reels-tab steps: drop. [drop] |

## Completion Criteria

- [ ] No UI path creates a multi-clip project; backend refuses one at every insert site (test)
- [ ] Every existing user can still reach every draft and every published video they had before
- [ ] No Reels tab / Create reel / clip list in Framing or Spotlight (live, desktop + 393 px)
- [ ] Knowledge docs updated: `export-pipeline.md` (dead endpoints, Modal ignores dissolve),
      `modal-gpu.md` (`call_modal_framing_ai` caller line; single-clip `/render` uses
      `call_modal_clips_ai`), `backend-services.md:108` ("reel projects"), `keyframes-framing.md`
