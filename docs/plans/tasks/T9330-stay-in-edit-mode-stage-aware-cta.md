# T9330: Clipping a play keeps the editor open, with a stage-aware primary CTA

**Status:** WIP
**Impact:** 8
**Complexity:** 6
**Created:** 2026-09-09
**Updated:** 2026-09-09

## Problem

Two connected asks from the 2026-09-09 Annotate walkthrough.

### 1. Saving a play closes the editor

`handleFullscreenCreateClip` (`containers/AnnotateContainer.jsx:1209`) ends with the comment
*"Overlay closes automatically: addClipRegion calls onSelect -> selectClip -> CREATING->SELECTED"*,
and `handleSave` (`AnnotateFullscreenOverlay.jsx:350`) calls `onResume()`, which is
`handleOverlayResume` -> `closeOverlay()` + resume playback. So the moment a user cuts a play, the
editor collapses back to the timeline and the play is merely selected.

The reel for that play is created a beat LATER, when `saveClip` answers with
`project_created` / `project_id` and `setAutoProjectId` fires. So there is currently no moment at
which the editor is open AND the reel exists - which is exactly the moment the "open this in AI
Focus" CTA would be useful. The user has to find the clip again and re-enter edit mode to reach it.

User directive: **stay in edit mode after clipping, and show the Apply AI Focus button when it is
ready.**

### 2. The Focus button is a small secondary chip with the wrong label

`AnnotateFullscreenOverlay.jsx:917-940` right-anchors a `size="lg"` Button labeled `Focus` in an
otherwise empty row. It is the only action in that row and it is the whole point of the screen, but
it does not read as a primary CTA. It also says nothing about what stage the reel is at.

Separately, `ClipDetailsEditor.jsx:396-445` computes a DIFFERENT four-way stage machine for the
sidebar ("Focus" / "Overlay" / "Completed" / "Published" / "Open reel (Draft)" / "Create Reel") with
its own labels. Two surfaces, two computations, two vocabularies, one underlying state.

## Solution

### A. Keep the editor open after a create

After a successful create, transition the selection state machine to `EDITING` on the newly created
region instead of falling through to `SELECTED`, and stop `handleSave` from closing the overlay in
create mode.

Constraints that must hold:

- The form resets to create-mode defaults today at the END of `handleSave` (rating, tags, name,
  scrub window, notes, teammates, `createProject`). Staying open means those resets must instead
  REHYDRATE from the just-saved clip, or the user sees an edit form showing default values for a
  clip that has real ones.
- `addClipRegion` returns the new region synchronously; the backend `saveClip` round trip is what
  sets `rawClipId` and `autoProjectId`. The editor must open immediately on the local region and let
  the CTA light up when the backend answers - never block the editor on the network.
- `onResume()` currently also resumes playback. Decide deliberately whether playback resumes while
  the editor stays open (proposal: yes, matching today's felt behavior, since the editor no longer
  blocks the canvas on desktop).
- Cutting several plays in a row is the common path. It must not get slower or require an extra
  click to start the next play - the "Add Play" CTA has to remain reachable with the editor open.
- Mobile (`AnnotateFullscreenOverlay` sheet + fullscreen dock) and desktop (under-canvas strip,
  T8600) are different layouts of the same component. Both need checking; the sheet staying open on
  a phone may be the wrong call and should be verified on a real device.

### B. One stage-aware CTA, shared by both surfaces

Extract a single helper (proposal: `getClipReelStage(region, linkedProject)` in
`components/shared/clipConstants.js` or a new `modes/annotate/clipReelStage.js`) returning the stage
plus its label and target, and consume it from BOTH `AnnotateFullscreenOverlay` and
`ClipDetailsEditor`.

| Condition | Label | Action |
|-----------|-------|--------|
| no `autoProjectId` yet (create in flight) | `Apply AI Focus` | disabled, becomes live when the reel lands |
| reel exists, no working video | `Apply AI Focus` | open the reel in AI Focus |
| stale: boundaries moved since export (T8070) | `Apply AI Focus` | open the reel in AI Focus |
| `has_working_video`, no `has_final_video` | `Apply Spotlight` | open the reel in Spotlight |
| `has_final_video`, not published | `View Final` | open the finished reel |
| `is_published` | `View Published` | open the published reel |

Labels decided by the user 2026-09-09 (including `View Final` for the finished-but-unpublished
state). The CTA is **full-width and primary**, not a right-anchored chip.

Rules that carry over unchanged:

- **T8070 staleness wins.** `reelReflectsClip` (exact start/end equality against
  `reelSourceStartTime` / `reelSourceEndTime`, no epsilon) still demotes the CTA back to
  `Apply AI Focus`. Do not soften it.
- **T8470 Part D.** A fresh draft reel with no snapshot and no produced video is a live link, never
  an actionable "Create Reel" dead end. It maps to `Apply AI Focus` in the table above, which
  subsumes the old `Open reel (Draft)` label.
- **T8730 unsaved-edit guard.** `hasUnsavedEdits()` + the confirm-then-save-then-navigate dialog
  stay; only the wording changes ("Save & open AI Focus"). With the editor now staying open after a
  create, re-verify that a freshly created clip does not read as dirty the instant it opens.
- The manual `Create Reel` control in `ClipDetailsEditor` (rating < 5 / Team layer clips that have
  no reel) is a separate affordance and is NOT replaced by this CTA.

## Files

- `src/frontend/src/modes/annotate/hooks/useClipSelection.js` - a create-completes transition
- `src/frontend/src/containers/AnnotateContainer.jsx` - `handleFullscreenCreateClip`,
  `handleOverlayResume`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - save/reset lifecycle,
  the CTA row
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` - consume the shared helper
- new shared stage helper + its unit test

## Tests

Relevant set (~10), curated:

- new unit test for the stage helper - every row of the table above, plus the staleness and
  fresh-draft branches
- `modes/annotate/components/AnnotateFullscreenOverlay.focusPrompt.test.jsx` - the unsaved-edit
  dialog, relabeled
- `modes/annotate/components/AnnotateFullscreenOverlay.oneTap.test.jsx` - one-tap save (T8140) must
  still work with the editor staying open
- `modes/annotate/components/AnnotateFullscreenOverlay.details.test.jsx`
- `modes/annotate/components/ClipDetailsEditor.reel.test.jsx` - the existing stage assertions,
  rewritten against the shared helper
- `modes/annotate/components/ClipsSidePanel.focusButton.test.jsx`
- `modes/annotate/hooks/useAnnotateState.test.js`
- a new test asserting the editor is still open, on the NEW clip, after a create resolves
- the Annotate e2e spec for the add-play flow
- `AnnotateModeView.cta.test.jsx` - the T8130 primary-CTA guard

Real-browser verification is required for the mobile sheet behavior (jsdom gives false confidence on
this class of layout/lifecycle change - see the T5380 precedent).

## Notes

- Tier L. Architect gate: this changes a state machine (`useClipSelection`) and a save lifecycle that
  four surfaces depend on, and the create-to-edit handoff runs while a backend call is in flight.
- No persistence change. Every write here still traces to the same gestures (Save, Update, star
  press) - do not add a `useEffect` that writes when the reel id lands.
- Depends on T9320's vocabulary. Whichever lands second reconciles the words rather than overwriting.
- Beacon: T8140's `add_clip_opened_no_save` abandonment beacon fires on a close without a save.
  Keeping the editor open after a save changes what "close" means on this screen - verify the beacon
  does not start counting phantom abandonment.
