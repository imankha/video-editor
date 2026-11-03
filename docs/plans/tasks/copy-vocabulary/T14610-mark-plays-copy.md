# T14610: Mark plays copy

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

In Mark plays (Annotate) the marked moment is a play on the buttons but a "moment", "clip",
"annotation" or "highlight" around them: action-card descriptions say "moments", saving a play
fails with "Your highlight wasn't saved" (`hooks/useRawClipSave.js` ~22-37) while elsewhere it is
"Could not save this play", aria labels say "Annotation video", the recap modal says "Create a
draft highlight from this moment" / "Highlight started - find it on the Clips tab", the 5-star
label is "Highlight", the layer chips say "My athlete" / "Team" ("No My athlete plays"), and
"Team layer" appears in copy. Details editor headings come in four names; the name field in
three placeholders; extra-video copy says footage / angle / camera / "Fix timing".

Task 2 of 8 in the [Copy Vocabulary epic](EPIC.md). Read EPIC.md for the glossary, verbs and
style rules. Prior task T14600 created `.claude/references/copy-glossary.md` and renamed the tabs.

## Solution

Apply the glossary to every Mark plays surface:
- play everywhere (retire moment, clip, annotation, highlight for a marked moment)
- 5-star label "Brilliant" (low-star labels are T14550)
- "my athlete's plays" / "team plays"; never "layer"
- recap modal: "Watch plays", "Make highlight" for the start-a-highlight action, "Added to Plays" toast
- one details heading ("Details"), one name placeholder ("Name this play")
- extra video: "Add video", "camera" (not angle), "Line up this video with the game" (not "Fix timing")
- "Share plays" is already "Share game" from T14560 (verify)
- apply style rules (Tap, sentence case, no dashes, error voice)

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx`, `src/frontend/src/containers/AnnotateContainer.jsx`, `src/frontend/src/screens/AnnotateScreen.jsx`
- `src/frontend/src/modes/annotate/**` (ClipsSidePanel, ClipListItem, ClipDetailsEditor, AddDetailsPopup, AnnotateFullscreenOverlay, AddFootageButton, AngleLanes, FixTimingStrip, AnnotateTimeline, ClipRegionLayer, PlayRatingRow, SuggestedPlaysList)
- `src/frontend/src/hooks/useRawClipSave.js`
- `src/frontend/src/components/RecapPlayerModal.jsx`, `ClaimGameView.jsx`, `AttachVideoModal.jsx`, `FootageList.jsx`, `GameFootagePicker.jsx`
- `src/frontend/src/config/displayNames.js` (ANNOTATE, GUIDE.watch*, CAMERA copy)

Findings with lines: [audit/D-modes-screens-logic.md](audit/D-modes-screens-logic.md) F-01 to F-03, F-32 to F-35, F-44 to F-62; [audit/C-components-MZ.md](audit/C-components-MZ.md) 1, 5-6, 25; [audit/B-components-AL.md](audit/B-components-AL.md) 41-50, 93-95; [audit/F-gapfill.md](audit/F-gapfill.md) F4, F5, F11, F16.

### Technical Notes
- Text selectors in unit and e2e tests (`src/frontend/e2e`) must be updated in the same change.
- Code identifiers (`raw_clips`, `ClipListItem`) keep their names.

## Implementation

1. [ ] Failing tests: play-save failure toast says "play"; recap modal action labels; 5-star label; layer empty state
2. [ ] Change strings; move inline strings to displayNames
3. [ ] Update test selectors (unit + e2e)
4. [ ] Relevant tests + explicit lint; phone screenshot of Mark plays with the plays panel open

## Acceptance Criteria

- [ ] Mark plays never calls a marked moment anything but "play"
- [ ] No "annotation", "moment", "layer", "footage", "angle" in Mark plays copy
- [ ] Tests pass
