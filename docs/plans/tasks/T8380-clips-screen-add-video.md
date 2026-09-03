# T8380: "Add Video" button on the Clips screen

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-02

Filed from the T7620 guided-Help design round (user directive 2026-09-02, with T8370).
**Gates the tutorial launch (T7640)** together with T8370: the guided path's pre-cut
branch needs a real button to bounce its arrow at.

## Problem

Once T8370 makes uploaded files become clips, users need an entry point where they
naturally look for it. The user named it: an **"Add Video" button on the Clips screen**
(the Home tab that T8360 - currently in flight - renames from "Reel Drafts" to "Clips",
single-clip surface). Today that tab has NO action button at all after T8360 relocates
"Build Highlight Reel" to the Highlight Reels panel, and its empty/dead-end states
assume clips can only be born in Annotate.

## Interplay with T8360 (in flight - coordinate, do not collide)

T8360's approved design makes three choices this task must consciously revisit:
- **No action-button row on the Clips tab** (the Build button moves out). T8380 puts a
  NEW button there - "Add Video" - so the tab gets an action row back, with upload
  semantics instead of assembly semantics.
- **Empty state copy** points at Annotate ("Tap 'Create Reel' on a clip in Annotate to
  start one."). With Add Video, the empty state becomes two-path: extract from a game
  OR upload clips directly.
- **Dead-end guard** (`clipsTabDisabled`: no auto-drafts AND no extracted clips ->
  tab disabled, bounced to Games). This guard is WRONG once the tab is itself an entry
  point: a brand-new user with zero games could legitimately start on Clips by
  uploading. The guard must be removed or inverted into an empty-state with the Add
  Video CTA. This is the highest-risk change (it alters first-session routing).

Sequencing: T8360 lands first (it is mid-implementation); this task builds on its
shipped surface. If T8350 (staleness cue) is also done by then, rebase awareness only -
different tile region.

## Scope

- "Add Video" button on the Clips tab (placement/size per ui-designer pass; mobile
  first - the phone camera roll is the primary source).
- File picker accepting one-or-many videos; hands off to T8370's upload flow; progress
  + failure UX reusing the existing upload components (Retry cards, T7880 class).
- **Consequence warning before processing (2026-09-03, user directive):** the flow warns
  that a directly uploaded clip is not associated with a game and does not come through
  annotation, so it will not be in the database for future highlights to be created.
  Informative with a clear continue, shown once per flow, never a hard gate. Exact copy
  via the ui-designer pass; the requirement is recorded in T8370 as well.
- Uploaded clips land on the Clips surface as tiles ready for Create Reel / Focus.
- Empty-state + dead-end-guard rework per above.
- Naming: reconcile with T8130's reserved "New Clip" vocabulary - the user said "Add
  Video"; ui-designer pass confirms final copy and updates displayNames tokens.
- Analytics: this gesture is the `clip_uploaded` emit site's trigger (emit lives in
  T8370's backend).

## Context

### Relevant Files (anticipated - verify against T8360's landed diff)
- `src/frontend/src/components/ProjectManager.jsx` - Clips tab body, empty states,
  dead-end guard (post-T8360 shape)
- `src/frontend/src/config/displayNames.js` - button copy token
- Existing upload flow components (Add Game's picker/progress/retry surfaces) - reuse
- e2e: the Clips-tab specs T8360 just migrated

### Related Tasks
- Depends on: [T8370](T8370-precut-clip-upload.md) (the capability), T8360 (the surface;
  in flight)
- Blocks: **T7640** (tutorial rollout - user directive: ships before tutorial launch)
- Related: T8130 ("New Clip" naming reservation), T7620 (guided path F1 pre-cut branch
  targets this button - give it a `data-tutorial-target`)

### Technical Notes
- M-tier with a **ui-designer pass** (placement, empty-state redesign, two-path copy)
  before implementation; no schema change (backend is T8370's).
- Add `data-tutorial-target="clips-add-video"` (literal, greppable) at birth so T7630
  can anchor without a follow-up.
- The dead-end-guard change alters first-session routing - needs an explicit e2e for
  the brand-new-account path (zero games, zero clips: Clips tab reachable, Add Video
  present, Games tab still the default).

## Acceptance Criteria

- [ ] ui-designer spec approved (placement, empty states, final copy)
- [ ] Add Video on the Clips tab uploads one-or-many videos into clips (T8370 flow)
- [ ] Empty Clips tab shows the two-path story and is REACHABLE for a zero-content
      account (dead-end guard reworked)
- [ ] Upload failures surface the standard Retry UX, never a silent loss
- [ ] `data-tutorial-target` present for the guided path
- [ ] Tests pass (unit + the new-account e2e)
