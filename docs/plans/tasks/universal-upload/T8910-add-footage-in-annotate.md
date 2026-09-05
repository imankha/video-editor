# T8910: Add footage from inside Annotate

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-05
**Updated:** 2026-09-05

## Problem

Users get more footage after creating a game (phone clips from other parents, a second
card). Today adding video means finding the GameTile kebab (T8700's AttachVideoModal).
The natural place is Annotate itself, where the timeline shows where new footage lands.

## Solution

An "Add footage" button in the timeline header + drag-drop onto the timeline, both
opening the universal intake picker scoped to this game, uploading via the EXISTING
attach endpoint, with landing feedback. Spec + microcopy: artifact section 09 (link in
[EPIC.md](EPIC.md)).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/AddFootageButton.jsx` - NEW (button + modal wiring)
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` (or `TimelineBase.jsx` header
  row where the Zoom readout lives) - mount button right-aligned; timeline drop-target
  overlay
- `src/frontend/src/components/GameFootagePicker.jsx` - accept an `attachMode` prop
  (skips game-metadata concerns; picker + strip only)
- `src/frontend/src/services/uploadManager.js` - `attachVideoToExistingGame` (~L1121,
  T8700) generalized to N files with `recorded_at` per file
- `src/frontend/src/containers/AnnotateContainer.jsx` - refresh gameVideos after attach,
  landing highlight + toast

### Related Tasks
- Depends on: T8810/T8820 (picker + strip), T8870 (recorded_at + offsets on attach;
  `POST /api/games/{id}/videos` from T8700 already handles credits/dedupe/append-only)
- Better with T8890 (angles render; without it new footage still appends by sequence) -
  sequence AFTER T8890 per the epic order
- T8900's Fix-timing opener is reused for the no-timestamp amber state.

### Technical Notes
- Button: ghost secondary (`bg-gray-700 hover:bg-gray-600`), FilePlus-style icon, label
  "Add footage" (`hidden lg:inline`, icon-only below with title/aria-label). Lives with
  the timeline (it acts on the timeline), NOT in UnifiedHeader.
- Modal: the universal picker in `attachMode` - dropzone + checking + strip/reorder, no
  opponent/date fields, primary button "Add to this game" showing the credit cost
  (`calculateUploadCost` of accepted bytes; the attach endpoint charges - T8700 closed
  that gap, do not double-charge client-side, just display).
- Shrink offer: include IF trivially composable (the offer card keys on totalBytes +
  capability and T8860's pipeline is payload-driven); if anything resists, EXCLUDE it
  here and note a follow-up in the Progress Log - do not grow this task.
- Drag-drop: window-level dragover while in Annotate dims the timeline strip and shows
  one dashed violet target, copy "Drop your footage here. We'll place it by when it was
  filmed." Drop point does NOT decide placement (recorded time does) - the whole strip is
  one target.
- After upload completes: refetch the game's videos (existing load path), recompute the
  timeline, then landing feedback: new bar/segment pulses twice (ring-violet fade ~2s;
  shared helper with T8900), tappable toast "Added {name}. It landed {mm:ss} into the
  game. Tap to watch it." (tap = seek + activate). Landed on the main track ->
  "Added {name} at {mm:ss}." No usable recorded time -> appended at the end, bar renders
  amber warning family with copy toast "We couldn't tell when {name} was filmed. We put
  it at the end. Use Fix timing to move it." - tapping the amber bar opens Fix timing
  (T8900's exported opener).
- The T7890 `recordFileSelected` beacon does NOT fire here (it is an Add-Game-funnel
  beacon; verify its semantics before touching - if it is generic file-selection
  analytics, fire it; record the decision in the Progress Log).

## Implementation

### Steps
1. [ ] `attachMode` on the picker (hide metadata-adjacent bits, emit the same payload).
2. [ ] Generalize `attachVideoToExistingGame` to a list with `recorded_at`, sequential
   uploads with the "Video {i} of {n}" progress labels.
3. [ ] Mount the button + modal; wire completion -> refetch -> recompute -> highlight +
   toast (all three toast variants).
4. [ ] Timeline drop-target overlay feeding the same modal flow.
5. [ ] Tests: attachMode payload shape; toast variant selection (placed on angle /
   placed on main track / no timestamp); amber-bar tap opens Fix timing; e2e: add a
   file to an existing seeded game, assert new bar + seek-on-toast-tap.

### Progress Log

**2026-09-05**: Filed.

## Acceptance Criteria

- [ ] Add footage works from button AND drag-drop, charging credits once
- [ ] New footage lands placed by recorded time when available; amber parked state
      otherwise, with working Fix-timing handoff
- [ ] Landing pulse + correct toast variant in all three cases
- [ ] Existing AttachVideoModal (GameTile kebab) still works untouched
- [ ] Curated test set + e2e green
