# Draft Stage Display

**Status:** IN_PROGRESS
**Started:** 2026-08-11
**Impact:** 6 · **Complexity:** 4 · **Priority:** 1.5

## Goal

Reel Drafts inside a game group should read at a glance: which clips haven't been touched,
which are mid-pipeline, and which are ready — and every tile should look like what it actually
is. Today a "Not Started" draft renders as a portrait 9:16 tile (the project's TARGET aspect)
even though nothing has been framed yet and its poster is a landscape frame extracted from the
source at source aspect (`ensure_draft_poster` → `extract_clearest_frame_jpeg`, aspect
preserved). The result is a vertical rectangle showing a center-cropped sliver of a landscape
frame. Un-started drafts also get no hover preview (the T6420 preview chain stops at
final → working video), even though the source clip is streamable.

Three user asks (2026-08-11):
1. Not Started tiles should have the SAME aspect ratio as the source footage, not the target.
2. Within a game group, drafts should be separated onto different lines by stage
   (Not Started / In Framing / In Overlay / Ready).
3. Not Started tiles should autoplay on hover like other reels (same T6420 logic), playing
   the source clip window.

## Tasks

Ordered by dependency AND by ship-urgency: T6800 + T6810 are frontend view-only and are wanted
inside the current code-freeze build; T6820 touches the backend payload and the preview player
and lands after the freeze.

| ID | Task | Status |
|----|------|--------|
| T6800 | [Not Started tiles render at source aspect](T6800-not-started-tile-source-aspect.md) | WAITING ON USER |
| T6810 | [Game group: one row per stage](T6810-game-group-stage-rows.md) | WAITING ON USER |
| T6820 | [Hover preview for Not Started drafts (source clip window)](T6820-hover-preview-not-started-source-clip.md) | TODO |

## Stage definitions (shared by all three tasks)

The canonical per-project stage derivation already exists in
`ProjectManager.jsx::getProjectStatusCounts` and DraftTile's status chip; reuse it, do not
invent a parallel one:

```
Ready       has_final_video (subsumes Ready-to-publish and published-complete)
In Overlay  !has_final_video && has_working_video
In Framing  !above && (clips_in_progress > 0 || clips_exported > 0 || has_overlay_edits)
Not Started everything else
```

## Relationship to other epics

- **[Tile Video Preview](../tile-video-preview/EPIC.md)** owns the preview primitive
  (`TilePreviewVideo` + `useTilePreview`, T6420) and its extensions (T6430 touch, T6440
  setting, T6441 In-Overlay fallback). T6820 is functionally "extend hover preview to
  Not Started drafts" and MUST reuse that primitive; it lives here because it depends on
  T6800's aspect decision, but coordinate any primitive changes with that epic.
- **UI runway / T5140 reshoot:** T6800 + T6810 are UI-visible and land pre-reshoot (and
  ideally inside the 2026-08-11 code-freeze build per user request). T6820 changes hover
  behavior only (not captured in static tutorial frames) — safe either side.

## Completion Criteria

- [ ] Not Started drafts render landscape (source aspect); no center-cropped portrait slivers
- [ ] Game groups show one labeled row per stage present, in pipeline order
- [ ] Hovering a Not Started draft plays its source clip window (fine pointer only, muted,
      looping, single-active — all T6420 semantics)
- [ ] No persistence changes anywhere (all three are view-only or read-only additive API)
- [ ] Tests: DraftTile aspect unit test, ProjectManager grouping unit test, preview fallback test
