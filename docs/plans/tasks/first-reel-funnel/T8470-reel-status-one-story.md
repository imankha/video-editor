# T8470: One status story for a reel (created = visible)

**Status:** WIP
**Impact:** 8
**Complexity:** 5
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source)

## Problem

In one staging session (2026-09-02 walkthrough) the same freshly created reel was
described three contradictory ways within two minutes:

1. Toast at save: "Reel created!"
2. Home continue card: "Brilliant Goal, 1 clip, Not Started"
3. Highlight Reels drawer: "Highlights 0, No highlights in progress" AND "No reels yet"

This reproduces prod bug #21 (lisagee: "There's no way to create a reel... There is no
point to this website") and rikusbothainnz's identical silent exit ten weeks later.
Cliff 4: no real user has ever exported a reel.

## Why each surface says what it says (verified in source)

- **"Reel created!"** - `src/frontend/src/containers/AnnotateContainer.jsx`. Three
  call sites fire when the clip-save response carries `result.project_created`:
  line ~924 `toast.success('Reel created!', { duration: 5000 })` (save path), and
  lines ~1011 / ~1046 `` toast.success(`Reel created: ${clipName}`) `` (update paths).
  Each also calls `setAutoProjectId(region.id, result.project_id)` and
  `fetchProjects({ force: true })`.
- **"Not Started"** - `src/frontend/src/utils/draftStage.js`. `DRAFT_STAGE_LABELS`
  (line 23): NOT_STARTED -> 'Not Started', IN_FRAMING -> 'In Focus', IN_OVERLAY ->
  'In Overlay', READY -> 'Ready'. `getDraftStage(project)` (line 46) derives from
  `has_final_video` / `has_working_video` / `clips_in_progress` / `clips_exported` /
  `has_overlay_edits`. A fresh auto-created draft has none of those -> NOT_STARTED.
  The continue card (ProjectManager.jsx ~line 770 computes items, ~1098 renders) shows
  that label. So "Not Started" describes FRAMING progress while the toast described
  the RECORD existing - two lifecycle axes sharing one status slot.
- **"No highlights in progress"** - `src/frontend/src/components/DownloadsPanel.jsx`
  line ~790. Per T8360's approved design (comment at lines 71-73): "Highlights =
  in-progress MULTI-CLIP drafts (`is_auto_created === false`)". A single-clip
  auto-draft (which is what save-with-reel-on creates - `is_auto_created === true`)
  is DELIBERATELY excluded from this drawer section; it lives on the Clips tab.
- **"No reels yet"** - `src/frontend/src/components/collections/CollectionsTab.jsx`
  line 130. This lists PUBLISHED reels (final_videos), so a draft is invisible here
  by definition.

So this is not one bug: it is a status-vocabulary collision (draftStage labels vs the
toast) stacked on a deliberate IA partition (T8360) that the toast's wording ignores.

## What to build

### Part A - one status vocabulary (Draft / Shared)

1. In `draftStage.js`, change ONLY the labels (the stage KEYS and derivation stay -
   tile sizing/row grouping depend on them):
   - NOT_STARTED -> 'Draft'
   - IN_FRAMING -> 'Draft - in Focus'
   - IN_OVERLAY -> 'Draft - in Overlay'
   - READY -> 'Ready to share'  (a READY draft has a final video but is not yet
     published; "Ready" alone was the ambiguous word - qualify it)
   A published reel is 'Shared' - that state lives past draftStage (published rows
   leave the drafts list), so no new stage key; the ReelTile/collections surfaces
   already treat published as their own world.
2. Update every renderer of the old labels: DraftTile.jsx status chip,
   ProjectManager.jsx phase headers ("By Phase" view reads DRAFT_STAGE_LABELS),
   CollapsibleGroup legend, the continue card subtitle. Grep for
   `DRAFT_STAGE_LABELS` and for the literal strings 'Not Started' / 'Ready' in
   src/frontend/src to catch stragglers.
3. Update tests asserting the old strings: `draftStage.test.js`,
   `DraftTile.test.jsx`, `ProjectManager.publishRetry.test.jsx` (grep the literals).
4. VOCABULARY CONSTRAINT (epic-level, binding): nouns stay T8130's
   (Plays / Clips / Highlight Reels). This task changes STATUS words only.

### Part B - the toast tells the truth about WHERE

Because T8360 deliberately routes single-clip auto-drafts to the Clips tab (not the
drawer), the toast must point there, not at a "reel" the drawer won't show. Change the
three AnnotateContainer toasts to the T8480 wording (T8480 owns the toast + tab
enablement; coordinate - implement both tasks on one branch if convenient):
"Reel started, click Focus to complete" (tappable). The key point for THIS task: no
copy anywhere may promise presence in a surface that excludes the object.

### Part C - drawer acknowledges drafts exist

Do NOT overturn T8360's partition (approved design). Instead make the drawer's empty
states count-aware so they can never lie:
- In DownloadsPanel.jsx, where the "Highlights 0 / No highlights in progress" section
  renders: if `projects` contains auto-created single-clip drafts (the Clips-tab
  population), the published-reels empty state ("Publish reels to see them grouped by
  game here" via CollectionsTab's "No reels yet") gains a second line:
  "You have N draft clips in progress - find them on the Clips tab." with an onClick
  that closes the drawer and switches to the Clips tab (ProjectManager owns the tab
  state; pass a callback prop the same way `onOpenAssembly` is passed, see
  DownloadsPanel.jsx lines 55-64).
- The header badge on the "Highlight Reels" button already counts something (walkthrough
  showed "1" after publish). Verify what it counts (grep DownloadsPanel/ProjectManager
  for the badge count) and make sure a fresh draft does not increment a counter whose
  panel then says "0" - counter and panel must read the same partition.

### Part D - the stale "Create Reel" button

`src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` renders
"Create Reel" (actionable) vs "Reel Created" (disabled) based on the clip's
`autoProjectId` + the T8070 reel-source snapshot (see
`ClipDetailsEditor.reel.test.jsx`: falls back to "Create Reel" when start/end drift
from `reel_source_start/end_time`, shows nothing stale when they match). The
walkthrough saw an ACTIONABLE "Create Reel" seconds after creation with no drift -
root-cause first: almost certainly the details panel's clip prop not yet carrying the
new `autoProjectId`/snapshot (the save response sets it via `setAutoProjectId`, but
the details panel may render from a different, unrefreshed source). Fix the data flow
so the button flips the moment `project_created` lands; then change the "Reel
Created" disabled dead-end into a live link: label "Open reel (Draft)", onClick =
same select+navigate the T8480 toast performs. Update ClipDetailsEditor.reel.test.jsx.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/draftStage.js` + `draftStage.test.js` - labels (Part A)
- `src/frontend/src/components/DraftTile.jsx` + tests - chip strings
- `src/frontend/src/components/ProjectManager.jsx` - continue card (~770/~1098), phase
  headers, tab-switch callback for Part C
- `src/frontend/src/components/DownloadsPanel.jsx` (~55-75, ~762-800) - drawer states
- `src/frontend/src/components/collections/CollectionsTab.jsx` (line 130) - empty state
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` + `.reel.test.jsx` - Part D
- `src/frontend/src/containers/AnnotateContainer.jsx` (~920/~1011/~1046) - toasts (with T8480)

### Related Tasks
- T8360 (merged): its is_auto_created partition is respected, not reverted
- T8480: owns tab enablement + toast behavior; land together or in sequence
- T8130/T8260: noun vocabulary - do not touch nouns
- No backend change, no migration: Draft/Shared is derived (no-redundant-state rule)

## Acceptance Criteria

- [ ] Grep proves 'Not Started' and bare 'Ready' render nowhere for reels
- [ ] Continue card, Clips tab chips, drawer sections, and toasts describe one
      consistent story for a fresh draft (all say Draft, all point at the Clips tab)
- [ ] Drawer empty states are count-aware and can never say "No reels yet" without
      acknowledging existing drafts
- [ ] The details-panel button flips to a live "Open reel (Draft)" link the moment
      creation lands; no actionable "Create Reel" for an existing, un-drifted reel
- [ ] All touched tests updated + green; e2e: save-with-reel-on then walk Home ->
      drawer -> details and assert the strings
- [ ] Verified at 390x844
