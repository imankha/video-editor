# T14770: One highlight entry button, Edit play first, list of highlights already made

**Status:** WAITING ON USER (design pick)
**Impact:** 7
**Complexity:** 5
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

User request (2026-11-03): with a play selected in Mark plays, put **Edit play** before the highlight action, and turn the two **Make highlight** buttons (Portrait, Landscape) into **one** button. Making a highlight several times from the same play (portrait and landscape, maybe several of each) must work, the screen must show how many of each were already made, and the parent must be able to open each one.

Today (`HighlightOrientationSlots.jsx`, T11910) each orientation slot offers Make only while it has no highlight. After that the slot lists the highlight's status and there is no way to make a second one. The backend already supports it: `handleMakeHighlight(aspectRatio)` always creates a new project (`forceNew`), `highlightOrdinal` counts per (play, orientation), and `handleOpenInstance` opens any highlight at its stage (Frame, Spotlight, preview, finished; archived ones via `fetchProject`).

This task supersedes the layout half of T14750 (Edit play first). T14750's guide-sentence half is answered by the design below; fold T14750 into this task once the design is picked.

## Design (DRAFT, needs the user's pick)

Decision page: https://claude.ai/artifact/MggCeaBwWEqdgnAdkUjYhT (options A, B, C with mockups). Designer: ui-designer agent, 2026-11-03.

### Label (decided by the user 2026-11-03)
The single entry button reads **Make highlight**. User: "The user doesn't know what 'Frame play' means, they may want to 'Make Highlight' though. Our wording has to resonate with the users motivations at every opportunity." The glossary's "Frame play" is dropped (EPIC.md and T14620 updated). The paid step inside Frame gets its own label so the two never match: recommended **Sharpen my highlight** (pending the user's pick; alternatives "Get my highlight", "Make it sharp").

### Options
- **A (recommended): Make highlight opens an in-place shape chooser.** Edit play row first, Make highlight primary card below. Tapping it turns the card into two tiles, Portrait / Landscape (hint + "2 made" count each), plus Cancel. Tap a tile: create and open Frame. Keeps the 2026-10-06 ruling "no default, deliberate choice"; one pulse target; no Frame change.
- **B: segmented Portrait | Landscape toggle on the card, then Make highlight.** One tap in the common case, but brings back a default (Portrait) and puts two controls in one card.
- **C: Make highlight creates portrait; change shape inside Frame** with the existing aspect selector (`FocusScreen.handleAspectRatioChange`). Simplest Annotate, but a silent default, the shape is chosen after the highlight exists (renumbers it), and it overlaps T14760.

### Already-made list (all options)
- Heading "Highlights from this play" with count chips "2 portrait", "1 landscape" (zero counts omitted).
- One row per highlight: orientation icon, name "Portrait 1" / "Landscape 2" (from `highlightOrdinal`), status pill, action, chevron. Row opens via `handleOpenInstance`.

| Stage | Pill | Row action |
|---|---|---|
| Frame, no positions | In progress | Continue highlight |
| Frame, has positions | In progress | Continue highlight |
| Spotlight | In progress | Add spotlight / Continue adding spotlight |
| Final, not finished | In progress | Watch highlight |
| Finished | Finished | Watch highlight |

- Order: in progress first (newest on top), then finished; portrait before landscape, then by number.
- Show 3 rows, then "Show all 5 highlights" / "Show fewer" (local state, not persisted).
- Archived highlights stay listed (they open by id). Stale (play timing changed after framing): row reads "Continue framing" with subline "Play timing changed"; finished highlights stay as they are.

### Guidance (answers T14750's two questions, Option A)
- 5-star guide keeps its strong portrait title and adds Edit play as a short body clause; Edit play is keepClear only, never pulsed.
- Pulse: new `GUIDE_PULSE.MAKE_HIGHLIGHT` on the entry button. Chooser open: new rule `annotate.selected.choose` pulses the Portrait tile. Rules that describe an existing portrait highlight's state (`spotlight`, `preview`, `published`, `portrait`) anchor on that highlight's list row.
- Sentences:
  - No highlights: "You can edit this play or make a highlight from it." / "Tap Edit play to fix its timing, rating or tags, or Make highlight to turn it into a video you can share."
  - 5 stars, none yet: "Brilliant play. Make a highlight to share it." / "Tap Make highlight and keep your athlete in the picture. Edit play is there if the timing is off."
  - Has highlights: "This play has 2 highlights. Tap one to pick up where you left off, or Make highlight for another."
  - Chooser open: "Where will you share it? Portrait for Instagram and TikTok, landscape for YouTube and coaches."

### Open decisions for the user
1. Option A, B or C.
2. ~~Entry button label~~ Decided 2026-11-03: Make highlight. New: the paid-step label inside Frame (Sharpen my highlight recommended).
3. 5-star choice card (`HighlightChoiceCard`, "Make highlight now"): open the same chooser (recommended) or stay portrait-only.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/components/HighlightOrientationSlots.jsx` - becomes the entry button + chooser + made list (split into `HighlightEntry` / `HighlightList`)
- `src/frontend/src/modes/AnnotateModeView.jsx` (~L300-345 create/open handlers; ~L1341-1370 `isEditMode` grid, Edit play `ActionCard`)
- `src/frontend/src/modes/annotate/clipStage.js` (`getClipStages`; add a `stale` flag; drop the synthesized missing-orientation entries from this surface)
- `src/frontend/src/components/instructions/resolveGuide.js` (~L183-192), `guideTargets.js`, `FloatingCoach.jsx`
- `src/frontend/src/config/displayNames.js` (`ANNOTATE.*`, `GUIDE.annotate.*`)
- 5-star choice card: `HighlightChoiceCard`
- Tests: `AnnotateModeView.highlightInstances.test.jsx`, `AnnotateModeView.cta.test.jsx`, `HighlightOrientationSlots.pulse/.locked.test.jsx`, `resolveGuide.pulseTargets.test.js`, `guideRules.namedControls.test.js`, `resolveGuide.keepClear.test.js`, `guidePulse.gaps.test.jsx`, `FloatingCoach.shade.test.jsx`
- e2e: `src/frontend/e2e/new-user-flow.spec.js` (~476), `T0-no-highlight-during-upload.qa.spec.js` (~131, 148), `T10760-selector-scoped-reads.qa.spec.js` (~86). Keep `annotate-make-highlight-{orientation}` on the chooser tiles and `annotate-highlight-slots` on the section wrapper to cut churn.

### Related Tasks
- Runs right after the Copy audit milestone; depends on T14620 (paid-step rename inside Frame; entry keeps Make highlight) and T14610 (Mark plays copy).
- Absorbs T14750 (Edit play first + selected-play guide sentence).
- T14760 (Frame guidance) only if Option C is picked.

### Technical Notes
- Knowledge docs: `.claude/knowledge/annotate.md`, `.claude/knowledge/guidance.md`.
- No backend or schema change for A/B. Chooser open/closed and the list's expanded state are local view state, never persisted.
- Upload lock moves from the slot group to the entry button and rows ("Available when your upload finishes", no pulse); Edit play keeps its own gating.
- Pending create: tiles inert, tapped tile reads "Opening Frame...", guarded by `frameCreateInFlightRef`.
- Option C only: an orientation change after framing re-fits crops; Frame would need a confirmation when positions exist.

## Implementation

### Steps
1. [ ] User picks option, label, choice-card behaviour (decision artifact)
2. [ ] Fold T14750 into this task in PLAN.md
3. [ ] Failing tests: Edit play renders first; one entry button; chooser creates the picked orientation; made list shows counts, rows per highlight, each row opens its stage; second highlight of the same orientation can be made
4. [ ] Implement entry + chooser + list; guide rules and pulses
5. [ ] Update unit + e2e selectors
6. [ ] Live-check phone 390x844 and desktop 1280x800 with Guidance on: none / one in progress / several across both orientations / uploading / pending

### Progress Log

**2026-11-03**: Filed from user request. ui-designer proposal (A/B/C) written up as a decision artifact; waiting on the user's pick.

## Acceptance Criteria

- [ ] Edit play is the first action for a selected play on phone and desktop
- [ ] One entry button; the parent picks portrait or landscape deliberately (per chosen option)
- [ ] A play can get several highlights of each orientation
- [ ] The screen shows how many portrait and landscape highlights exist and lists each one with its status
- [ ] Each listed highlight opens at its current stage
- [ ] Guide sentences and pulses follow the chosen design and pass the guidance guard tests
- [ ] Copy uses glossary words
