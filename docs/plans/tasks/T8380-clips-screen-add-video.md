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
— now the **"In Progress Clips"** tab (id `projects`, `/home/reels`) after **T8555**
(SHIPPED) split the home screen into four tabs. That tab holds single-clip in-progress
work (`is_auto_created === true`) and has NO action button of its own (the assembly
button "Build New Reel" — T8780 renamed from "New Highlight Reel" — lives on the In
Progress Reels tab). Its empty/dead-end states assume clips can only be born in
Annotate. **T8780** also added a visible on-screen reason (not a button) beneath the
tab bar when this tab is disabled, since the existing `title`-attribute tooltip never
fires on touch — check whether that caption still makes sense once this task inverts
the disabled guard.

## IA the tab lives in (T8555, SHIPPED — no longer "in flight")

**T8360's "Reel Drafts → Clips" IA is superseded by T8545+T8555 (both shipped).** The
current home screen is four peer tabs: **Games / In Progress Clips / In Progress Reels /
Published**. This task's three consciously-revisited choices, restated against the
shipped structure:
- **No action-button row on In Progress Clips** — T8380 adds a NEW "Add Video" button
  there, giving the tab an action row with upload (not assembly) semantics.
- **Empty state copy** currently points at Annotate. NOTE: **T8760 (SHIPPED) renamed the
  Annotate reel-action button "Create Reel" → "Clip Out Play"** — so the existing/old
  empty-state copy "Tap 'Create Reel' on a clip in Annotate" should read
  **"Tap 'Clip Out Play' on a clip in Annotate"**. With Add Video, the empty state
  becomes two-path: extract from a game OR upload clips directly.
- **Dead-end guard** (`clipsTabDisabled`: no auto-drafts AND no extracted clips ->
  tab disabled, bounced to Games). This guard is WRONG once the tab is itself an entry
  point: a brand-new user with zero games could legitimately start on In Progress Clips
  by uploading. The guard must be removed or inverted into an empty-state with the Add
  Video CTA. This is the highest-risk change (it alters first-session routing).

Sequencing: T8555 has LANDED (the shared `ProjectManager.jsx` surface + the renamed
`PublishedReelsPanel.jsx` are on master); this task builds on it directly, no wait. If
T8350 (staleness cue) is also done by then, rebase awareness only - different tile region.

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

### Relevant Files (anticipated - verify against T8555's landed diff)
- `src/frontend/src/components/ProjectManager.jsx` - the In Progress Clips tab body
  (`activeTab === 'projects'` branch), empty states, `clipsTabDisabled` dead-end guard
  (post-T8555 four-tab shape)
- `src/frontend/src/config/displayNames.js` - button copy token (`SECTION_NAMES.CLIPS`
  is now "In Progress Clips")
- `src/frontend/src/components/AttachVideoModal.jsx` — **T8700 (SHIPPED) already built a
  file-picker + upload-to-R2 + progress modal for attaching a video to an existing
  GAME.** Check it for reuse before building new upload UI — the "Add Video → clip"
  gesture is the sibling case (uploads land as clips via T8370's endpoint, not as game
  videos), but the picker/progress/cost-preview chrome may be directly reusable.
- Existing upload flow components (Add Game's picker/progress/retry surfaces) - reuse
- e2e: the In Progress Clips-tab specs (T8555 just repointed the whole tab-locator set)

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
