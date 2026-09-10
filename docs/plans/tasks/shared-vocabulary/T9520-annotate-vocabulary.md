# T9520: Annotate surface vocabulary

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **N04-N09, N14, N15, N26, N28, N35 (handoff E1-03)**.

> Child of the [Shared Vocabulary epic](EPIC.md). The epic's two binding overrides apply:
> mode names stay **AI Focus** / **Spotlight** (N16/N18 overridden), and statuses are not
> re-modelled (N22 overridden, T8470's Draft/Shared stands). Internal APIs, routes, store keys and
> analytics vocabulary are never renamed for UI consistency.

## Problem

The Annotate surface names the same object four ways. The walkthrough recorded "Add Play",
"Find an Amazing Play" and "cut your first play" for one action; "annotations", "plays" and "CLIPS"
for one set of saved records; and "Save" versus "Save Your Reel" for one gesture. The new-play
toggle reads **"Don't Clip Play"** with a tooltip saying **"Auto-create a reel from this play"** -
two different actions described side by side (verified in code at
`AnnotateFullscreenOverlay.jsx:824-831`).

## Rename table

| Group | Observed | Becomes |
|-------|----------|---------|
| N04 | Annotate / Clip extraction | **Mark plays** |
| N05 | Add Play / Find an Amazing Play / cut your first play | **Mark play** (helper: "Captures the previous 12 seconds") |
| N06 | annotations / plays / CLIPS | **Plays** |
| N07 | Don't Clip Play / Auto-create a reel | **Create an editable clip** (positive; default and behavior must agree) |
| N08 | Save / Save Your Reel | **Save play** (or "Save play and create clip" when it does both) |
| N09 | Create Reel / Reel / Reel Created | **Create clip** / **Clip** / **Clip created** |
| N14 | Delete reel / Delete Clip | **Delete clip** (a saved game marker is **Delete play**) |
| N15 | Rename reel / Clip name | **Rename clip** / **Clip name**; **Play name** for a marker |
| N26 | Playback Annotations / Preview clip / Play full clip | **Preview plays** / **Preview clip** / **Play clip** |
| N28 | My Athlete / Team / Clip layer | **My player** / **Team** / **Play category** |
| N35 | 4 stars / Good / Big play / ! | **4 stars . Good** (one documented mapping) |

## Reversals to record, not hide

**N05 reverses T8130** ("Add Play" was chosen deliberately as the one full-width CTA) and
**N09 reverses T8760** ("Create Reel" -> "Clip Out Play", shipped 2026-09-04). The user adopted the
report model on 2026-09-10 knowing this. Add a line to both task files pointing here.

## Context

### Relevant Files
- `src/frontend/src/config/displayNames.js` - single source for the new constants
- `src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` (incl. `:824` stale tooltip)
- `src/modes/annotate/components/ClipListItem.jsx`, `ClipsSidePanel.jsx`, `AnnotateControls.jsx`
- `src/frontend/src/containers/AnnotateContainer.jsx`
- `src/frontend/src/components/shared/clipConstants.js` - rating captions (T9320 revised; build on it)
- `AnnotateFullscreenOverlay.stripLayout.test.jsx` - asserts the current strings; update, do not delete

### Related Tasks
- T9450 - the toggle's polarity and stale tooltip as a behavior fix; coordinate so one of the two owns the string
- T9580 - the save-play contract these labels describe
- T8130, T8760 - the decisions this reverses

## Acceptance Criteria

- [ ] Every Annotate label in the table above matches its object and stage
- [ ] The new-play control reads positively, and its label, tooltip, default and behavior agree
- [ ] One documented star-to-descriptor mapping is used across list, editor and playback
- [ ] Accessible names and tooltips are updated alongside visible text
- [ ] T8130 and T8760 task files record the reversal with a pointer to this task
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
