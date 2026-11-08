# T14770: One Make highlight button, Edit play first, shape picked in Frame, list of highlights made

**Status:** STAGING
**Impact:** 7
**Complexity:** 6
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

User request (2026-11-03): with a play selected in Mark plays, put **Edit play** before the highlight action, and turn the two **Make highlight** buttons (Portrait, Landscape) into **one** button. Making a highlight several times from the same play (portrait and landscape, maybe several of each) must work, the screen must show how many of each were already made, and the parent must be able to open each one.

Today (`HighlightOrientationSlots.jsx`, T11910) each orientation slot offers Make only while it has no highlight. After that the slot lists the highlight's status and there is no way to make a second one. The backend already supports it: `handleMakeHighlight(aspectRatio)` always creates a new project (`forceNew`), `highlightOrdinal` counts per (play, orientation), and `handleOpenInstance` opens any highlight at its stage (Frame, Spotlight, preview, finished; archived ones via `fetchProject`).

This task absorbs T14750 (Edit play first + selected-play guide sentence), folded in on 2026-11-03.

## Approved design (user, 2026-11-03)

Decision page: https://claude.ai/artifact/MggCeaBwWEqdgnAdkUjYhT. Designer: ui-designer agent.

| Decision | Choice |
|---|---|
| 1. Where the parent picks portrait or landscape | **Option C: inside Frame.** Mark plays shows one Make highlight button; Frame asks "Where will you share it?" |
| 2. Paid button inside Frame | **Sharpen my highlight** (entry button stays Make highlight; T14620 does the rename) |
| 3. 5-star "Brilliant" choice card | Behaves like the main button: creates the highlight and opens Frame, where the shape is picked |
| Entry button label | **Make highlight** (user: parents don't know what "Frame play" means; name their goal) |

### Mark plays (selected play)
- **Edit play** first: secondary row card, "Edit play" / "Fix the timing, rating or tags."
- **Make highlight** below it: the one primary card, "Make highlight" / "Turn this play into a video you can share." Creates a new highlight (`forceNew`) as portrait `9:16` and opens Frame.
- **Highlights from this play** list below (see next section). Hidden when the play has none.
- Desktop (1280px): Edit play in the first column, Make highlight across the other two, list full width below (two columns of rows from `lg`).

### Frame: "Where will you share it?"
- On a highlight that has no box positions yet, Frame shows a visible shape choice above or beside the video, not buried in the settings panel (today the only control is `AspectRatioSelector` inside `FocusSettingsPanel`, labelled "Aspect ratio"):
  - Title: "Where will you share it?"
  - Two options: **Portrait** "Instagram Reels, TikTok, Stories" / **Landscape** "YouTube, TV, sending to coaches". Portrait shows as selected (the highlight was created portrait).
  - Tapping Landscape calls the existing `FocusScreen.handleAspectRatioChange` (one gesture, surgical, server re-fit, no reactive write).
- This is Frame guide **step 1 of 6** ("Where will you share it? Portrait for Instagram and TikTok, landscape for YouTube and coaches."), pulsing the shape choice; it counts as done once the parent taps either option or drags the box. Then the existing steps follow (drag the box, play, keep, preview, Sharpen my highlight). Coordinate with T14760, which fixes the step counter and Got it stalls on the same rules; T14760 lands first.
- After the first position is placed the prominent choice collapses to a small shape chip ("Portrait" with a swap icon). Changing shape when positions exist asks first: "Switch to landscape? Your box positions will be refit to the new shape." with "Switch" / "Keep portrait" (in-app dialog, no native confirm).
- Switching shape moves the highlight to the other orientation's numbering ("Portrait 2" can become "Landscape 1"); the Mark plays list reflects it on return. Accepted cost of Option C.

### Highlights from this play (list)
- Heading "Highlights from this play" with count chips "2 portrait", "1 landscape" (zero counts omitted).
- One row per highlight: orientation icon, name "Portrait 1" / "Landscape 2" (from `highlightOrdinal`), status pill, action, chevron. Row opens via `handleOpenInstance`.

| Where the highlight is | Pill | Row action |
|---|---|---|
| Frame (box placed or not) | In progress | Continue highlight |
| Made, no spotlight yet | In progress | Add spotlight / Continue adding spotlight |
| Ready, not finished | In progress | Watch highlight |
| Finished | Finished | Watch highlight |

- Order: in progress first (newest on top), then finished; portrait before landscape, then by number.
- Show 3 rows, then "Show all 5 highlights" / "Show fewer" (local state, never persisted).
- Moved to Highlights (archived) stay listed and open by id. Stale (play timing changed after framing): "Continue highlight" with subline "Play timing changed"; finished highlights stay as they are.

### Guidance
- Pulse: new `GUIDE_PULSE.MAKE_HIGHLIGHT` on the entry button. Edit play is named in the sentence and is `keepClear` only, never pulsed (guidance invariant: pulse the control the sentence's Tap names; `guideRules.namedControls.test.js`).
- Rules that describe an existing portrait highlight's state (`annotate.progress.spotlight/preview/published/portrait`) anchor on that highlight's list row instead of the old Portrait slot.
- Sentences (`GUIDE.annotate.*`, copy in `displayNames.js`):
  - Play selected, no highlights: "You can edit this play or make a highlight from it." / "Tap Edit play to fix its timing, rating or tags, or Make highlight to turn it into a video you can share."
  - 5 stars, none yet: "Brilliant play. Make a highlight to share it." / "Tap Make highlight and keep your athlete in the picture. Edit play is there if the timing is off."
  - Has highlights: "This play has 2 highlights." / "Tap one to pick up where you left off, or Make highlight for another."
  - Frame step 1: "Where will you share it? Portrait for Instagram and TikTok, landscape for YouTube and coaches."

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/components/HighlightOrientationSlots.jsx` - becomes the Make highlight entry + made list (split into `HighlightEntry` / `HighlightList`)
- `src/frontend/src/modes/AnnotateModeView.jsx` (~L300-345 create/open handlers; ~L1341-1370 `isEditMode` grid, Edit play `ActionCard`)
- `src/frontend/src/modes/annotate/clipStage.js` (`getClipStages`; add a `stale` flag; drop the synthesized missing-orientation entries from this surface)
- 5-star choice card: `HighlightChoiceCard` (create without asking the shape; open Frame)
- Frame: `src/frontend/src/modes/FocusModeView.jsx`, `modes/focus/cockpit/FocusCockpit.jsx` (landscape phone cockpit), `screens/FocusScreen.jsx` (`handleAspectRatioChange` ~L164), `components/AspectRatioSelector.jsx`, `components/settings/FocusSettingsPanel.jsx`
- Guidance: `components/instructions/resolveGuide.js` (annotate ~L183-192, focus ~L221-258), `guideTargets.js`, `FloatingCoach.jsx`
- `src/frontend/src/config/displayNames.js` (`ANNOTATE.*`, `GUIDE.annotate.*`, `GUIDE.focus.*`)
- Tests: `AnnotateModeView.highlightInstances.test.jsx`, `AnnotateModeView.cta.test.jsx`, `HighlightOrientationSlots.pulse/.locked.test.jsx`, `resolveGuide.pulseTargets.test.js`, `guideRules.namedControls.test.js`, `resolveGuide.keepClear.test.js`, `guidePulse.gaps.test.jsx`, `FloatingCoach.shade.test.jsx`
- e2e: `src/frontend/e2e/new-user-flow.spec.js` (~476 clicks `annotate-make-highlight-portrait`), `T0-no-highlight-during-upload.qa.spec.js` (~131, 148 loop over both orientation buttons), `T10760-selector-scoped-reads.qa.spec.js` (~86 `annotate-highlight-slots`). Keep `annotate-highlight-slots` on the section wrapper; replace the per-orientation make ids with one `annotate-make-highlight` and update the specs (a landscape spec now switches shape in Frame).

### Related Tasks
- Runs after the Copy audit milestone: T14620 (paid step becomes Sharpen my highlight; entry keeps Make highlight), T14610 (Mark plays copy).
- After T14760 (Frame guidance step counter + Got it stall): both edit the `focus.progress.*` rules.
- Absorbs T14750.
- T14780 (step names) may rename the Frame/Spotlight header labels; use whatever labels are current.

### Technical Notes
- Knowledge docs: `.claude/knowledge/annotate.md`, `.claude/knowledge/guidance.md`, `.claude/knowledge/keyframes-framing.md` (aspect change re-fit, T3910).
- No backend or schema change: create stays `forceNew` with `aspectRatio: '9:16'`; the shape change uses the existing aspect-ratio endpoint.
- The prominent shape choice shows while the highlight has no positions (derived from data, not stored). The list's expanded state is local view state.
- Upload lock moves from the slot group to Make highlight and the rows ("Available when your upload finishes", no pulse); Edit play keeps its own gating.
- Pending create: Make highlight inert and reads "Opening Frame...", guarded by `frameCreateInFlightRef`.
- Check the landscape-phone cockpit (`FocusCockpit`) gets the same shape choice.

## Implementation

### Steps
1. [ ] Failing tests: Edit play renders first; one Make highlight button creates a portrait highlight and opens Frame; a second highlight can be made from a play that already has one; list shows count chips and one row per highlight, each opening its stage; Frame shows "Where will you share it?" on a highlight with no positions and switching calls the aspect change; switching with positions asks first
2. [ ] Mark plays: entry + list; 5-star card
3. [ ] Frame: shape choice (prominent + collapsed chip + confirm dialog), phone and cockpit
4. [ ] Guide rules, pulses, sentences
5. [ ] Update unit + e2e selectors
6. [ ] Live-check phone 390x844, landscape phone, desktop 1280x800 with Guidance on: none / one in progress / several across both shapes / uploading / pending / switch shape before and after placing the box

### Progress Log

**2026-11-03**: Filed from user request. ui-designer proposed A/B/C; user picked C (shape inside Frame), Sharpen my highlight for the paid step, and the 5-star card acting like the main button. T14750 folded in.

## Acceptance Criteria

- [ ] Edit play is the first action for a selected play on phone and desktop
- [ ] One Make highlight button; Frame asks "Where will you share it?" before the box is placed
- [ ] A play can get several highlights of each shape
- [ ] Mark plays shows how many portrait and landscape highlights exist and lists each one with its status
- [ ] Each listed highlight opens where it left off
- [ ] Switching shape after placing the box asks first
- [ ] Guide sentences and pulses match the design and pass the guidance guard tests
- [ ] Copy names the parent's goal (glossary style rule 12)
